import { describe, expect, it } from "vitest";
import { resolveCommentAnchor } from "./commentAnchor";

describe("remote comment anchors", () => {
  it("finds one quote and saves nearby context", () => {
    expect(resolveCommentAnchor("Before task after", "task")).toEqual({
      occurrence: 1, prefix: "Before ", suffix: " after",
    });
  });

  it("requires disambiguation and resolves context to the correct occurrence", () => {
    expect(() => resolveCommentAnchor("first task, second task", "task")).toThrow("ambiguous");
    expect(resolveCommentAnchor("first task, second task", "task", undefined, "second ").occurrence).toBe(2);
    expect(resolveCommentAnchor("first task, second task", "task", 2).occurrence).toBe(2);
  });

  it("rejects missing or mismatched anchors", () => {
    expect(() => resolveCommentAnchor("one task", "missing")).toThrow("not present");
    expect(() => resolveCommentAnchor("one task", "task", 2)).toThrow("does not match");
  });
});
