import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Guards against the 23 Sept 2026 regression (see
// supabase/migrations/20261029110000_relock_create_order_and_debit_wallet.sql):
// dropping and re-creating a SECURITY DEFINER function gives it Supabase's
// default EXECUTE grants for `anon` and `authenticated` again, and
// `revoke ... from public` alone does not remove them. Replays every
// migration in filename order and fails if any SECURITY DEFINER function
// in the public schema ends up without a later revoke from BOTH anon and
// authenticated.

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

interface Exposure {
  name: string;
  createdIn: string;
}

// Dollar-quoted bodies, comments and string literals are removed first so
// that semicolons, keywords or "security definer" inside any of them can't
// confuse the statement split. Comments go before strings so an apostrophe
// in a comment ("didn't") can't swallow the following lines.
function statementsOf(sql: string): string[] {
  const withoutBodies = sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " $body$ ");
  const withoutComments = withoutBodies.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const withoutStrings = withoutComments.replace(/'(?:[^']|'')*'/g, "''");
  return withoutStrings
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

// "public.foo(uuid, text), public.bar" -> ["foo", "bar"]
function functionNames(list: string): string[] {
  let flat = list;
  // Strip (possibly nested) argument lists, which contain commas.
  while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, "");
  return flat
    .split(",")
    .map((n) => n.trim().replace(/^public\./, "").replace(/"/g, ""))
    .filter(Boolean);
}

function revokesFromAnonAndAuthenticated(roles: string): boolean {
  const list = roles.split(",").map((r) => r.trim());
  return list.includes("anon") && list.includes("authenticated");
}

export function exposedSecurityDefinerFunctions(migrations: { file: string; sql: string }[]): Exposure[] {
  const exposed = new Map<string, Exposure>();

  for (const { file, sql } of migrations) {
    for (const stmt of statementsOf(sql)) {
      const create = /^create (?:or replace )?function (?:public\.)?"?([a-z0-9_]+)"?/.exec(stmt);
      if (create) {
        if (/\bsecurity definer\b/.test(stmt)) exposed.set(create[1], { name: create[1], createdIn: file });
        continue;
      }

      const drop = /^drop function (?:if exists )?(.+?)(?: cascade| restrict)?$/.exec(stmt);
      if (drop) {
        for (const name of functionNames(drop[1])) exposed.delete(name);
        continue;
      }

      const revokeAll = /^revoke .+ on all functions in schema public from (.+?)(?: cascade| restrict)?$/.exec(stmt);
      if (revokeAll) {
        if (revokesFromAnonAndAuthenticated(revokeAll[1])) exposed.clear();
        continue;
      }

      const revoke = /^revoke .+? on function (.+) from (.+?)(?: cascade| restrict)?$/.exec(stmt);
      if (revoke && revokesFromAnonAndAuthenticated(revoke[2])) {
        for (const name of functionNames(revoke[1])) exposed.delete(name);
      }
    }
  }

  return [...exposed.values()];
}

describe("SECURITY DEFINER functions in supabase/migrations", () => {
  it("are all revoked from anon and authenticated after their latest (re-)creation", () => {
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));

    expect(migrations.length).toBeGreaterThan(0);
    expect(exposedSecurityDefinerFunctions(migrations)).toEqual([]);
  });
});

describe("exposedSecurityDefinerFunctions (the check itself)", () => {
  const create = (name: string, definer = true) =>
    `create or replace function public.${name}(p_a uuid, p_b text default 'x;y') returns void language plpgsql ${
      definer ? "security definer" : ""
    } set search_path = public as $$ begin perform 1; end; $$;`;

  it("catches the 23 Sept pattern: re-created and only revoked from public", () => {
    const result = exposedSecurityDefinerFunctions([
      { file: "1.sql", sql: create("rpc") + "\nrevoke all on function public.rpc from public, anon, authenticated;" },
      {
        file: "2.sql",
        sql: "drop function if exists public.rpc(uuid, text);\n" + create("rpc") + "\nrevoke all on function public.rpc from public;",
      },
    ]);
    expect(result).toEqual([{ name: "rpc", createdIn: "2.sql" }]);
  });

  it("accepts a later migration that re-locks it", () => {
    const result = exposedSecurityDefinerFunctions([
      { file: "1.sql", sql: create("rpc") + "\nrevoke all on function public.rpc from public;" },
      {
        file: "2.sql",
        sql: "revoke all on function public.rpc(uuid, text, bigint) from public, anon, authenticated;\ngrant execute on function public.rpc to service_role;",
      },
    ]);
    expect(result).toEqual([]);
  });

  it("requires both roles, not just one", () => {
    const result = exposedSecurityDefinerFunctions([
      { file: "1.sql", sql: create("rpc") + "\nrevoke execute on function public.rpc from anon;" },
    ]);
    expect(result.map((e) => e.name)).toEqual(["rpc"]);
  });

  it("ignores SECURITY INVOKER functions and text inside bodies and comments", () => {
    const sql =
      create("invoker", false) +
      "\n-- create function public.fake() security definer\n" +
      "create function public.trig() returns trigger language plpgsql as $fn$ begin -- security definer; \n return new; end; $fn$;";
    expect(exposedSecurityDefinerFunctions([{ file: "1.sql", sql }])).toEqual([]);
  });

  it("treats a dropped function as no longer exposed", () => {
    expect(
      exposedSecurityDefinerFunctions([{ file: "1.sql", sql: create("rpc") + "\ndrop function public.rpc(uuid, text);" }]),
    ).toEqual([]);
  });
});
