import { describe, expect, it } from "vitest";
import { activeBasedFilter, basedFilterChoices } from "./basedFilter";
import type { BasedField } from "./basedTypes";

const field = (type: BasedField["type"], options: string[] = []): BasedField => ({
  id: "field", owner_id: "owner", table_id: "table", name: "Archived", type, options,
  relation_id: null, relation_side: null, width: null, hidden: false, archived_at: null, sort_order: 0,
});

describe("Based filter choices", () => {
  it("offers both checkbox values and applies unchecked as false", () => {
    const archived = field("checkbox");
    expect(basedFilterChoices(archived)).toEqual([
      { label: "Checked", value: "true" }, { label: "Unchecked", value: "false" },
    ]);
    expect(activeBasedFilter(archived, { fieldId: "field", mode: "equals", value: "false" }))
      .toEqual({ fieldId: "field", mode: "equals", value: "false" });
    expect(activeBasedFilter(archived, { fieldId: "field", mode: "equals", value: "" })).toBeNull();
  });

  it("uses the configured select choices", () => {
    expect(basedFilterChoices(field("singleSelect", ["Saved", "Applied"])))
      .toEqual([{ label: "Saved", value: "Saved" }, { label: "Applied", value: "Applied" }]);
    expect(basedFilterChoices(field("multiSelect", ["Remote"])))
      .toEqual([{ label: "Remote", value: "Remote" }]);
    expect(basedFilterChoices(field("text"))).toBeNull();
  });
});
