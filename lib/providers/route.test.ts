import { describe, expect, it } from "vitest";
import { pickProvider, type ProviderRouteRow } from "./route";
import { customerCanCancel } from "./policy";

const WHATSAPP = { id: "svc-wa", provider: "5sim", grizzly_service_code: "wa" };
const SIGNAL = { id: "svc-signal", provider: "5sim", grizzly_service_code: null };
const USA = { id: "c-usa", grizzly_country_id: 187 };
const BRAZIL = { id: "c-br", grizzly_country_id: 73 };
const CONGO = { id: "c-congo", grizzly_country_id: null };

const route = (service_id: string, country_id: string | null, provider: string, is_active = true): ProviderRouteRow => ({
  service_id,
  country_id,
  provider,
  is_active,
});

const BIG6 = [route("svc-wa", null, "grizzly")];

describe("pickProvider", () => {
  it("routes a Big 6 service to Grizzly in a mapped country", () => {
    expect(pickProvider(BIG6, WHATSAPP, USA)).toBe("grizzly");
  });

  it("keeps an unmapped country on 5sim even when the service routes to Grizzly", () => {
    expect(pickProvider(BIG6, WHATSAPP, CONGO)).toBe("5sim");
  });

  it("keeps a service with no Grizzly code on 5sim", () => {
    expect(pickProvider([route("svc-signal", null, "grizzly")], SIGNAL, USA)).toBe("5sim");
  });

  it("a per-country route beats the any-country route", () => {
    const routes = [...BIG6, route("svc-wa", "c-br", "5sim")];
    expect(pickProvider(routes, WHATSAPP, BRAZIL)).toBe("5sim");
    expect(pickProvider(routes, WHATSAPP, USA)).toBe("grizzly");
  });

  it("ignores inactive routes — the kill switch", () => {
    expect(pickProvider([route("svc-wa", null, "grizzly", false)], WHATSAPP, USA)).toBe("5sim");
  });

  it("falls back to services.provider with no routes, and treats unknown values as 5sim", () => {
    expect(pickProvider([], { ...WHATSAPP, provider: "grizzly" }, USA)).toBe("grizzly");
    expect(pickProvider([], WHATSAPP, USA)).toBe("5sim");
    expect(pickProvider([route("svc-wa", null, "acme")], WHATSAPP, USA)).toBe("5sim");
  });

  it("ignores other services' routes", () => {
    expect(pickProvider([route("svc-other", null, "grizzly")], WHATSAPP, USA)).toBe("5sim");
  });
});

describe("customerCanCancel", () => {
  it("is false only for Grizzly orders", () => {
    expect(customerCanCancel("grizzly")).toBe(false);
    expect(customerCanCancel("5sim")).toBe(true);
    expect(customerCanCancel(undefined)).toBe(true);
  });
});
