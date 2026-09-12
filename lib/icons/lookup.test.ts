import { describe, expect, it } from "vitest";
import { getBrandIcon } from "./lookup";

describe("getBrandIcon", () => {
  it("resolves a real Simple Icons slug to its path and hex", () => {
    const icon = getBrandIcon("whatsapp");
    expect(icon).not.toBeNull();
    expect(icon?.hex).toBe("25D366");
    expect(icon?.path.length).toBeGreaterThan(0);
  });

  it("returns null for a slug with no current Simple Icons match", () => {
    // Verified during the Stage 3 catalog trial: no current match despite
    // being an obviously major brand.
    expect(getBrandIcon("microsoft")).toBeNull();
  });

  it("returns null for an empty icon_key", () => {
    expect(getBrandIcon("")).toBeNull();
  });
});
