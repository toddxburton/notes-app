import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDocumentDraft,
  createBackup,
  createComment,
  createDocument,
  loadWorkspace,
  markNotificationsRead,
  replyToComment,
  saveDocumentDraft,
  updateDocument,
  updateDocumentLayout,
  updateNotification,
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
    const backup = createBackup({ projects: [], documents: [], comments: [], replies: [], notifications: [], displayName: "Todd" });

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

  it("persists note ordering and project moves", async () => {
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const first = await createDocument(null, "First", content, "", null, 0);
    const second = await createDocument(null, "Second", content, "", null, 1);

    await updateDocumentLayout(null, [
      { id: second.id, project_id: "project-1", sort_order: 0 },
      { id: first.id, project_id: null, sort_order: 0 },
    ]);

    const workspace = await loadWorkspace(null);
    expect(workspace.documents.find((document) => document.id === second.id)).toMatchObject({
      project_id: "project-1",
      sort_order: 0,
    });
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

  it("queues one notification per mentioned handle and tracks its lifecycle", async () => {
    const comment = await createComment(null, {
      document_id: "document-1",
      body: "Please have @GPT review this with @gpt, then tell @todd.",
      exact_quote: "review this",
    });
    const workspace = await loadWorkspace(null);

    expect(workspace.notifications).toHaveLength(2);
    expect(workspace.notifications.map((notification) => notification.recipient_handle).sort())
      .toEqual(["gpt", "todd"]);

    const gptNotification = workspace.notifications.find((notification) => notification.recipient_handle === "gpt")!;
    const acknowledged = await updateNotification(null, gptNotification.id, {
      acknowledged_at: new Date().toISOString(),
      plan_id: "plan-1",
    });
    expect(acknowledged).toMatchObject({ comment_id: comment.id, plan_id: "plan-1" });

    const [read] = await markNotificationsRead(null, [gptNotification.id]);
    expect(read.read_at).not.toBeNull();
  });

  it("queues reply mentions against the original comment", async () => {
    const comment = await createComment(null, {
      document_id: "document-1",
      body: "Initial request",
      exact_quote: "request",
    });
    const reply = await replyToComment(null, comment.id, "Done, @todd.");
    const [notification] = (await loadWorkspace(null)).notifications;

    expect(notification).toMatchObject({
      comment_id: comment.id,
      source_reply_id: reply.id,
      recipient_handle: "todd",
    });
  });
});
