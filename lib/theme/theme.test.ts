import { describe, expect, it } from "vitest";
import { isTheme, resolveInitialTheme, toggleTheme } from "./theme";

describe("isTheme", () => {
  it("accepts light and dark", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
  });

  it("rejects anything else, including null and garbage localStorage values", () => {
    expect(isTheme(null)).toBe(false);
    expect(isTheme("system")).toBe(false);
    expect(isTheme("")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });
});

describe("resolveInitialTheme", () => {
  it("prefers an explicit stored choice over the system preference", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
  });

  it("falls back to the system preference when nothing is stored", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(null, false)).toBe("light");
  });

  it("falls back to the system preference when the stored value is garbage — a corrupted/old localStorage entry shouldn't crash theming", () => {
    expect(resolveInitialTheme("not-a-theme", true)).toBe("dark");
  });
});

describe("toggleTheme", () => {
  it("flips light to dark and back", () => {
    expect(toggleTheme("light")).toBe("dark");
    expect(toggleTheme("dark")).toBe("light");
  });
});
