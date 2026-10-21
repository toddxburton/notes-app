import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { changeSelectedBlock, contentToPlainText, editorExtensions, markdownToContent, moveTopLevelBlock, plainTextToContent } from "./editor";

describe("editor content conversion", () => {
  it("keeps database view settings when content is saved and reopened", () => {
    const content = { type: "doc", content: [{ type: "inlineDatabase", attrs: {
      title: "Planning",
      columns: [{ id: "name", name: "Name", type: "text", options: [] }],
      rows: [{ id: "one", cells: { name: "Launch" } }],
      filter: { columnId: "name", operator: "contains", value: "Launch" },
      groupBy: "name",
      wrap: true,
    } }] };
    const editor = new Editor({ extensions: editorExtensions, content });
    const reopened = new Editor({ extensions: editorExtensions, content: editor.getHTML() });
    expect(reopened.getJSON().content?.[0]?.attrs).toMatchObject({
      filter: { columnId: "name", operator: "contains", value: "Launch" }, groupBy: "name", wrap: true,
    });
    editor.destroy();
    reopened.destroy();
  });

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

  it("preserves single line breaks inside imported paragraphs", () => {
    const content = plainTextToContent("First line\nSecond line\n\nNext paragraph");

    expect(content.content?.[0]?.content).toMatchObject([
      { type: "text", text: "First line" },
      { type: "hardBreak" },
      { type: "text", text: "Second line" },
    ]);
    expect(contentToPlainText(content)).toBe("First line\nSecond line\nNext paragraph");
  });

  it("includes database titles, columns, and row values in searchable text", () => {
    expect(contentToPlainText({ type: "doc", content: [{
      type: "inlineDatabase",
      attrs: {
        title: "Planning",
        columns: [{ id: "name", name: "Item Name" }, { id: "tags", name: "Tags" }],
        rows: [{ cells: { name: "Launch", tags: ["Ready", "Priority"] } }],
      },
    }] })).toBe("Planning\nItem Name\tTags\nLaunch\tReady, Priority");
  });
});

describe("body typing", () => {
  it("uses Enter for the next line and Shift+Enter for a new paragraph", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>First line</p>" });
    editor.commands.setTextSelection(11);

    expect(editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(editor.getJSON().content).toMatchObject([{
      type: "paragraph",
      content: [{ type: "text", text: "First line" }, { type: "hardBreak" }],
    }]);
    editor.commands.insertContent("Second line");
    expect(editor.commands.keyboardShortcut("Shift-Enter")).toBe(true);
    expect(editor.getJSON().content).toMatchObject([
      { type: "paragraph", content: [
        { type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "Second line" },
      ] },
      { type: "paragraph" },
    ]);
    editor.destroy();
  });

  it("keeps Enter's structural behavior in lists", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<ul><li><p>First item</p></li></ul>" });
    editor.commands.setTextSelection(13);

    expect(editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toHaveLength(2);
    editor.destroy();
  });
});

describe("block reordering", () => {
  it("moves whole blocks in either direction and keeps the move undoable", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<h2>Heading</h2><p>First</p><ul><li><p>Item</p></li></ul><p>Last</p>" });

    expect(moveTopLevelBlock(editor, 0, 4)).toBe(true);
    expect(editor.getJSON().content?.slice(0, 4).map((node) => node.type)).toEqual(["paragraph", "bulletList", "paragraph", "heading"]);
    expect(moveTopLevelBlock(editor, 2, 0)).toBe(true);
    expect(editor.getJSON().content?.slice(0, 4).map((node) => node.type)).toEqual(["paragraph", "paragraph", "bulletList", "heading"]);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "Last" }] });
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "First" }] });
    expect(editor.getJSON().content?.[3]?.type).toBe("heading");
    editor.destroy();
  });

  it("does nothing for an unchanged or invalid drop", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>First</p><p>Second</p>" });

    expect(moveTopLevelBlock(editor, 0, 1)).toBe(false);
    expect(moveTopLevelBlock(editor, 2, 0)).toBe(false);
    expect(contentToPlainText(editor.getJSON())).toBe("First\nSecond");
    editor.destroy();
  });
});

describe("selected block conversion", () => {
  it("changes only the selected line to H3 in an Enter-separated paragraph", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>Before<br>Selected line<br>After</p>" });
    editor.commands.setTextSelection(1);

    expect(changeSelectedBlock(editor, "heading-3", { from: 10, to: 17 })).toBe(true);
    expect(editor.getJSON().content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Selected line" }] },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["paragraph"]);
    editor.destroy();
  });

  it("changes selected lines without converting adjacent paragraphs", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>Before<br>Alpha<br>Beta<br>After</p><p>Separate</p>" });

    expect(changeSelectedBlock(editor, "heading-3", { from: 8, to: 18 })).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph", "heading", "heading", "paragraph", "paragraph",
    ]);
    expect(editor.getJSON().content?.slice(1, 3).map((node) => node.attrs?.level)).toEqual([3, 3]);
    editor.destroy();
  });

  it("turns highlighted lines into separate bullets without changing surrounding lines", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>Before<br>Alpha<br>Beta<br>After</p>" });
    // The format picker can collapse the editor's selection on mobile, so pass its saved range.
    editor.commands.setTextSelection(1);

    expect(changeSelectedBlock(editor, "bulletList", { from: 8, to: 18 })).toBe(true);
    expect(editor.getJSON().content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }] },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ]);
    expect(editor.commands.undo()).toBe(true);
    expect(contentToPlainText(editor.getJSON())).toBe("Before\nAlpha\nBeta\nAfter");
    editor.destroy();
  });

  it("lists only one selected line when it shares a paragraph with other lines", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>Before<br>Alpha<br>Beta<br>After</p>" });
    editor.commands.setTextSelection({ from: 14, to: 18 });

    expect(changeSelectedBlock(editor, "orderedList")).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["paragraph", "orderedList", "paragraph"]);
    expect(editor.getJSON().content?.[0]?.content?.map((node) => node.type)).toEqual(["text", "hardBreak", "text"]);
    expect(editor.getJSON().content?.[1]?.content).toHaveLength(1);
    expect(editor.getJSON().content?.[1]).toMatchObject({
      type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }] }],
    });
    editor.destroy();
  });

  it("changes a heading to another heading or text", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<h1>Heading</h1>" });
    editor.commands.setTextSelection({ from: 1, to: 8 });

    expect(changeSelectedBlock(editor, "heading-2")).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(changeSelectedBlock(editor, "paragraph")).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph");
    editor.destroy();
  });

  it("changes a bullet into a to-do item and then text", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<ul><li><p>Item</p></li></ul>" });
    editor.commands.setTextSelection({ from: 3, to: 7 });

    expect(changeSelectedBlock(editor, "taskList")).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe("taskList");
    expect(changeSelectedBlock(editor, "paragraph")).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph");
    editor.destroy();
  });

  it("changes a list item into a heading and a quote into text", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<ul><li><p>Item</p></li></ul>" });
    editor.commands.setTextSelection({ from: 3, to: 7 });

    expect(changeSelectedBlock(editor, "heading-1")).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(changeSelectedBlock(editor, "blockquote")).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe("blockquote");
    expect(changeSelectedBlock(editor, "paragraph")).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph");
    editor.destroy();
  });
});
