import { describe, expect, it } from "vitest";
import { resolvePricingRule, type ResolvablePricingRule } from "./resolve-rule";

const WHATSAPP = "service-whatsapp";
const NIGERIA = "country-nigeria";
const TELEGRAM = "service-telegram";
const GHANA = "country-ghana";

function rule(overrides: Partial<ResolvablePricingRule>): ResolvablePricingRule {
  return {
    id: "id",
    scope: "global",
    service_id: null,
    country_id: null,
    priority: 10,
    ...overrides,
  };
}

describe("resolvePricingRule", () => {
  it("returns null when no rules exist at all", () => {
    expect(resolvePricingRule([], WHATSAPP, NIGERIA)).toBeNull();
  });

  it("falls back to the global rule when nothing more specific applies", () => {
    const global = rule({ id: "global", scope: "global", priority: 10 });
    expect(resolvePricingRule([global], WHATSAPP, NIGERIA)).toBe(global);
  });

  it("prefers a service rule over global", () => {
    const global = rule({ id: "global", scope: "global", priority: 10 });
    const service = rule({ id: "service", scope: "service", service_id: WHATSAPP, priority: 30 });
    expect(resolvePricingRule([global, service], WHATSAPP, NIGERIA)).toBe(service);
  });

  it("prefers a country rule over global but not over a matching service rule", () => {
    const global = rule({ id: "global", scope: "global", priority: 10 });
    const country = rule({ id: "country", scope: "country", country_id: NIGERIA, priority: 20 });
    const service = rule({ id: "service", scope: "service", service_id: WHATSAPP, priority: 30 });
    expect(resolvePricingRule([global, country], WHATSAPP, NIGERIA)).toBe(country);
    expect(resolvePricingRule([global, country, service], WHATSAPP, NIGERIA)).toBe(service);
  });

  it("prefers the most specific service_country rule over everything else", () => {
    const global = rule({ id: "global", scope: "global", priority: 10 });
    const country = rule({ id: "country", scope: "country", country_id: NIGERIA, priority: 20 });
    const service = rule({ id: "service", scope: "service", service_id: WHATSAPP, priority: 30 });
    const serviceCountry = rule({
      id: "service_country",
      scope: "service_country",
      service_id: WHATSAPP,
      country_id: NIGERIA,
      priority: 40,
    });
    expect(
      resolvePricingRule([global, country, service, serviceCountry], WHATSAPP, NIGERIA),
    ).toBe(serviceCountry);
  });

  it("ignores service/country rules that don't match the requested ids", () => {
    const otherService = rule({ id: "other-service", scope: "service", service_id: TELEGRAM, priority: 30 });
    const otherCountry = rule({ id: "other-country", scope: "country", country_id: GHANA, priority: 20 });
    const global = rule({ id: "global", scope: "global", priority: 10 });

    expect(resolvePricingRule([otherService, otherCountry, global], WHATSAPP, NIGERIA)).toBe(global);
  });

  it("ignores a service_country rule for a different service/country pair", () => {
    const wrongPair = rule({
      id: "wrong-pair",
      scope: "service_country",
      service_id: TELEGRAM,
      country_id: NIGERIA,
      priority: 40,
    });
    const global = rule({ id: "global", scope: "global", priority: 10 });
    expect(resolvePricingRule([wrongPair, global], WHATSAPP, NIGERIA)).toBe(global);
  });
});
