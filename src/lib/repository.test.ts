import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDocumentDraft,
  createBackup,
  createDocument,
  loadWorkspace,
  saveDocumentDraft,
  updateDocument,
} from "./repository";

vi.mock("./supabase", () => ({ supabase: null }));

describe("local workspace repository", () => {
  beforeEach(() => localStorage.clear());

  it("creates and revisions documents", async () => {
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const created = await createDocument(null, "Draft", content, "");
    const updated = await updateDocument(null, created.id, { title: "Decision" });
    const workspace = await loadWorkspace(null);

    expect(updated.revision).toBe(2);
    expect(workspace.documents[0].title).toBe("Decision");
  });

  it("exports a complete, versioned workspace snapshot", () => {
    const backup = createBackup({ projects: [], documents: [], comments: [], replies: [], displayName: "Todd" });

    expect(backup).toMatchObject({
      format: "margin-workspace",
      version: 1,
      display_name: "Todd",
      documents: [],
      comments: [],
      replies: [],
    });
    expect(new Date(backup.exported_at).toString()).not.toBe("Invalid Date");
  });

  it("keeps soft-deleted documents out of the active workspace", async () => {
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const created = await createDocument(null, "Temporary", content, "");
    await updateDocument(null, created.id, { deleted_at: new Date().toISOString() });

    expect((await loadWorkspace(null)).documents).toEqual([]);
  });

  it("restores a newer unsynced browser draft", async () => {
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const created = await createDocument(null, "Draft", content, "Original");
    saveDocumentDraft({ ...created, title: "Local title", plain_text: "Unsynced text" });

    const restored = (await loadWorkspace(null)).documents[0];
    expect(restored).toMatchObject({ title: "Local title", plain_text: "Unsynced text" });

    clearDocumentDraft(created.id);
    expect((await loadWorkspace(null)).documents[0].title).toBe("Draft");
  });
});
