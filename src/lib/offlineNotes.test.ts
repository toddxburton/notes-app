import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { NoteDocument, WorkspaceData } from "../types";

const mock = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("./supabase", () => ({ get supabase() { return mock.client; } }));
import { pendingOfflineCount, queueOfflineNote, readOfflineWorkspace, saveOfflineWorkspace, syncOfflineNotes } from "./offlineNotes";

const ownerId = "11111111-1111-4111-8111-111111111111";
const blank = { type: "doc", content: [{ type: "paragraph" }] };
function note(id: string, title = "First", revision = 1): NoteDocument {
  return { id, owner_id: ownerId, title, content_json: blank, plain_text: title, revision,
    created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z",
    deleted_at: null, archived_at: null, project_id: null, sort_order: 0 };
}
function workspace(documents: NoteDocument[]): WorkspaceData {
  return { documents, projects: [], comments: [], replies: [], notifications: [], displayName: "You" };
}

function client(rows: Map<string, NoteDocument>) {
  return { from: (table: string) => {
    expect(table).toBe("documents");
    return {
      insert: (input: Partial<NoteDocument>) => ({ select: () => ({ single: async () => {
        if (rows.has(input.id!)) return { data: null, error: new Error("duplicate") };
        const created = { ...note(input.id!), ...input } as NoteDocument;
        rows.set(created.id, created);
        return { data: created, error: null };
      } }) }),
      update: (input: Partial<NoteDocument>) => {
        const filters: Record<string, unknown> = {};
        const query = { eq: (key: string, value: unknown) => { filters[key] = value; return query; },
          is: () => query, select: () => ({ maybeSingle: async () => {
            const existing = rows.get(filters.id as string);
            if (!existing || existing.revision !== filters.revision) return { data: null, error: null };
            const updated = { ...existing, ...input, revision: existing.revision + 1 };
            rows.set(updated.id, updated);
            return { data: updated, error: null };
          } }) };
        return query;
      },
      select: () => {
        let id = "";
        const query = { eq: (_key: string, value: string) => { id = value; return query; },
          maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null }) };
        return query;
      },
    };
  } };
}

describe("offline note queue", () => {
  beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); mock.client = null; });

  it("keeps new notes and edits in owner-scoped device storage", async () => {
    await saveOfflineWorkspace(ownerId, workspace([]), null);
    const created = note("22222222-2222-4222-8222-222222222222");
    await queueOfflineNote(ownerId, created, true);
    await queueOfflineNote(ownerId, { ...created, title: "Changed" });
    expect((await readOfflineWorkspace(ownerId))?.data.documents[0].title).toBe("Changed");
    expect(await pendingOfflineCount(ownerId)).toBe(1);
    expect(await readOfflineWorkspace("another-owner")).toBeNull();
  });

  it("uploads a new note once and clears its queue entry", async () => {
    const rows = new Map<string, NoteDocument>();
    mock.client = client(rows);
    const created = note("33333333-3333-4333-8333-333333333333");
    await saveOfflineWorkspace(ownerId, workspace([]), null);
    await queueOfflineNote(ownerId, created, true);
    const result = await syncOfflineNotes(ownerId);
    expect(result.pending).toBe(0);
    expect(rows.get(created.id)?.title).toBe("First");
    expect((await syncOfflineNotes(ownerId)).saved).toEqual([]);
  });

  it("preserves a newer server note and uploads the offline edit as a conflict copy", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const rows = new Map([[id, note(id, "Server edit", 2)]]);
    mock.client = client(rows);
    await saveOfflineWorkspace(ownerId, workspace([note(id)]), id);
    await queueOfflineNote(ownerId, note(id, "Phone edit"));
    const result = await syncOfflineNotes(ownerId);
    expect(rows.get(id)?.title).toBe("Server edit");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].title).toBe("Phone edit (offline conflict)");
    expect(result.pending).toBe(0);
    expect((await readOfflineWorkspace(ownerId))?.data.documents.find((item) => item.id === id)?.title).toBe("Server edit");
  });
});
