import { describe, expect, it } from "vitest";
import { getBrandIcon } from "./lookup";

describe("getBrandIcon", () => {
  it("resolves a real Simple Icons slug to its path and hex", () => {
    const icon = getBrandIcon("whatsapp");
    expect(icon).not.toBeNull();
    expect(icon?.hex).toBe("25D366");
    expect(icon?.path.length).toBeGreaterThan(0);
    expect(icon?.isNearWhite).toBe(false);
  });

  it("flags a near-white brand color so callers can use a dark tile instead", () => {
    // Verified during the Stage 5 spot-check: Supercell's mark (#FFFFFF)
    // was invisible on the fixed-white --icon-surface tile background.
    const icon = getBrandIcon("supercell");
    expect(icon).not.toBeNull();
    expect(icon?.hex).toBe("FFFFFF");
    expect(icon?.isNearWhite).toBe(true);
  });

  it("does not flag a merely light (not near-white) brand color", () => {
    // Snapchat's #FFFC00 reads fine on white — confirmed live — so the
    // threshold must sit above its luminance, not just any light color.
    const icon = getBrandIcon("snapchat");
    expect(icon).not.toBeNull();
    expect(icon?.isNearWhite).toBe(false);
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
