import type { JSONContent } from "@tiptap/core";
import { supabase } from "./supabase";
import type {
  CommentReply,
  CommentStatus,
  CommentThread,
  NoteDocument,
  NoteProject,
  WorkspaceBackup,
  WorkspaceData,
} from "../types";

const LOCAL_KEY = "margin-cloud-workspace-v1";
const DRAFT_KEY = "margin-document-drafts-v1";
const LOCAL_USER_ID = "local-user";

interface StoredDraft {
  document: NoteDocument;
  saved_at: string;
}

function now() {
  return new Date().toISOString();
}

function localEmpty(): WorkspaceData {
  return { projects: [], documents: [], comments: [], replies: [], displayName: "You" };
}

function readLocal(): WorkspaceData {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return localEmpty();
  try {
    return { ...localEmpty(), ...(JSON.parse(raw) as WorkspaceData) };
  } catch {
    return localEmpty();
  }
}

function writeLocal(data: WorkspaceData) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

function readDrafts(): Record<string, StoredDraft> {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, StoredDraft>;
  } catch {
    return {};
  }
}

function overlayDrafts(documents: NoteDocument[], userId: string): NoteDocument[] {
  const drafts = readDrafts();
  return documents
    .map((document) => {
      const draft = drafts[document.id]?.document;
      return draft?.owner_id === userId
        ? { ...document, ...draft, revision: document.revision }
        : document;
    })
    .filter((document) => !document.deleted_at);
}

export function saveDocumentDraft(document: NoteDocument): void {
  const drafts = readDrafts();
  drafts[document.id] = { document, saved_at: now() };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}

export function clearDocumentDraft(documentId: string): void {
  const drafts = readDrafts();
  if (!drafts[documentId]) return;
  delete drafts[documentId];
  if (Object.keys(drafts).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  else localStorage.removeItem(DRAFT_KEY);
}

export function getDocumentDrafts(userId?: string | null): NoteDocument[] {
  const ownerId = userId ?? LOCAL_USER_ID;
  return Object.values(readDrafts())
    .map((draft) => draft.document)
    .filter((document) => document.owner_id === ownerId);
}

function requireUserId(userId?: string | null): string {
  if (supabase && !userId) throw new Error("Sign in before changing this workspace.");
  return userId ?? LOCAL_USER_ID;
}

function randomId() {
  return crypto.randomUUID();
}

export async function loadWorkspace(userId?: string | null): Promise<WorkspaceData> {
  if (!supabase) {
    const data = readLocal();
    return { ...data, documents: overlayDrafts(data.documents, LOCAL_USER_ID) };
  }
  requireUserId(userId);

  const [projectsResult, documentsResult, commentsResult, repliesResult, settingsResult] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: true }),
    supabase.from("documents").select("*").is("deleted_at", null).order("updated_at", { ascending: false }),
    supabase.from("comments").select("*").order("created_at", { ascending: true }),
    supabase.from("comment_replies").select("*").order("created_at", { ascending: true }),
    supabase.from("workspace_settings").select("display_name").maybeSingle(),
  ]);

  const error = projectsResult.error ?? documentsResult.error ?? commentsResult.error ?? repliesResult.error ?? settingsResult.error;
  if (error) throw error;

  return {
    projects: (projectsResult.data ?? []) as NoteProject[],
    documents: overlayDrafts((documentsResult.data ?? []) as NoteDocument[], requireUserId(userId)),
    comments: (commentsResult.data ?? []) as CommentThread[],
    replies: (repliesResult.data ?? []) as CommentReply[],
    displayName: settingsResult.data?.display_name ?? "You",
  };
}

export async function createDocument(
  userId: string | null | undefined,
  title: string,
  contentJson: JSONContent,
  plainText: string,
  projectId: string | null = null,
): Promise<NoteDocument> {
  const ownerId = requireUserId(userId);
  if (!supabase) {
    const timestamp = now();
    const document: NoteDocument = {
      id: randomId(), owner_id: ownerId, title, content_json: contentJson, plain_text: plainText,
      revision: 1, created_at: timestamp, updated_at: timestamp, deleted_at: null, project_id: projectId,
    };
    const data = readLocal();
    data.documents.unshift(document);
    writeLocal(data);
    return document;
  }

  const { data, error } = await supabase.from("documents").insert({
    owner_id: ownerId,
    title,
    content_json: contentJson,
    plain_text: plainText,
    project_id: projectId,
  }).select().single();
  if (error) throw error;
  return data as NoteDocument;
}

export async function createProject(
  userId: string | null | undefined,
  name: string,
): Promise<NoteProject> {
  const ownerId = requireUserId(userId);
  const timestamp = now();
  const project: NoteProject = { id: randomId(), owner_id: ownerId, name, created_at: timestamp, updated_at: timestamp };
  if (!supabase) {
    const data = readLocal();
    data.projects.push(project);
    writeLocal(data);
    return project;
  }
  const { id: _id, created_at: _created, updated_at: _updated, ...insert } = project;
  const { data, error } = await supabase.from("projects").insert(insert).select().single();
  if (error) throw error;
  return data as NoteProject;
}

export async function renameProject(
  userId: string | null | undefined,
  projectId: string,
  name: string,
): Promise<NoteProject> {
  requireUserId(userId);
  if (!supabase) {
    const data = readLocal();
    const index = data.projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new Error("Project not found.");
    data.projects[index] = { ...data.projects[index], name, updated_at: now() };
    writeLocal(data);
    return data.projects[index];
  }
  const { data, error } = await supabase.from("projects").update({ name }).eq("id", projectId).select().single();
  if (error) throw error;
  return data as NoteProject;
}

export async function updateDocument(
  userId: string | null | undefined,
  documentId: string,
  updates: Partial<Pick<NoteDocument, "title" | "content_json" | "plain_text" | "deleted_at" | "project_id">>,
): Promise<NoteDocument> {
  requireUserId(userId);
  if (!supabase) {
    const data = readLocal();
    const index = data.documents.findIndex((item) => item.id === documentId);
    if (index < 0) throw new Error("Document not found.");
    data.documents[index] = {
      ...data.documents[index],
      ...updates,
      revision: data.documents[index].revision + 1,
      updated_at: now(),
    };
    writeLocal(data);
    return data.documents[index];
  }

  const { data, error } = await supabase.from("documents")
    .update(updates)
    .eq("id", documentId)
    .select()
    .single();
  if (error) throw error;
  return data as NoteDocument;
}

export async function createComment(
  userId: string | null | undefined,
  input: Pick<CommentThread, "document_id" | "body" | "exact_quote"> &
    Partial<Pick<CommentThread, "occurrence" | "prefix" | "suffix" | "author_name">>,
): Promise<CommentThread> {
  const ownerId = requireUserId(userId);
  const timestamp = now();
  const comment: CommentThread = {
    id: randomId(), owner_id: ownerId, document_id: input.document_id, body: input.body,
    exact_quote: input.exact_quote, occurrence: input.occurrence ?? 1, prefix: input.prefix ?? "",
    suffix: input.suffix ?? "", author_name: input.author_name ?? "Codex", status: "open",
    detached: false, created_at: timestamp, updated_at: timestamp,
  };

  if (!supabase) {
    const data = readLocal();
    data.comments.push(comment);
    writeLocal(data);
    return comment;
  }

  const { id: _id, created_at: _created, updated_at: _updated, ...insert } = comment;
  const { data, error } = await supabase.from("comments").insert(insert).select().single();
  if (error) throw error;
  return data as CommentThread;
}

export async function replyToComment(
  userId: string | null | undefined,
  commentId: string,
  body: string,
  authorName = "Codex",
): Promise<CommentReply> {
  const ownerId = requireUserId(userId);
  const reply: CommentReply = {
    id: randomId(), comment_id: commentId, owner_id: ownerId, body,
    author_name: authorName, created_at: now(),
  };
  if (!supabase) {
    const data = readLocal();
    data.replies.push(reply);
    writeLocal(data);
    return reply;
  }

  const { id: _id, created_at: _created, ...insert } = reply;
  const { data, error } = await supabase.from("comment_replies").insert(insert).select().single();
  if (error) throw error;
  return data as CommentReply;
}

export async function setCommentStatus(
  userId: string | null | undefined,
  commentId: string,
  status: CommentStatus,
): Promise<CommentThread> {
  requireUserId(userId);
  if (!supabase) {
    const data = readLocal();
    const index = data.comments.findIndex((comment) => comment.id === commentId);
    if (index < 0) throw new Error("Comment not found.");
    data.comments[index] = { ...data.comments[index], status, updated_at: now() };
    writeLocal(data);
    return data.comments[index];
  }

  const { data, error } = await supabase.from("comments")
    .update({ status })
    .eq("id", commentId)
    .select()
    .single();
  if (error) throw error;
  return data as CommentThread;
}

export async function saveDisplayName(userId: string | null | undefined, displayName: string): Promise<void> {
  const ownerId = requireUserId(userId);
  if (!supabase) {
    const data = readLocal();
    data.displayName = displayName;
    writeLocal(data);
    return;
  }

  const { error } = await supabase.from("workspace_settings").upsert({
    user_id: ownerId,
    display_name: displayName,
  });
  if (error) throw error;
}

export function createBackup(data: WorkspaceData): WorkspaceBackup {
  return {
    format: "margin-workspace",
    version: 1,
    exported_at: now(),
    display_name: data.displayName,
    projects: data.projects,
    documents: data.documents,
    comments: data.comments,
    replies: data.replies,
  };
}

export async function saveCloudBackup(
  userId: string | null | undefined,
  backup: WorkspaceBackup,
): Promise<void> {
  if (!supabase) return;
  const ownerId = requireUserId(userId);
  const { error } = await supabase.from("workspace_backups").insert({
    owner_id: ownerId,
    format_version: backup.version,
    payload: backup,
  });
  if (error) throw error;
}

export async function needsDailyBackup(userId: string | null | undefined): Promise<boolean> {
  if (!supabase) return false;
  requireUserId(userId);
  const { data, error } = await supabase.from("workspace_backups")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return true;
  return Date.now() - new Date(data.created_at).getTime() > 24 * 60 * 60 * 1000;
}

export async function restoreBackup(
  userId: string | null | undefined,
  backup: WorkspaceBackup,
): Promise<void> {
  if (backup.format !== "margin-workspace" || backup.version !== 1) {
    throw new Error("This is not a supported Notes workspace backup.");
  }
  const ownerId = requireUserId(userId);
  if (!supabase) {
    writeLocal({
      projects: (backup.projects ?? []).map((item) => ({ ...item, owner_id: ownerId })),
      documents: backup.documents.map((item) => ({ ...item, owner_id: ownerId })),
      comments: backup.comments.map((item) => ({ ...item, owner_id: ownerId })),
      replies: backup.replies.map((item) => ({ ...item, owner_id: ownerId })),
      displayName: backup.display_name,
    });
    return;
  }

  const documents = backup.documents.map(({ revision: _revision, ...item }) => ({
    ...item,
    owner_id: ownerId,
  }));
  const comments = backup.comments.map((item) => ({ ...item, owner_id: ownerId }));
  const replies = backup.replies.map((item) => ({ ...item, owner_id: ownerId }));

  if (backup.projects?.length) {
    const projectResult = await supabase.from("projects").upsert(
      backup.projects.map((item) => ({ ...item, owner_id: ownerId })),
      { onConflict: "id" },
    );
    if (projectResult.error) throw projectResult.error;
  }

  const documentResult = await supabase.from("documents").upsert(documents, { onConflict: "id" });
  if (documentResult.error) throw documentResult.error;
  const commentResult = await supabase.from("comments").upsert(comments, { onConflict: "id" });
  if (commentResult.error) throw commentResult.error;
  const replyResult = await supabase.from("comment_replies").upsert(replies, { onConflict: "id" });
  if (replyResult.error) throw replyResult.error;
  await saveDisplayName(ownerId, backup.display_name);
  await saveCloudBackup(ownerId, backup);
}
