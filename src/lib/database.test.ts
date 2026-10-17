import { describe, expect, it } from "vitest";
import { contentColumnWidth, databaseRowGroups, defaultColumnWidth, externalUrl, matchingMultiSelectOptions, resizedColumnWidth, visibleDatabaseRows, type DatabaseColumn, type DatabaseRow } from "./database";

describe("multi-select suggestions", () => {
  const options = ["Website", "Web app", "Mobile website", "Research"];

  it("filters as the user types and ranks prefix matches first", () => {
    expect(matchingMultiSelectOptions(options, [], "web")).toEqual(["Web app", "Website", "Mobile website"]);
    expect(matchingMultiSelectOptions(options, [], "web a")).toEqual(["Web app"]);
  });

  it("does not suggest tags already in the cell", () => {
    expect(matchingMultiSelectOptions(options, ["Website"], "web")).toEqual(["Web app", "Mobile website"]);
  });
});

describe("column resizing", () => {
  it("gives unconfigured columns enough room before the first resize", () => {
    expect(defaultColumnWidth("singleSelect")).toBe(240);
    expect(defaultColumnWidth("date")).toBe(170);
    expect(defaultColumnWidth("number")).toBe(140);
  });

  it("tracks drag distance and enforces a usable minimum", () => {
    expect(resizedColumnWidth(220, 45)).toBe(265);
    expect(resizedColumnWidth(220, -500)).toBe(120);
    expect(resizedColumnWidth(220, 500)).toBe(420);
  });

  it("fits the header and cell content within bounds", () => {
    const column: DatabaseColumn = { id: "name", name: "Name", type: "text", options: [] };
    expect(contentColumnWidth(column, [{ id: "1", cells: { name: "A longer value" } }], (text) => text.length * 10)).toBe(168);
    expect(contentColumnWidth(column, [{ id: "1", cells: { name: "x".repeat(100) } }], (text) => text.length * 10)).toBe(420);
  });
});

describe("database views", () => {
  const columns: DatabaseColumn[] = [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "status", name: "Status", type: "multiSelect", options: [] },
  ];
  const rows: DatabaseRow[] = [
    { id: "1", cells: { name: "Alpha", status: ["Ready", "Important"] } },
    { id: "2", cells: { name: "Beta", status: ["Blocked"] } },
    { id: "3", cells: { name: "Gamma", status: [] } },
  ];

  it("searches across columns and filters array values", () => {
    expect(visibleDatabaseRows(rows, columns, "important", null).map((row) => row.id)).toEqual(["1"]);
    expect(visibleDatabaseRows(rows, columns, "", { columnId: "status", operator: "equals", value: "ready" }).map((row) => row.id)).toEqual(["1"]);
    expect(visibleDatabaseRows(rows, columns, "", { columnId: "status", operator: "empty", value: "" }).map((row) => row.id)).toEqual(["3"]);
  });

  it("groups rows by their column value", () => {
    expect(databaseRowGroups(rows, columns[1]).map((group) => [group.label, group.rows.length])).toEqual([
      ["Ready, Important", 1], ["Blocked", 1], ["Empty", 1],
    ]);
  });
});

describe("URL cells", () => {
  it("opens full and bare web addresses safely", () => {
    expect(externalUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(externalUrl("example.com/path")).toBe("https://example.com/path");
    expect(externalUrl("javascript://example.com")).toBeNull();
    expect(externalUrl("not a URL")).toBeNull();
  });
});
