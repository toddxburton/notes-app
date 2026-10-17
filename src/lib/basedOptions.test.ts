import { describe, expect, it } from "vitest";
import { normalizeBasedOptions, updatedBasedOptions } from "./basedOptions";

describe("Based select choices", () => {
  it("trims and deduplicates choices while preserving order", () => {
    expect(normalizeBasedOptions(["  Low ", "Medium", "Low"])).toEqual(["Low", "Medium"]);
  });

  it("appends without losing existing choices and can replace them", () => {
    expect(updatedBasedOptions(["Low"], ["Medium", "Low"], "append")).toEqual(["Low", "Medium"]);
    expect(updatedBasedOptions(["Low"], ["High"], "replace")).toEqual(["High"]);
  });

  it("rejects blank and oversized choices", () => {
    expect(() => normalizeBasedOptions([" "])).toThrow("1–180");
    expect(() => normalizeBasedOptions(["x".repeat(181)])).toThrow("1–180");
  });
});
