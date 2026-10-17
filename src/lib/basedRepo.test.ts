import { beforeEach, describe, expect, it, vi } from "vitest";
import { basedUpdate, createBasedDatabase, createBasedField, createBasedRecord, createBasedRelation,
  createBasedTable, exportBased, loadBasedCatalog, loadBasedLinks, loadBasedRecords, loadBasedRecordsByIds, mergeBasedRecordCells, restoreBased,
  nextBasedRecordOrder, setBasedLink, updateBasedFieldOptions, validateBasedCells } from "./basedRepo";

vi.mock("./supabase", () => ({ supabase: null }));

describe("Based local workspace", () => {
  beforeEach(() => localStorage.clear());

  it("persists separate tables with editable cells and queries all rows before paging", async () => {
    const database = await createBasedDatabase(null, "Projects", null, 0);
    const catalog = await loadBasedCatalog(null);
    const table = catalog.tables.find((item) => item.database_id === database.id)!;
    const name = catalog.fields.find((item) => item.table_id === table.id)!;
    const status = await createBasedField(null, table.id, "Status", "singleSelect", 1);
    await basedUpdate("based_fields", status.id, { options: ["Active", "Done"] }, null);

    for (const [index, title, state] of [[0, "Gamma", "Done"], [1, "Alpha", "Active"], [2, "Beta", "Active"]] as const) {
      const record = await createBasedRecord(null, table.id, index);
      await mergeBasedRecordCells(null, record.id, { [name.id]: title });
      await mergeBasedRecordCells(null, record.id, { [status.id]: state });
    }
    const result = await loadBasedRecords(null, table.id, 0, 1, { filterFieldId: status.id, filterMode: "equals",
      filterValue: "Active", sortFieldId: name.id });
    expect(result.count).toBe(2);
    expect(result.records.map((item) => item.cells[name.id])).toEqual(["Alpha"]);
    expect((await loadBasedRecords(null, table.id, 1, 1, { filterFieldId: status.id, filterMode: "equals",
      filterValue: "Active", sortFieldId: name.id })).records[0].cells[name.id]).toBe("Beta");
    const first = (await loadBasedRecords(null, table.id, 0, 1)).records[0];
    await basedUpdate("based_records", first.id, { archived_at: new Date().toISOString() }, null);
    expect(await nextBasedRecordOrder(null, table.id)).toBe(3);
    const fields = (await loadBasedCatalog(null)).fields;
    expect(() => validateBasedCells(fields, table.id, { [status.id]: "Unknown" })).toThrow();
  });

  it("creates select fields with choices and accepts newly appended values", async () => {
    const database = await createBasedDatabase(null, "Recipes", null, 0);
    const table = (await loadBasedCatalog(null)).tables.find((item) => item.database_id === database.id)!;
    const meal = await createBasedField(null, table.id, "Meal", "singleSelect", 1, ["Dinner", " Lunch "]);
    const ingredients = await createBasedField(null, table.id, "Ingredients", "multiSelect", 2, ["Rice"]);
    expect(meal.options).toEqual(["Dinner", "Lunch"]);
    expect((await updateBasedFieldOptions(null, ingredients.id, ["Onion", "Rice"], "append")).options)
      .toEqual(["Rice", "Onion"]);
    const record = await createBasedRecord(null, table.id, 0);
    const cells = validateBasedCells((await loadBasedCatalog(null)).fields, table.id, {
      [meal.id]: "Dinner", [ingredients.id]: ["Rice", "Onion"],
    });
    await mergeBasedRecordCells(null, record.id, cells);
    expect((await loadBasedRecords(null, table.id)).records[0].cells).toMatchObject(cells);
    await expect(updateBasedFieldOptions(null, table.id, ["Invalid"])).rejects.toThrow("not found");
  });

  it("keeps two-way links and restores a separate backup", async () => {
    const database = await createBasedDatabase(null, "CRM", null, 0);
    const firstTable = (await loadBasedCatalog(null)).tables[0];
    const secondTable = await createBasedTable(null, database.id, "People", 1);
    await expect(createBasedRelation(null, database.id, firstTable.id, crypto.randomUUID(), "Invalid", 1, 1))
      .rejects.toThrow("same active database");
    expect((await loadBasedCatalog(null)).relations).toHaveLength(0);
    const [leftField, rightField] = await createBasedRelation(null, database.id, firstTable.id, secondTable.id, "Contacts", 1, 1);
    const left = await createBasedRecord(null, firstTable.id, 0);
    const right = await createBasedRecord(null, secondTable.id, 0);
    await setBasedLink(null, leftField.relation_id!, left.id, right.id, true);
    expect(rightField.relation_id).toBe(leftField.relation_id);
    expect(await loadBasedLinks(null)).toMatchObject([{ left_record_id: left.id, right_record_id: right.id }]);

    const backup = await exportBased(null);
    await expect(restoreBased(null, { ...backup, links: undefined } as unknown as typeof backup)).rejects.toThrow("Incomplete Based backup");
    expect(await loadBasedLinks(null)).toHaveLength(1);
    localStorage.clear();
    await restoreBased(null, backup);
    expect((await loadBasedCatalog(null)).databases.map((item) => item.name)).toEqual(["CRM"]);
    expect(await loadBasedLinks(null)).toHaveLength(1);
    expect((await loadBasedRecords(null, firstTable.id)).count).toBe(1);
  });

  it("queries a table with several thousand records", async () => {
    const database = await createBasedDatabase(null, "Inventory", null, 0);
    const catalog = await loadBasedCatalog(null);
    const table = catalog.tables.find((item) => item.database_id === database.id)!;
    const name = catalog.fields.find((item) => item.table_id === table.id)!;
    const raw = JSON.parse(localStorage.getItem("based-workspace-v1")!);
    raw.records = Array.from({ length: 3000 }, (_, index) => ({
      id: crypto.randomUUID(), owner_id: "local-user", table_id: table.id,
      cells: { [name.id]: `Item ${String(index).padStart(4, "0")}` }, sort_order: index,
      archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    localStorage.setItem("based-workspace-v1", JSON.stringify(raw));

    const result = await loadBasedRecords(null, table.id, 0, 100, { search: "Item 29" });
    expect(result.count).toBe(100);
    expect(result.records).toHaveLength(100);
    expect(result.records[0].cells[name.id]).toBe("Item 2900");
    expect((await loadBasedRecordsByIds(null, [raw.records[2400].id]))[0].cells[name.id]).toBe("Item 2400");
  });
});
