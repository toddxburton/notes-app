import type { Editor } from "@tiptap/core";

export type SlashCommandId = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "checklist" | "quote";

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
};

export const slashCommandOptions: SlashCommandOption[] = [
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

  const textBeforeCursor = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, "\ufffc");
  if (!textBeforeCursor.startsWith("/") || selection.$from.parent.textContent !== textBeforeCursor) return null;
  const latestSlash = textBeforeCursor.lastIndexOf("/");

  return {
    from: selection.$from.start(),
    to: selection.from,
    query: textBeforeCursor.slice(latestSlash + 1),
  };
}

export function applySlashCommand(
  editor: Editor,
  commandId: SlashCommandId,
  range: Pick<SlashCommandMatch, "from" | "to">,
): boolean {
  const chain = editor.chain().focus().deleteRange(range);

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
  }
}
