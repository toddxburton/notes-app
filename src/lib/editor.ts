import { Extension, Mark, mergeAttributes, type Editor, type JSONContent } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { generateHTML, generateJSON } from "@tiptap/html";
import { closeHistory } from "@tiptap/pm/history";
import { Selection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { InlineDatabase } from "./database";

export const CommentAnchor = Mark.create({
  name: "commentAnchor",
  inclusive: false,
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) => ({ "data-comment-id": attributes.commentId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "comment-anchor" }),
      0,
    ];
  },
});

const ParagraphLineBreaks = Extension.create({
  name: "paragraphLineBreaks",
  priority: 1000,
  addKeyboardShortcuts() {
    const inBodyParagraph = () => {
      const { $from, $to } = this.editor.state.selection;
      return $from.depth === 1 && $from.sameParent($to) && $from.parent.type.name === "paragraph";
    };
    return {
      Enter: () => inBodyParagraph() && this.editor.commands.setHardBreak(),
      "Shift-Enter": () => inBodyParagraph() && this.editor.commands.splitBlock(),
    };
  },
});

export const editorExtensions = [
  StarterKit.configure({ link: false }),
  ParagraphLineBreaks,
  Link.configure({ openOnClick: false, autolink: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: "Start writing…" }),
  CommentAnchor,
  InlineDatabase,
];

export function changeSelectedBlock(editor: Editor, value: string, selectedRange?: { from: number; to: number }): boolean {
  if (selectedRange) editor.commands.setTextSelection(selectedRange);
  if (value.startsWith("heading-") && headingSelectedLines(editor, Number(value.slice(-1)) as 1 | 2 | 3)) return true;
  if (["bulletList", "orderedList", "taskList"].includes(value) && listSelectedLines(editor, value)) return true;
  const chain = editor.chain().focus();
  const activeList = editor.isActive("bulletList") ? "bulletList" : editor.isActive("orderedList") ? "orderedList" : editor.isActive("taskList") ? "taskList" : null;
  const activeQuote = editor.isActive("blockquote");
  if (activeList && activeList !== value) {
    if (activeList === "bulletList") chain.toggleBulletList();
    else if (activeList === "orderedList") chain.toggleOrderedList();
    else chain.toggleTaskList();
  }
  if (activeQuote && value !== "blockquote") chain.toggleBlockquote();
  if (value === "paragraph" && !activeList) chain.setParagraph();
  else if (value.startsWith("heading-")) chain.setHeading({ level: Number(value.slice(-1)) as 1 | 2 | 3 });
  else if (value === "bulletList" && activeList !== value) chain.toggleBulletList();
  else if (value === "orderedList" && activeList !== value) chain.toggleOrderedList();
  else if (value === "taskList" && activeList !== value) chain.toggleTaskList();
  else if (value === "blockquote" && !activeQuote) chain.toggleBlockquote();
  return chain.run();
}

function headingSelectedLines(editor: Editor, level: 1 | 2 | 3): boolean {
  const { selection, schema } = editor.state;
  const { $from, $to } = selection;
  if (selection.empty || $from.depth !== 1 || !$from.sameParent($to) || $from.parent.type.name !== "paragraph") return false;

  const paragraph = $from.parent;
  const lines: Array<{ from: number; to: number }> = [];
  let lineStart = 0;
  paragraph.content.forEach((node, offset) => {
    if (node.type.name === "hardBreak") {
      lines.push({ from: lineStart, to: offset });
      lineStart = offset + node.nodeSize;
    }
  });
  if (!lines.length) return false;
  lines.push({ from: lineStart, to: paragraph.content.size });

  const paragraphStart = $from.start();
  const first = lines.findIndex((line) => paragraphStart + line.from < selection.to && paragraphStart + line.to > selection.from);
  let last = -1;
  lines.forEach((line, index) => {
    if (paragraphStart + line.from < selection.to && paragraphStart + line.to > selection.from) last = index;
  });
  if (first < 0 || last < first) return false;

  const before = first ? schema.nodes.paragraph.create(paragraph.attrs, paragraph.content.cut(0, lines[first].from - 1)) : null;
  const after = last < lines.length - 1
    ? schema.nodes.paragraph.create(paragraph.attrs, paragraph.content.cut(lines[last].to + 1))
    : null;
  const headings = lines.slice(first, last + 1).map((line) =>
    schema.nodes.heading.create({ level }, paragraph.content.cut(line.from, line.to)));
  const blockStart = $from.before(1);
  const transaction = editor.state.tr.replaceWith(
    blockStart, blockStart + paragraph.nodeSize, [before, ...headings, after].filter((node) => node !== null),
  );
  transaction.setSelection(Selection.near(transaction.doc.resolve(blockStart + (before?.nodeSize ?? 0) + 1)));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

function listSelectedLines(editor: Editor, value: string): boolean {
  const { selection, schema } = editor.state;
  const { $from, $to } = selection;
  if (selection.empty || $from.depth !== 1 || !$from.sameParent($to) || $from.parent.type.name !== "paragraph") return false;

  const paragraph = $from.parent;
  const lines: Array<{ from: number; to: number }> = [];
  let lineStart = 0;
  paragraph.content.forEach((node, offset) => {
    if (node.type.name === "hardBreak") {
      lines.push({ from: lineStart, to: offset });
      lineStart = offset + node.nodeSize;
    }
  });
  if (!lines.length) return false;
  lines.push({ from: lineStart, to: paragraph.content.size });

  const paragraphStart = $from.start();
  const first = lines.findIndex((line) => paragraphStart + line.from < selection.to && paragraphStart + line.to > selection.from);
  let last = -1;
  lines.forEach((line, index) => {
    if (paragraphStart + line.from < selection.to && paragraphStart + line.to > selection.from) last = index;
  });
  if (first < 0 || last < first) return false;

  const paragraphType = schema.nodes.paragraph;
  const itemType = schema.nodes[value === "taskList" ? "taskItem" : "listItem"];
  const listType = schema.nodes[value];
  const before = first ? paragraphType.create(paragraph.attrs, paragraph.content.cut(0, lines[first].from - 1)) : null;
  const after = last < lines.length - 1
    ? paragraphType.create(paragraph.attrs, paragraph.content.cut(lines[last].to + 1))
    : null;
  const items = lines.slice(first, last + 1).map((line) => itemType.create(
    value === "taskList" ? { checked: false } : null,
    paragraphType.create(paragraph.attrs, paragraph.content.cut(line.from, line.to)),
  ));
  const list = listType.create(null, items);
  const replacement = [before, list, after].filter((node) => node !== null);
  const blockStart = $from.before(1);
  const transaction = editor.state.tr.replaceWith(blockStart, blockStart + paragraph.nodeSize, replacement);
  transaction.setSelection(Selection.near(transaction.doc.resolve(blockStart + (before?.nodeSize ?? 0) + 3)));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

export function moveTopLevelBlock(editor: Editor, fromIndex: number, beforeIndex: number): boolean {
  const { doc } = editor.state;
  if (!Number.isInteger(fromIndex) || !Number.isInteger(beforeIndex) ||
      fromIndex < 0 || fromIndex >= doc.childCount ||
      beforeIndex < 0 || beforeIndex > doc.childCount ||
      beforeIndex === fromIndex || beforeIndex === fromIndex + 1) return false;

  let from = 0;
  let destination = 0;
  for (let index = 0; index < fromIndex; index++) from += doc.child(index).nodeSize;
  for (let index = 0; index < beforeIndex; index++) destination += doc.child(index).nodeSize;

  const node = doc.child(fromIndex);
  const insertAt = destination > from ? destination - node.nodeSize : destination;
  const transaction = closeHistory(editor.state.tr).delete(from, from + node.nodeSize).insert(insertAt, node);
  transaction.setSelection(Selection.near(transaction.doc.resolve(insertAt + 1)));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

export function markdownToContent(markdown: string): JSONContent {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml);
  const template = window.document.createElement("template");
  template.innerHTML = safeHtml;
  template.content.querySelectorAll<HTMLLIElement>("li").forEach((item) => {
    const checkbox = item.querySelector<HTMLInputElement>(":scope > input[type='checkbox']");
    if (!checkbox) return;
    item.dataset.type = "taskItem";
    item.dataset.checked = String(checkbox.checked);
    checkbox.remove();
    const list = item.parentElement;
    if (list?.tagName === "UL") list.dataset.type = "taskList";
  });
  return generateJSON(template.innerHTML, editorExtensions) as JSONContent;
}

export function plainTextToContent(text: string): JSONContent {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => ({
    type: "paragraph",
    content: paragraph
      ? paragraph.split("\n").flatMap((line, index) => [
        ...(index ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line }] : []),
      ])
      : undefined,
  }));
  return { type: "doc", content: paragraphs.length ? paragraphs : [{ type: "paragraph" }] };
}

export function contentToHtml(content: JSONContent): string {
  return generateHTML(content, editorExtensions);
}

export function contentToPlainText(content: JSONContent): string {
  const blockTypes = new Set([
    "paragraph", "heading", "blockquote", "listItem", "taskItem", "codeBlock",
  ]);
  function visit(node: JSONContent): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "inlineDatabase") {
      const title = String(node.attrs?.title ?? "Untitled database");
      const columns = (node.attrs?.columns ?? []) as { id: string; name: string }[];
      const rows = (node.attrs?.rows ?? []) as { cells: Record<string, string | string[]> }[];
      return `${title}\n${columns.map((column) => column.name).join("\t")}\n${rows.map((row) =>
        columns.map((column) => {
          const value = row.cells[column.id];
          return Array.isArray(value) ? value.join(", ") : value ?? "";
        }).join("\t")).join("\n")}\n`;
    }
    const nested = (node.content ?? []).map(visit).join("");
    return blockTypes.has(node.type ?? "") ? `${nested}\n` : nested;
  }
  return visit(content).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function inputToContent(
  content: string,
  format: "markdown" | "plain_text" = "markdown",
): JSONContent {
  return format === "plain_text" ? plainTextToContent(content) : markdownToContent(content);
}

export const welcomeMarkdown = `Noted is a quiet place for notes, drafts, and decisions.

## Write together, without sending it away

Everything in this workspace is **stored in Supabase**. Your documents and comments stay synchronized wherever you open this workspace.

> Select any words and choose Comment to start a conversation beside the note.

## A small first checklist

- [x] Rename this note from the title above
- [ ] Highlight a sentence and add a comment
- [ ] Open Site tools and invite Codex to review it

When you want a portable copy, export a versioned workspace backup. Importing that file restores documents, comments, identities, and preferences together.

\`Your words stay yours. Your workspace travels with you.\`

Every change creates a revision, and a complete cloud snapshot is saved automatically each day you use the workspace.`;
