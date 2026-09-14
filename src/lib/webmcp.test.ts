import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerWebMcpTools, type WebMcpApi } from "./webmcp";

describe("WebMCP registration", () => {
  beforeEach(() => {
    document.__marginToolsRegistered = false;
  });

  it("publishes the complete read, write, and comment tool surface", async () => {
    const tools: WebMcpToolDefinition[] = [];
    document.modelContext = {
      registerTool: vi.fn(async (tool) => { tools.push(tool); }),
    };
    const noop = vi.fn(async () => ({}));
    const api: WebMcpApi = {
      listDocuments: noop,
      getDocument: noop,
      openDocument: noop,
      createDocument: noop,
      updateDocument: noop,
      listComments: noop,
      addComment: noop,
      replyToComment: noop,
      setCommentStatus: noop,
    };

    expect(await registerWebMcpTools(api)).toBe(true);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_comment",
      "create_document",
      "get_document",
      "list_comments",
      "list_documents",
      "open_document",
      "reopen_comment",
      "reply_to_comment",
      "resolve_comment",
      "update_document",
    ]);
  });
});
