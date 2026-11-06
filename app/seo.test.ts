import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site";

describe("sitemap", () => {
  const urls = sitemap().map((e) => e.url);

  it("lists the public pages on the real domain", () => {
    expect(urls).toContain(SITE_URL);
    for (const path of ["/faq", "/signup", "/login", "/terms", "/privacy", "/acceptable-use"]) {
      expect(urls).toContain(`${SITE_URL}${path}`);
    }
  });

  it("never lists signed-in or internal pages", () => {
    for (const url of urls) expect(url).not.toMatch(/\/(dashboard|admin|api|auth)(\/|$)/);
  });
});

describe("robots", () => {
  it("keeps crawlers out of the dashboard, admin, API and auth callbacks, and points at the sitemap", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.disallow).toEqual(expect.arrayContaining(["/dashboard", "/admin", "/api/", "/auth/"]));
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("search snippet copy", () => {
  it("stays short enough for Google not to cut it off", () => {
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
});
