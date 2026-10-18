import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceData } from "../types";
import { clearWorkspaceCache, readWorkspaceCache, writeWorkspaceCache } from "./workspaceCache";

const emptyWorkspace: WorkspaceData = {
  projects: [], documents: [], comments: [], replies: [], notifications: [], displayName: "You",
};

describe("workspace cache", () => {
  beforeEach(() => localStorage.clear());

  it("restores only the signed-in owner's snapshot and selected note", () => {
    writeWorkspaceCache("owner-a", emptyWorkspace, "note-a");
    expect(readWorkspaceCache("owner-a")).toMatchObject({ activeId: "note-a", data: emptyWorkspace });
    expect(readWorkspaceCache("owner-b")).toBeNull();
    clearWorkspaceCache("owner-a");
    expect(readWorkspaceCache("owner-a")).toBeNull();
  });

  it("ignores snapshots containing another owner's records", () => {
    const document = { id: "note-b", owner_id: "owner-b" } as WorkspaceData["documents"][number];
    writeWorkspaceCache("owner-a", { ...emptyWorkspace, documents: [document] }, "note-b");
    expect(readWorkspaceCache("owner-a")).toBeNull();
  });
});
