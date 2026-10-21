import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./editor";
import {
  applySlashCommand,
  filterSlashCommands,
  getSlashCommandMatch,
  insertBlockFromPicker,
} from "./slashCommands";

describe("slash commands", () => {
  it("opens the menu on a line made with Enter and converts just that line", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>First line<br>/hea</p>" });
    editor.commands.setTextSelection(16);

    const match = getSlashCommandMatch(editor);
    expect(match).toEqual({ from: 12, to: 16, query: "hea", trigger: "/" });
    expect(applySlashCommand(editor, "heading-2", match!)).toBe(true);
    expect(editor.getJSON().content?.slice(0, 2)).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "First line" }] },
      { type: "heading", attrs: { level: 2 } },
    ]);
    editor.destroy();
  });

  it("preserves later lines when a slash command is used in the middle", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>Before<br>/quote<br>After</p>" });
    editor.commands.setTextSelection(14);

    const match = getSlashCommandMatch(editor);
    expect(match).toEqual({ from: 8, to: 14, query: "quote", trigger: "/" });
    expect(applySlashCommand(editor, "quote", match!)).toBe(true);
    expect(editor.getJSON().content).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      { type: "blockquote", content: [{ type: "paragraph" }] },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ]);
    editor.destroy();
  });

  it("also opens the block menu with a backslash", () => {
    const editor = new Editor({ extensions: editorExtensions, content: "<p>First<br>\\check</p>" });
    editor.commands.setTextSelection(13);

    const match = getSlashCommandMatch(editor);
    expect(match).toEqual({ from: 7, to: 13, query: "check", trigger: "\\" });
    expect(applySlashCommand(editor, "checklist", match!)).toBe(true);
    expect(editor.getJSON().content?.[1]?.type).toBe("taskList");
    editor.destroy();
  });

  it("only matches slash text at the beginning of an empty paragraph", () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "/hea" }] }] },
    });
    editor.commands.setTextSelection(5);

    expect(getSlashCommandMatch(editor)).toEqual({ from: 1, to: 5, query: "hea", trigger: "/" });

    editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Try /hea" }] }],
    });
    editor.commands.setTextSelection(9);
    expect(getSlashCommandMatch(editor)).toBeNull();

    editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "/heading with trailing text" }] }],
    });
    editor.commands.setTextSelection(9);
    expect(getSlashCommandMatch(editor)).toBeNull();
    editor.destroy();
  });

  it("filters by labels and related terms", () => {
    expect(filterSlashCommands("head").map((option) => option.id)).toEqual([
      "heading-1",
      "heading-2",
      "heading-3",
    ]);
    expect(filterSlashCommands("todo").map((option) => option.id)).toEqual(["checklist"]);
  });

  it("treats another leading slash as a fresh menu trigger", () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "/head/quo" }] }] },
    });
    editor.commands.setTextSelection(10);

    const match = getSlashCommandMatch(editor);
    expect(match).toEqual({ from: 1, to: 10, query: "quo", trigger: "/" });
    expect(applySlashCommand(editor, "quote", match!)).toBe(true);
    expect(editor.getText().trim()).toBe("");
    expect(editor.isActive("blockquote")).toBe(true);
    editor.destroy();
  });

  it("removes the query and changes the block type", () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "/quote" }] }] },
    });
    editor.commands.setTextSelection(7);
    const match = getSlashCommandMatch(editor);

    expect(match).not.toBeNull();
    expect(applySlashCommand(editor, "quote", match!)).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "blockquote",
      content: [{ type: "paragraph" }],
    });
    editor.destroy();
  });

  it("inserts a database block with an editable paragraph after it", () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "/database" }] }] },
    });
    editor.commands.setTextSelection(10);
    const match = getSlashCommandMatch(editor);

    expect(applySlashCommand(editor, "database", match!)).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["inlineDatabase", "paragraph"]);
    expect(editor.getJSON().content?.[0].attrs?.columns?.[0]).toMatchObject({ name: "Item Name", type: "itemName" });
    editor.destroy();
  });

  it("uses an empty paragraph for a picked block", () => {
    const editor = new Editor({ extensions: editorExtensions, content: { type: "doc", content: [{ type: "paragraph" }] } });
    expect(insertBlockFromPicker(editor, "checklist")).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "taskList", content: [{ type: "taskItem", content: [{ type: "paragraph" }] }] });
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.depth).toBe(3);
    editor.destroy();
  });

  it("inserts a picked block after existing text without changing it", () => {
    const editor = new Editor({ extensions: editorExtensions, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep this" }] }] } });
    editor.commands.setTextSelection(5);
    expect(insertBlockFromPicker(editor, "heading-2")).toBe(true);
    expect(editor.getJSON().content?.slice(0, 2)).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "Keep this" }] },
      { type: "heading", attrs: { level: 2 } },
    ]);
    expect(editor.state.selection.$from.parent.type.name).toBe("heading");
    editor.destroy();
  });

  it("places a picked database after a list and leaves an editable paragraph", () => {
    const editor = new Editor({ extensions: editorExtensions, content: { type: "doc", content: [{ type: "taskList", content: [{ type: "taskItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A task" }] }] }] }] } });
    expect(insertBlockFromPicker(editor, "database")).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["taskList", "inlineDatabase", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    editor.destroy();
  });
});
