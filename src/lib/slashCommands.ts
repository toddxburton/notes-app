import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { newDatabase } from "./database";

export type SlashCommandId = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "checklist" | "quote" | "database";

export type SlashCommandOption = {
  id: SlashCommandId;
  label: string;
  description: string;
  keywords: string[];
};

export type SlashCommandMatch = {
  from: number;
  to: number;
  query: string;
  trigger: "/" | "\\";
};

export const slashCommandOptions: SlashCommandOption[] = [
  {
    id: "database",
    label: "Database",
    description: "Add an editable table of items",
    keywords: ["table", "columns", "rows", "properties"],
  },
  {
    id: "paragraph",
    label: "Body text",
    description: "Write with regular text",
    keywords: ["text", "paragraph", "body"],
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Large section heading",
    keywords: ["title", "header", "large", "h1"],
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Medium section heading",
    keywords: ["subtitle", "header", "medium", "h2"],
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Small section heading",
    keywords: ["subtitle", "header", "small", "h3"],
  },
  {
    id: "checklist",
    label: "Checkbox",
    description: "Track a task to complete",
    keywords: ["check", "checklist", "task", "todo"],
  },
  {
    id: "quote",
    label: "Quote",
    description: "Capture a quotation",
    keywords: ["blockquote", "citation"],
  },
];

export function filterSlashCommands(query: string): SlashCommandOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return slashCommandOptions;
  return slashCommandOptions.filter((option) =>
    [option.label, option.description, ...option.keywords]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
}

export function getSlashCommandMatch(editor: Editor): SlashCommandMatch | null {
  const { selection } = editor.state;
  if (!selection.empty || selection.$from.parent.type.name !== "paragraph") return null;

  const paragraph = selection.$from.parent;
  const cursor = selection.$from.parentOffset;
  let lineStart = 0;
  let lineEnd = paragraph.content.size;
  paragraph.content.forEach((node, offset) => {
    if (node.type.name !== "hardBreak") return;
    if (offset < cursor) lineStart = offset + node.nodeSize;
    else if (lineEnd === paragraph.content.size) lineEnd = offset;
  });
  const textBeforeCursor = paragraph.textBetween(lineStart, cursor, undefined, "\ufffc");
  const trigger = textBeforeCursor[0];
  if ((trigger !== "/" && trigger !== "\\") || paragraph.textBetween(lineStart, lineEnd, undefined, "\ufffc") !== textBeforeCursor) return null;
  const latestSlash = textBeforeCursor.lastIndexOf(trigger);

  return {
    from: selection.$from.start() + lineStart,
    to: selection.from,
    query: textBeforeCursor.slice(latestSlash + 1),
    trigger,
  };
}

export function applySlashCommand(
  editor: Editor,
  commandId: SlashCommandId,
  range: Pick<SlashCommandMatch, "from" | "to">,
): boolean {
  const isolated = isolateSlashLine(editor, range);
  const chain = editor.chain().focus();
  if (!isolated) chain.deleteRange(range);

  switch (commandId) {
    case "paragraph":
      return chain.setParagraph().run();
    case "heading-1":
      return chain.setHeading({ level: 1 }).run();
    case "heading-2":
      return chain.setHeading({ level: 2 }).run();
    case "heading-3":
      return chain.setHeading({ level: 3 }).run();
    case "checklist":
      return chain.toggleTaskList().run();
    case "quote":
      return chain.toggleBlockquote().run();
    case "database":
      return chain.insertContent([{ type: "inlineDatabase", attrs: newDatabase() }, { type: "paragraph" }]).run();
  }
}

function isolateSlashLine(editor: Editor, range: Pick<SlashCommandMatch, "from" | "to">): boolean {
  const { $from } = editor.state.selection;
  if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") return false;
  const paragraph = $from.parent;
  const lineStart = range.from - $from.start();
  let lineEnd = paragraph.content.size;
  paragraph.content.forEach((node, offset) => {
    if (node.type.name === "hardBreak" && offset >= range.to - $from.start() && lineEnd === paragraph.content.size) lineEnd = offset;
  });
  if (!lineStart && lineEnd === paragraph.content.size) return false;

  const paragraphType = editor.schema.nodes.paragraph;
  const before = lineStart ? paragraphType.create(paragraph.attrs, paragraph.content.cut(0, lineStart - 1)) : null;
  const after = lineEnd < paragraph.content.size
    ? paragraphType.create(paragraph.attrs, paragraph.content.cut(lineEnd + 1))
    : null;
  const blockStart = $from.before(1);
  const transaction = editor.state.tr.replaceWith(
    blockStart,
    blockStart + paragraph.nodeSize,
    [before, paragraphType.create(paragraph.attrs), after].filter((node) => node !== null),
  );
  transaction.setSelection(TextSelection.create(transaction.doc, blockStart + (before?.nodeSize ?? 0) + 1));
  editor.view.dispatch(transaction);
  return true;
}

export function insertBlockFromPicker(editor: Editor, commandId: SlashCommandId): boolean {
  const { doc, selection } = editor.state;
  const topLevelStart = selection.$from.before(1);
  const currentBlock = doc.nodeAt(topLevelStart);
  if (!currentBlock) return false;

  const content = commandId === "database"
    ? [{ type: "inlineDatabase", attrs: newDatabase() }, { type: "paragraph" }]
    : commandId === "checklist"
      ? [{ type: "taskList", content: [{ type: "taskItem", content: [{ type: "paragraph" }] }] }]
      : commandId === "quote"
        ? [{ type: "blockquote", content: [{ type: "paragraph" }] }]
        : [{ type: commandId === "paragraph" ? "paragraph" : "heading", attrs: commandId === "paragraph" ? undefined : { level: Number(commandId.slice(-1)) } }];

  const replaceEmptyParagraph = currentBlock.type.name === "paragraph" && currentBlock.content.size === 0;
  if (replaceEmptyParagraph && commandId === "paragraph") return editor.chain().focus().run();
  const from = replaceEmptyParagraph ? topLevelStart : topLevelStart + currentBlock.nodeSize;
  const to = replaceEmptyParagraph ? topLevelStart + currentBlock.nodeSize : from;
  if (!editor.chain().insertContentAt({ from, to }, content).run()) return false;
  const insertedNode = editor.state.doc.nodeAt(from);
  if (!insertedNode) return false;
  let cursor = from + insertedNode.nodeSize + 1;
  if (commandId !== "database") {
    editor.state.doc.nodesBetween(from, from + insertedNode.nodeSize, (node, position) => {
      if (node.isTextblock) {
        cursor = position + 1;
        return false;
      }
      return true;
    });
  }
  return editor.chain().setTextSelection(cursor).focus().run();
}
