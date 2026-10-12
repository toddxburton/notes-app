import type { NoteDocument, NoteProject } from "../types";

export function isAvailableDocument(document: NoteDocument, projects: NoteProject[]): boolean {
  return !document.deleted_at && !document.archived_at
    && !projects.some((project) => project.id === document.project_id && Boolean(project.archived_at));
}

export function nextTopSortOrder(
  documents: NoteDocument[],
  projectId: string | null,
): number {
  const group = documents.filter((document) => document.project_id === projectId);
  return group.length
    ? Math.min(...group.map((document) => document.sort_order ?? 0)) - 1
    : 0;
}
