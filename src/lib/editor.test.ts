import { describe, expect, it } from "vitest";
import { contentToPlainText, markdownToContent, plainTextToContent } from "./editor";

describe("editor content conversion", () => {
  it("preserves block boundaries for agent search and backups", () => {
    const content = markdownToContent("# Heading\n\nFirst paragraph.\n\nSecond paragraph.");

    expect(contentToPlainText(content)).toBe("Heading\nFirst paragraph.\nSecond paragraph.");
  });

  it("converts Markdown checkboxes into editable task items", () => {
    const content = markdownToContent("- [x] Finished\n- [ ] Remaining");
    const taskList = content.content?.find((node) => node.type === "taskList");

    expect(taskList?.content?.map((item) => item.attrs?.checked)).toEqual([true, false]);
  });

  it("keeps paragraphs distinct when importing plain text", () => {
    const content = plainTextToContent("First paragraph.\n\nSecond paragraph.");

    expect(content.content).toHaveLength(2);
    expect(contentToPlainText(content)).toBe("First paragraph.\nSecond paragraph.");
  });
});
