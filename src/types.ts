import type { JSONContent } from "@tiptap/core";

export type CommentStatus = "open" | "resolved";

export interface NoteDocument {
  id: string;
  owner_id: string;
  title: string;
  content_json: JSONContent;
  plain_text: string;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  project_id: string | null;
  sort_order: number;
}

export interface NoteProject {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CommentThread {
  id: string;
  document_id: string;
  owner_id: string;
  body: string;
  exact_quote: string;
  occurrence: number;
  prefix: string;
  suffix: string;
  author_name: string;
  status: CommentStatus;
  detached: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentReply {
  id: string;
  comment_id: string;
  owner_id: string;
  body: string;
  author_name: string;
  created_at: string;
}

export interface WorkspaceData {
  projects: NoteProject[];
  documents: NoteDocument[];
  comments: CommentThread[];
  replies: CommentReply[];
  displayName: string;
}

export interface WorkspaceBackup {
  format: "margin-workspace";
  version: 1;
  exported_at: string;
  display_name: string;
  projects?: NoteProject[];
  documents: NoteDocument[];
  comments: CommentThread[];
  replies: CommentReply[];
}
