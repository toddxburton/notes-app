import type { NoteDocument } from "../types";

export function nextTopSortOrder(
  documents: NoteDocument[],
  projectId: string | null,
): number {
  const group = documents.filter((document) => document.project_id === projectId);
  return group.length
    ? Math.min(...group.map((document) => document.sort_order ?? 0)) - 1
    : 0;
}
