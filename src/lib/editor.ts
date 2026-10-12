import { Mark, mergeAttributes, type JSONContent } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { generateHTML, generateJSON } from "@tiptap/html";
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

export const editorExtensions = [
  StarterKit.configure({ link: false }),
  Link.configure({ openOnClick: false, autolink: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: "Start writing…" }),
  CommentAnchor,
  InlineDatabase,
];

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
      ? [{ type: "text", text: paragraph.replace(/\n/g, " ") }]
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
