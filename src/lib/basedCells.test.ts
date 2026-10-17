import { describe, expect, it } from "vitest";
import { prepareBasedCells } from "./basedCells";
import type { BasedField } from "./basedTypes";

const field = (id: string, type: BasedField["type"], options: string[] = []) => ({
  id, table_id: "table", name: id, type, options, archived_at: null,
});

describe("MCP select writes", () => {
  it("creates missing single and multi-select choices in one record write", () => {
    const result = prepareBasedCells([
      field("meal", "singleSelect"), field("ingredients", "multiSelect", ["Rice"]),
    ], "table", { meal: " Dinner ", ingredients: ["Rice", "Onion", "Onion"] }, true);
    expect(result).toEqual({
      cells: { meal: "Dinner", ingredients: ["Rice", "Onion"] },
      optionUpdates: [{ fieldId: "meal", options: ["Dinner"] }, { fieldId: "ingredients", options: ["Rice", "Onion"] }],
    });
  });

  it("validates every value before returning any option updates", () => {
    expect(() => prepareBasedCells([
      field("meal", "singleSelect"), field("quantity", "number"),
    ], "table", { meal: "Dinner", quantity: "not a number" }, true)).toThrow("Invalid number");
    expect(() => prepareBasedCells([field("ingredients", "multiSelect")], "table",
      { ingredients: ["Onion", 2] }, true)).toThrow("Invalid options");
  });

  it("keeps strict validation for ordinary non-MCP writes", () => {
    expect(() => prepareBasedCells([field("meal", "singleSelect")], "table", { meal: "Dinner" }))
      .toThrow("Invalid option");
  });
});
