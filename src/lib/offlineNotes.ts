import type { NoteDocument, WorkspaceData } from "../types";
import { supabase } from "./supabase";

type PendingNote = {
  document: NoteDocument;
  baseRevision: number | null;
  changedAt: number;
  conflictId: string;
};
type OfflineWorkspace = {
  ownerId: string;
  data: WorkspaceData;
  activeId: string | null;
  pending: Record<string, PendingNote>;
};

const DB_NAME = "noted-offline-v1";
const STORE = "workspaces";
let writes: Promise<unknown> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      for (const name of [STORE, "based-views"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "ownerId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read(ownerId: string): Promise<OfflineWorkspace | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(ownerId);
      request.onsuccess = () => resolve((request.result as OfflineWorkspace | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function write(value: OfflineWorkspace): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = writes.then(task, task);
  writes = next.catch(() => undefined);
  return next;
}

export async function readOfflineWorkspace(ownerId: string): Promise<OfflineWorkspace | null> {
  await writes;
  const value = await read(ownerId);
  if (!value) return null;
  return {
    ...value,
    data: { ...value.data, documents: value.data.documents.map((document) =>
      value.pending[document.id]?.document ?? document).concat(
        Object.values(value.pending).filter(({ document }) => !value.data.documents.some((item) => item.id === document.id))
          .map(({ document }) => document)) },
  };
}

export function saveOfflineWorkspace(ownerId: string, data: WorkspaceData, activeId: string | null): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return serialized(async () => {
    const previous = await read(ownerId);
    const pending = previous?.pending ?? {};
    const merged = data.documents.map((document) => pending[document.id]?.document ?? document);
    for (const entry of Object.values(pending)) {
      if (!merged.some((document) => document.id === entry.document.id)) merged.unshift(entry.document);
    }
    await write({ ownerId, data: { ...data, documents: merged }, activeId, pending });
  });
}

export function queueOfflineNote(ownerId: string, document: NoteDocument, isNew = false): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Offline storage is unavailable."));
  return serialized(async () => {
    const current = await read(ownerId) ?? {
      ownerId, activeId: document.id, pending: {},
      data: { documents: [document], projects: [], comments: [], replies: [], notifications: [], displayName: "You" },
    } satisfies OfflineWorkspace;
    const previous = current.pending[document.id];
    current.pending[document.id] = {
      document,
      baseRevision: previous ? previous.baseRevision : isNew ? null : document.revision,
      changedAt: Math.max(Date.now(), (previous?.changedAt ?? 0) + 1),
      conflictId: previous?.conflictId ?? crypto.randomUUID(),
    };
    current.data.documents = current.data.documents.some((item) => item.id === document.id)
      ? current.data.documents.map((item) => item.id === document.id ? document : item)
      : [document, ...current.data.documents];
    current.activeId = document.id;
    await write(current);
  });
}

export async function pendingOfflineCount(ownerId: string): Promise<number> {
  await writes;
  return Object.keys((await read(ownerId))?.pending ?? {}).length;
}

export type SyncResult = { saved: NoteDocument[]; conflicts: NoteDocument[]; conflictSourceIds: string[]; pending: number };

export async function syncOfflineNotes(ownerId: string): Promise<SyncResult> {
  if (!supabase) return { saved: [], conflicts: [], conflictSourceIds: [], pending: 0 };
  await writes;
  const entries = Object.values((await read(ownerId))?.pending ?? {});
  const saved: NoteDocument[] = [];
  const conflicts: NoteDocument[] = [];
  const conflictSourceIds: string[] = [];
  for (const entry of entries) {
    const { document, baseRevision } = entry;
    const title = document.title.trim() || "Untitled note";
    let result: NoteDocument;
    let conflict = false;
    let remoteDocument: NoteDocument | null = null;
    if (baseRevision === null) {
      const { data, error } = await supabase.from("documents").insert({
        id: document.id, owner_id: ownerId, title, content_json: document.content_json,
        plain_text: document.plain_text, project_id: document.project_id, sort_order: document.sort_order,
      }).select().single();
      if (error) {
        const existing = await supabase.from("documents").select("*").eq("id", document.id).maybeSingle();
        if (!existing.data) throw error;
        result = existing.data as NoteDocument;
      } else result = data as NoteDocument;
    } else {
      const { data, error } = await supabase.from("documents")
        .update({ title, content_json: document.content_json, plain_text: document.plain_text })
        .eq("id", document.id).eq("owner_id", ownerId).eq("revision", baseRevision)
        .is("deleted_at", null).select().maybeSingle();
      if (error) throw error;
      if (data) result = data as NoteDocument;
      else {
        const remote = await supabase.from("documents").select("*").eq("id", document.id).maybeSingle();
        if (remote.error) throw remote.error;
        remoteDocument = remote.data as NoteDocument | null;
        if (remote.data && remote.data.title === title &&
            JSON.stringify(remote.data.content_json) === JSON.stringify(document.content_json)) {
          result = remote.data as NoteDocument;
        } else {
          const copyTitle = `${title.slice(0, 155)} (offline conflict)`;
          const copy = await supabase.from("documents").insert({
            id: entry.conflictId, owner_id: ownerId, title: copyTitle,
            content_json: document.content_json, plain_text: document.plain_text,
            project_id: document.project_id, sort_order: document.sort_order,
          }).select().single();
          if (copy.error) {
            const existing = await supabase.from("documents").select("*").eq("id", entry.conflictId).maybeSingle();
            if (!existing.data) throw copy.error;
            result = existing.data as NoteDocument;
          } else result = copy.data as NoteDocument;
          conflict = true;
        }
      }
    }
    await serialized(async () => {
      const current = await read(ownerId);
      if (!current) return;
      const latest = current.pending[document.id];
      if (!latest) return;
      if (latest.changedAt === entry.changedAt) delete current.pending[document.id];
      else if (conflict) {
        // The editor changed during upload. Keep those changes queued against the copy.
        delete current.pending[document.id];
        current.pending[result.id] = { ...latest, document: { ...latest.document, id: result.id }, baseRevision: result.revision };
      } else latest.baseRevision = result.revision;
      current.data.documents = current.data.documents.map((item) => {
        if (item.id !== document.id) return item;
        if (conflict) return remoteDocument ?? item;
        return current.pending[document.id] ? item : result;
      });
      if (conflict && !current.data.documents.some((item) => item.id === result.id)) {
        current.data.documents.unshift(current.pending[result.id]?.document ?? result);
      }
      await write(current);
    });
    (conflict ? conflicts : saved).push(result);
    if (conflict) conflictSourceIds.push(document.id);
  }
  return { saved, conflicts, conflictSourceIds, pending: await pendingOfflineCount(ownerId) };
}
