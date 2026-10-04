import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "@/lib/pricing/catalog";
import { filterAppSearchMatches } from "./app-search";

function entry(name: string, priceKobo: number | null): CatalogEntry {
  return {
    service: {
      id: `svc-${name.toLowerCase()}`,
      name,
      category: "Messaging",
      iconKey: name.toLowerCase(),
      iconPath: null,
      iconHex: null,
      iconIsNearWhite: false,
    },
    price:
      priceKobo === null
        ? null
        : { priceKobo, upstreamCostKobo: 0, marginPct: 44.7, ruleId: "rule-1", ruleScope: "global" },
  };
}

const ENTRIES: CatalogEntry[] = [
  entry("WhatsApp", 222505),
  entry("Telegram", 132292),
  entry("TikTok", 150000),
  entry("WeChat", null), // not currently priced — 5sim has no stock in this country
];

describe("filterAppSearchMatches", () => {
  it("returns nothing for an empty or whitespace-only query — no dropdown should open", () => {
    expect(filterAppSearchMatches(ENTRIES, "")).toEqual([]);
    expect(filterAppSearchMatches(ENTRIES, "   ")).toEqual([]);
  });

  it("matches by case-insensitive substring, not just prefix", () => {
    const matches = filterAppSearchMatches(ENTRIES, "app");
    expect(matches.map((m) => m.service.name)).toEqual(["WhatsApp"]);
  });

  it("matches multiple services sharing a substring", () => {
    const matches = filterAppSearchMatches(ENTRIES, "t");
    expect(matches.map((m) => m.service.name).sort()).toEqual(["TikTok", "Telegram", "WhatsApp"].sort());
  });

  it("excludes services with no price in the selected country, even on a name match", () => {
    const matches = filterAppSearchMatches(ENTRIES, "wechat");
    expect(matches).toEqual([]);
  });

  it("caps results at the result limit", () => {
    const many: CatalogEntry[] = Array.from({ length: 20 }, (_, i) => entry(`App${i}`, 100000));
    expect(filterAppSearchMatches(many, "app").length).toBe(8);
  });
});
