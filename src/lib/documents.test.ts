import { describe, expect, it } from "vitest";
import { isAvailableDocument, nextTopSortOrder } from "./documents";
import type { NoteDocument, NoteProject } from "../types";

function document(projectId: string | null, sortOrder: number): NoteDocument {
  return {
    id: crypto.randomUUID(),
    owner_id: "owner",
    title: "Note",
    content_json: { type: "doc" },
    plain_text: "",
    revision: 1,
    created_at: "2026-09-14T00:00:00.000Z",
    updated_at: "2026-09-14T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    project_id: projectId,
    sort_order: sortOrder,
  };
}

describe("document ordering", () => {
  it("places a new ungrouped note before every existing ungrouped note", () => {
    const documents = [document(null, 0), document(null, 3), document("project-1", -5)];

    expect(nextTopSortOrder(documents, null)).toBe(-1);
  });

  it("uses only the destination project when choosing the top position", () => {
    const documents = [document(null, -10), document("project-1", 2), document("project-1", 4)];

    expect(nextTopSortOrder(documents, "project-1")).toBe(1);
    expect(nextTopSortOrder(documents, "empty-project")).toBe(0);
  });
});

describe("available documents", () => {
  it("hides an archived note and notes inside archived projects", () => {
    const active = document("project-1", 0);
    const archivedNote = { ...document(null, 1), archived_at: "2026-10-11T00:00:00.000Z" };
    const archivedProject: NoteProject = {
      id: "project-1", owner_id: "owner", name: "Archived", sort_order: 0,
      collapsed: false, archived_at: "2026-10-11T00:00:00.000Z",
      created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:00:00.000Z",
    };

    expect(isAvailableDocument(active, [archivedProject])).toBe(false);
    expect(isAvailableDocument(archivedNote, [])).toBe(false);
    expect(isAvailableDocument(document(null, 2), [archivedProject])).toBe(true);
  });
});
