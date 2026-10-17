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
      listProjects: noop,
      createProject: noop,
      listDocuments: noop,
      getDocument: noop,
      openDocument: noop,
      createDocument: noop,
      updateDocument: noop,
      listComments: noop,
      addComment: noop,
      replyToComment: noop,
      setCommentStatus: noop,
      listNotifications: noop,
      acknowledgeNotification: noop,
      completeNotification: noop,
      listBasedDatabases: noop,
      getBasedDatabase: noop,
      queryBasedRecords: noop,
      createBasedDatabase: noop,
      createBasedTable: noop,
      createBasedField: noop,
      createBasedRecord: noop,
      updateBasedRecord: noop,
      setBasedLink: noop,
    };

    expect(await registerWebMcpTools(api)).toBe(true);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "acknowledge_notification",
      "add_comment",
      "complete_notification",
      "create_based_database",
      "create_based_field",
      "create_based_record",
      "create_based_table",
      "create_document",
      "create_project",
      "get_based_database",
      "get_document",
      "list_based_databases",
      "list_comments",
      "list_documents",
      "list_notifications",
      "list_projects",
      "open_document",
      "query_based_records",
      "reopen_comment",
      "reply_to_comment",
      "resolve_comment",
      "set_based_link",
      "update_based_record",
      "update_document",
    ]);
  });
});
