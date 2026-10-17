export interface WebMcpApi {
  listProjects: (query?: string, includeArchived?: boolean) => Promise<unknown>;
  createProject: (name: string) => Promise<unknown>;
  listDocuments: (query?: string, limit?: number) => Promise<unknown>;
  getDocument: (documentId: string) => Promise<unknown>;
  openDocument: (documentId: string) => Promise<unknown>;
  createDocument: (title: string, content: string, format: "markdown" | "plain_text") => Promise<unknown>;
  updateDocument: (input: {
    documentId: string;
    title?: string;
    content?: string;
    format: "markdown" | "plain_text";
    mode: "replace" | "append";
  }) => Promise<unknown>;
  listComments: (documentId?: string, status?: "open" | "resolved" | "all") => Promise<unknown>;
  addComment: (input: Record<string, unknown>) => Promise<unknown>;
  replyToComment: (commentId: string, body: string, agentName?: string) => Promise<unknown>;
  setCommentStatus: (commentId: string, status: "open" | "resolved") => Promise<unknown>;
  listNotifications: (recipient?: string, state?: "unread" | "pending" | "planned" | "completed" | "all") => Promise<unknown>;
  acknowledgeNotification: (notificationId: string, planId: string) => Promise<unknown>;
  completeNotification: (notificationId: string) => Promise<unknown>;
  listBasedDatabases: () => Promise<unknown>;
  getBasedDatabase: (databaseId: string) => Promise<unknown>;
  queryBasedRecords: (tableId: string, offset: number, limit: number, search: string) => Promise<unknown>;
  createBasedDatabase: (name: string) => Promise<unknown>;
  createBasedTable: (databaseId: string, name: string) => Promise<unknown>;
  createBasedField: (tableId: string, name: string, type: string, targetTableId?: string, options?: string[]) => Promise<unknown>;
  updateBasedFieldOptions: (fieldId: string, options: string[], mode: "append" | "replace") => Promise<unknown>;
  createBasedRecord: (tableId: string, cells: Record<string, unknown>) => Promise<unknown>;
  updateBasedRecord: (recordId: string, cells: Record<string, unknown>) => Promise<unknown>;
  setBasedLink: (relationId: string, leftRecordId: string, rightRecordId: string, linked: boolean) => Promise<unknown>;
}

function text(input: Record<string, unknown>, key: string, fallback = "") {
  const value = input[key];
  return typeof value === "string" ? value : fallback;
}

export async function registerWebMcpTools(api: WebMcpApi): Promise<boolean> {
  if (document.__marginToolsRegistered || typeof document.modelContext?.registerTool !== "function") {
    return false;
  }
  document.__marginToolsRegistered = true;
  const register = document.modelContext.registerTool.bind(document.modelContext);

  await Promise.all([
    register({
      name: "list_projects",
      description: "List Noted projects by name and ID so notes can be understood in their workspace context.",
      inputSchema: { type: "object", properties: {
        query: { type: "string", maxLength: 200 },
        include_archived: { type: "boolean", default: false },
      }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.listProjects(text(input, "query") || undefined, Boolean(input.include_archived)),
    }),
    register({
      name: "create_project",
      description: "Create a project in this signed-in Noted workspace.",
      inputSchema: { type: "object", properties: {
        name: { type: "string", minLength: 1, maxLength: 180 },
      }, required: ["name"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.createProject(text(input, "name")),
    }),
    register({
      name: "list_documents",
      description: "List documents in this signed-in Noted workspace with each note's project name and ID. Optionally match note titles, text, or project names and return short snippets.",
      inputSchema: { type: "object", properties: {
        query: { type: "string", maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.listDocuments(text(input, "query") || undefined, Number(input.limit ?? 50)),
    }),
    register({
      name: "get_document",
      description: "Get one Noted document as stable rich-text JSON and plain text, with its comment context.",
      inputSchema: { type: "object", properties: { document_id: { type: "string" } }, required: ["document_id"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.getDocument(text(input, "document_id")),
    }),
    register({
      name: "open_document",
      description: "Open an existing note by ID in the Noted editor.",
      inputSchema: { type: "object", properties: { document_id: { type: "string", minLength: 1 } }, required: ["document_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.openDocument(text(input, "document_id")),
    }),
    register({
      name: "create_document",
      description: "Create and open a document. Content accepts lightweight Markdown or plain text and is stored as structured rich text.",
      inputSchema: { type: "object", properties: {
        title: { type: "string", minLength: 1, maxLength: 180 },
        content: { type: "string", maxLength: 100000, default: "" },
        format: { type: "string", enum: ["markdown", "plain_text"], default: "markdown" },
      }, required: ["title"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.createDocument(text(input, "title"), text(input, "content"), text(input, "format", "markdown") as "markdown" | "plain_text"),
    }),
    register({
      name: "update_document",
      description: "Rename or update one Noted document. Replace or append Markdown/plain text; every change creates a revision.",
      inputSchema: { type: "object", properties: {
        document_id: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1, maxLength: 180 },
        content: { type: "string", maxLength: 100000 },
        format: { type: "string", enum: ["markdown", "plain_text"], default: "markdown" },
        mode: { type: "string", enum: ["replace", "append"], default: "replace" },
      }, required: ["document_id"], anyOf: [{ required: ["title"] }, { required: ["content"] }], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.updateDocument({
        documentId: text(input, "document_id"),
        title: typeof input.title === "string" ? input.title : undefined,
        content: typeof input.content === "string" ? input.content : undefined,
        format: text(input, "format", "markdown") as "markdown" | "plain_text",
        mode: text(input, "mode", "replace") as "replace" | "append",
      }),
    }),
    register({
      name: "list_comments",
      description: "List anchored or detached comment threads, filterable by document and status.",
      inputSchema: { type: "object", properties: {
        document_id: { type: "string" },
        status: { type: "string", enum: ["open", "resolved", "all"], default: "open" },
      }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.listComments(text(input, "document_id") || undefined, text(input, "status", "open") as "open" | "resolved" | "all"),
    }),
    register({
      name: "add_comment",
      description: "Add an agent-authored comment anchored by exact quote and semantic context. Ambiguous quotes are never attached arbitrarily.",
      inputSchema: { type: "object", properties: {
        document_id: { type: "string" }, body: { type: "string", minLength: 1, maxLength: 10000 },
        exact_quote: { type: "string", minLength: 1, maxLength: 20000 },
        occurrence: { type: "integer", minimum: 1 }, prefix: { type: "string", maxLength: 500 },
        suffix: { type: "string", maxLength: 500 }, agent_name: { type: "string", default: "Codex", maxLength: 40 },
      }, required: ["document_id", "body", "exact_quote"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.addComment(input),
    }),
    register({
      name: "reply_to_comment",
      description: "Append an agent reply to an existing Noted comment thread.",
      inputSchema: { type: "object", properties: {
        comment_id: { type: "string" }, body: { type: "string", minLength: 1, maxLength: 10000 },
        agent_name: { type: "string", default: "Codex", maxLength: 40 },
      }, required: ["comment_id", "body"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.replyToComment(text(input, "comment_id"), text(input, "body"), text(input, "agent_name", "Codex")),
    }),
    register({
      name: "resolve_comment",
      description: "Mark a Noted comment thread as resolved.",
      inputSchema: { type: "object", properties: { comment_id: { type: "string" } }, required: ["comment_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.setCommentStatus(text(input, "comment_id"), "resolved"),
    }),
    register({
      name: "reopen_comment",
      description: "Reopen a resolved Noted comment thread.",
      inputSchema: { type: "object", properties: { comment_id: { type: "string" } }, required: ["comment_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.setCommentStatus(text(input, "comment_id"), "open"),
    }),
    register({
      name: "list_notifications",
      description: "List durable @mention notifications with source comment and reply context. Defaults to pending @gpt mentions.",
      inputSchema: { type: "object", properties: {
        recipient: { type: "string", pattern: "^[a-z0-9_]{1,40}$", default: "gpt" },
        state: { type: "string", enum: ["unread", "pending", "planned", "completed", "all"], default: "pending" },
      }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.listNotifications(
        text(input, "recipient", "gpt"),
        text(input, "state", "pending") as "unread" | "pending" | "planned" | "completed" | "all",
      ),
    }),
    register({
      name: "acknowledge_notification",
      description: "Mark an @mention as read and added to a specific plan. Reply to the source comment separately so the person is notified.",
      inputSchema: { type: "object", properties: {
        notification_id: { type: "string", minLength: 1 },
        plan_id: { type: "string", minLength: 1, maxLength: 80 },
      }, required: ["notification_id", "plan_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.acknowledgeNotification(text(input, "notification_id"), text(input, "plan_id")),
    }),
    register({
      name: "complete_notification",
      description: "Mark a planned @mention as completed after the requested work and @todd completion reply are both finished.",
      inputSchema: { type: "object", properties: {
        notification_id: { type: "string", minLength: 1 },
      }, required: ["notification_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.completeNotification(text(input, "notification_id")),
    }),
    register({
      name: "list_based_databases", description: "List Based databases, folders, and tables.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => api.listBasedDatabases(),
    }),
    register({
      name: "get_based_database", description: "Get a Based database with its tables, fields, and linked-field relationships.",
      inputSchema: { type: "object", properties: { database_id: { type: "string" } }, required: ["database_id"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.getBasedDatabase(text(input, "database_id")),
    }),
    register({
      name: "query_based_records", description: "Page through Based records, optionally searching cell values.",
      inputSchema: { type: "object", properties: { table_id: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 }, search: { type: "string", maxLength: 200 } }, required: ["table_id"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.queryBasedRecords(text(input, "table_id"), Number(input.offset ?? 0), Number(input.limit ?? 100), text(input, "search")),
    }),
    register({
      name: "create_based_database", description: "Create a Based database with its first table.",
      inputSchema: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 180 } }, required: ["name"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.createBasedDatabase(text(input, "name")),
    }),
    register({
      name: "create_based_table", description: "Create a table in a Based database.",
      inputSchema: { type: "object", properties: { database_id: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 180 } }, required: ["database_id", "name"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.createBasedTable(text(input, "database_id"), text(input, "name")),
    }),
    register({
      name: "create_based_field", description: "Add a typed column. Select columns can include choices; linked records require a target table in the same database.",
      inputSchema: { type: "object", properties: { table_id: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 180 }, type: { type: "string", enum: ["text", "number", "date", "singleSelect", "multiSelect", "url", "checkbox", "linkedRecord"] }, target_table_id: { type: "string" }, options: { type: "array", items: { type: "string", minLength: 1, maxLength: 180 }, maxItems: 2000 } }, required: ["table_id", "name", "type"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.createBasedField(text(input, "table_id"), text(input, "name"), text(input, "type"), text(input, "target_table_id") || undefined, input.options as string[] | undefined),
    }),
    register({
      name: "update_based_field_options", description: "Append or replace choices on an existing select column. Append preserves existing choices.",
      inputSchema: { type: "object", properties: { field_id: { type: "string" }, options: { type: "array", items: { type: "string", minLength: 1, maxLength: 180 }, maxItems: 2000 }, mode: { type: "string", enum: ["append", "replace"], default: "append" } }, required: ["field_id", "options"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.updateBasedFieldOptions(text(input, "field_id"), input.options as string[], text(input, "mode", "append") as "append" | "replace"),
    }),
    register({
      name: "create_based_record", description: "Create a row with values keyed by field ID. New select values automatically become field choices.",
      inputSchema: { type: "object", properties: { table_id: { type: "string" }, cells: { type: "object" } }, required: ["table_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.createBasedRecord(text(input, "table_id"), (input.cells ?? {}) as Record<string, unknown>),
    }),
    register({
      name: "update_based_record", description: "Update values in a Based row by field ID. New select values automatically become field choices.",
      inputSchema: { type: "object", properties: { record_id: { type: "string" }, cells: { type: "object" } }, required: ["record_id", "cells"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.updateBasedRecord(text(input, "record_id"), input.cells as Record<string, unknown>),
    }),
    register({
      name: "set_based_link", description: "Create or remove a two-way record link.",
      inputSchema: { type: "object", properties: { relation_id: { type: "string" }, left_record_id: { type: "string" }, right_record_id: { type: "string" }, linked: { type: "boolean" } }, required: ["relation_id", "left_record_id", "right_record_id", "linked"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.setBasedLink(text(input, "relation_id"), text(input, "left_record_id"), text(input, "right_record_id"), Boolean(input.linked)),
    }),
  ]);
  return true;
}
