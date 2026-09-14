export interface WebMcpApi {
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
      name: "list_documents",
      description: "List documents in this signed-in Notes workspace. Optionally match titles or text and return short snippets.",
      inputSchema: { type: "object", properties: {
        query: { type: "string", maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.listDocuments(text(input, "query") || undefined, Number(input.limit ?? 50)),
    }),
    register({
      name: "get_document",
      description: "Get one Notes document as stable rich-text JSON and plain text, with its comment context.",
      inputSchema: { type: "object", properties: { document_id: { type: "string" } }, required: ["document_id"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => api.getDocument(text(input, "document_id")),
    }),
    register({
      name: "open_document",
      description: "Open an existing note by ID in the Notes editor.",
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
      description: "Rename or update one Notes document. Replace or append Markdown/plain text; every change creates a revision.",
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
      description: "Append an agent reply to an existing Notes comment thread.",
      inputSchema: { type: "object", properties: {
        comment_id: { type: "string" }, body: { type: "string", minLength: 1, maxLength: 10000 },
        agent_name: { type: "string", default: "Codex", maxLength: 40 },
      }, required: ["comment_id", "body"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.replyToComment(text(input, "comment_id"), text(input, "body"), text(input, "agent_name", "Codex")),
    }),
    register({
      name: "resolve_comment",
      description: "Mark a Notes comment thread as resolved.",
      inputSchema: { type: "object", properties: { comment_id: { type: "string" } }, required: ["comment_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.setCommentStatus(text(input, "comment_id"), "resolved"),
    }),
    register({
      name: "reopen_comment",
      description: "Reopen a resolved Notes comment thread.",
      inputSchema: { type: "object", properties: { comment_id: { type: "string" } }, required: ["comment_id"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => api.setCommentStatus(text(input, "comment_id"), "open"),
    }),
  ]);
  return true;
}
