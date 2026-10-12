import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./editor";
import {
  applySlashCommand,
  filterSlashCommands,
  getSlashCommandMatch,
} from "./slashCommands";

describe("slash commands", () => {
  it("only matches slash text at the beginning of an empty paragraph", () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "/hea" }] }] },
    });
    editor.commands.setTextSelection(5);

    expect(getSlashCommandMatch(editor)).toEqual({ from: 1, to: 5, query: "hea" });

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
    expect(match).toEqual({ from: 1, to: 10, query: "quo" });
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
});
