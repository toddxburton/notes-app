import { supabase } from "./supabase";
import type { BasedBackup, BasedCatalog, BasedDatabase, BasedField, BasedFolder, BasedLink, BasedRecord, BasedRelation, BasedTable } from "./basedTypes";
import { normalizeBasedOptions, updatedBasedOptions, type BasedOptionsMode } from "./basedOptions";
import { prepareBasedCells } from "./basedCells";

type Entity = BasedFolder | BasedDatabase | BasedTable | BasedField | BasedRelation | BasedRecord | BasedLink;
type EntityName = "based_folders" | "based_databases" | "based_tables" | "based_fields" | "based_relations" | "based_records" | "based_links";
type LocalData = BasedCatalog & { records: BasedRecord[]; links: BasedLink[] };
export type BasedQuery = { search?: string; filterFieldId?: string; filterMode?: "contains" | "equals" | "empty" | "notEmpty";
  filterValue?: string; sortFieldId?: string; descending?: boolean; groupFieldId?: string };
const key = "based-workspace-v1";
const empty = (): LocalData => ({ folders: [], databases: [], tables: [], fields: [], relations: [], records: [], links: [] });
const collections: Record<EntityName, keyof LocalData> = {
  based_folders: "folders", based_databases: "databases", based_tables: "tables", based_fields: "fields",
  based_relations: "relations", based_records: "records", based_links: "links",
};
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function local(): LocalData {
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(key) || "{}") as LocalData }; }
  catch { return empty(); }
}
function save(data: LocalData) { localStorage.setItem(key, JSON.stringify(data)); }
function owner(userId?: string | null) {
  if (supabase && !userId) throw new Error("Sign in before changing Based.");
  return userId ?? "local-user";
}
function check(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function basedList<T extends Entity>(name: EntityName, userId?: string | null): Promise<T[]> {
  owner(userId);
  if (!supabase) return local()[collections[name]] as T[];
  const output: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(name).select("*").eq("owner_id", owner(userId))
      .order("id").range(offset, offset + 999);
    check(error);
    output.push(...(data ?? []) as T[]);
    if ((data ?? []).length < 1000) return output;
  }
}

export async function basedGet<T extends Entity & { id: string }>(name: EntityName, entityId: string, userId?: string | null): Promise<T> {
  const ownerId = owner(userId);
  if (!supabase) {
    const item = (local()[collections[name]] as Entity[]).find((value) => "id" in value && value.id === entityId && value.owner_id === ownerId);
    if (!item) throw new Error("Based item not found.");
    return item as T;
  }
  const { data, error } = await supabase.from(name).select("*").eq("owner_id", ownerId).eq("id", entityId).single();
  check(error);
  return data as T;
}

export function validateBasedCells(fields: BasedField[], tableId: string, values: Record<string, unknown>): Record<string, string | string[] | boolean> {
  return prepareBasedCells(fields, tableId, values).cells;
}

export async function basedInsert<T extends Entity>(name: EntityName, value: T, userId?: string | null): Promise<T> {
  const ownerId = owner(userId);
  const item = { ...value, owner_id: ownerId } as T;
  if (!supabase) {
    const data = local();
    (data[collections[name]] as Entity[]).push(item);
    save(data);
    return item;
  }
  const { data, error } = await supabase.from(name).insert(item).select().single();
  check(error);
  return data as T;
}

export async function basedUpdate<T extends Entity>(name: EntityName, entityId: string, changes: Partial<T>, userId?: string | null): Promise<T> {
  const ownerId = owner(userId);
  if (!supabase) {
    const data = local();
    const items = data[collections[name]] as Entity[];
    const index = items.findIndex((item) => "id" in item && item.id === entityId && item.owner_id === ownerId);
    if (index < 0) throw new Error("Based item not found.");
    items[index] = { ...items[index], ...changes } as Entity;
    save(data);
    return items[index] as T;
  }
  const { data, error } = await supabase.from(name).update(changes as Record<string, unknown>).eq("owner_id", ownerId).eq("id", entityId).select().single();
  check(error);
  return data as T;
}

export async function mergeBasedRecordCells(userId: string | null, recordId: string, cells: Record<string, string | string[] | boolean>): Promise<BasedRecord> {
  if (!supabase) {
    const current = await basedGet<BasedRecord>("based_records", recordId, userId);
    return basedUpdate<BasedRecord>("based_records", recordId, { cells: { ...current.cells, ...cells } }, userId);
  }
  const { data, error } = await supabase.rpc("based_merge_record_cells", { p_record_id: recordId, p_cells: cells });
  check(error);
  return data as BasedRecord;
}

export async function basedDelete(name: EntityName, entityId: string, userId?: string | null): Promise<void> {
  const ownerId = owner(userId);
  if (!supabase) {
    const data = local();
    const items = data[collections[name]] as Entity[];
    const index = items.findIndex((item) => "id" in item && item.id === entityId && item.owner_id === ownerId);
    if (index < 0) throw new Error("Based item not found.");
    items.splice(index, 1);
    save(data);
    return;
  }
  const { error } = await supabase.from(name).delete().eq("owner_id", ownerId).eq("id", entityId);
  check(error);
}

export async function loadBasedCatalog(userId?: string | null): Promise<BasedCatalog> {
  const [folders, databases, tables, fields, relations] = await Promise.all([
    basedList<BasedFolder>("based_folders", userId), basedList<BasedDatabase>("based_databases", userId),
    basedList<BasedTable>("based_tables", userId), basedList<BasedField>("based_fields", userId),
    basedList<BasedRelation>("based_relations", userId),
  ]);
  return { folders, databases, tables, fields, relations };
}

export async function createBasedFolder(userId: string | null, name: string, sortOrder: number): Promise<BasedFolder> {
  return basedInsert("based_folders", { id: id(), owner_id: owner(userId), name, sort_order: sortOrder, collapsed: false, archived_at: null, created_at: now() }, userId);
}

export async function createBasedDatabase(userId: string | null, name: string, folderId: string | null, sortOrder: number): Promise<BasedDatabase> {
  const database = await basedInsert<BasedDatabase>("based_databases", {
    id: id(), owner_id: owner(userId), folder_id: folderId, name, sort_order: sortOrder, archived_at: null, created_at: now(),
  }, userId);
  await createBasedTable(userId, database.id, "Table 1", 0);
  return database;
}

export async function createBasedTable(userId: string | null, databaseId: string, name: string, sortOrder: number): Promise<BasedTable> {
  const table = await basedInsert<BasedTable>("based_tables", {
    id: id(), owner_id: owner(userId), database_id: databaseId, name, sort_order: sortOrder, archived_at: null, created_at: now(),
  }, userId);
  await createBasedField(userId, table.id, "Item name", "itemName", 0);
  return table;
}

export async function createBasedField(userId: string | null, tableId: string, name: string, type: BasedField["type"], sortOrder: number, options: string[] = []): Promise<BasedField> {
  if (type === "linkedRecord") throw new Error("Use createBasedRelation for linked fields.");
  if (options.length && type !== "singleSelect" && type !== "multiSelect") throw new Error("Choices are only valid for select fields.");
  return basedInsert<BasedField>("based_fields", {
    id: id(), owner_id: owner(userId), table_id: tableId, name, type, options: normalizeBasedOptions(options), relation_id: null,
    relation_side: null, width: null, hidden: false, archived_at: null, sort_order: sortOrder,
  }, userId);
}

export async function updateBasedFieldOptions(userId: string | null, fieldId: string, options: string[], mode: BasedOptionsMode = "append"): Promise<BasedField> {
  const field = await basedGet<BasedField>("based_fields", fieldId, userId);
  if (field.archived_at || (field.type !== "singleSelect" && field.type !== "multiSelect"))
    throw new Error("Choices can only be changed on active select fields.");
  return basedUpdate<BasedField>("based_fields", fieldId, { options: updatedBasedOptions(field.options, options, mode) }, userId);
}

export async function createBasedRelation(userId: string | null, databaseId: string, leftTableId: string, rightTableId: string, name: string, leftOrder: number, rightOrder: number): Promise<[BasedField, BasedField]> {
  const ownerId = owner(userId);
  if (name.trim().length < 1 || name.trim().length > 180) throw new Error("Invalid column name.");
  if (supabase) {
    const { data, error } = await supabase.rpc("based_create_relation", {
      p_owner_id: ownerId, p_database_id: databaseId, p_left_table_id: leftTableId,
      p_right_table_id: rightTableId, p_name: name, p_left_order: leftOrder, p_right_order: rightOrder,
    });
    check(error);
    return (data as { fields: [BasedField, BasedField] }).fields;
  }
  const data = local();
  if (!data.databases.some((item) => item.id === databaseId && item.owner_id === ownerId && !item.archived_at)
    || ![leftTableId, rightTableId].every((tableId) => data.tables.some((item) => item.id === tableId
      && item.database_id === databaseId && item.owner_id === ownerId && !item.archived_at)))
    throw new Error("Linked tables must belong to the same active database.");
  const relation: BasedRelation = { id: id(), owner_id: ownerId, database_id: databaseId,
    left_table_id: leftTableId, right_table_id: rightTableId };
  const first: BasedField = { id: id(), owner_id: ownerId, table_id: leftTableId, name: name.trim(),
    type: "linkedRecord", options: [], relation_id: relation.id, relation_side: "left", width: null,
    hidden: false, archived_at: null, sort_order: leftOrder };
  const second: BasedField = { ...first, id: id(), table_id: rightTableId,
    name: `Linked from ${name.trim()}`.slice(0, 180), relation_side: "right", sort_order: rightOrder };
  data.relations.push(relation);
  data.fields.push(first, second);
  save(data);
  return [first, second];
}

export async function createBasedRecord(userId: string | null, tableId: string, sortOrder: number): Promise<BasedRecord> {
  return basedInsert<BasedRecord>("based_records", {
    id: id(), owner_id: owner(userId), table_id: tableId, cells: {}, sort_order: sortOrder,
    archived_at: null, created_at: now(), updated_at: now(),
  }, userId);
}

export async function nextBasedRecordOrder(userId: string | null, tableId: string): Promise<number> {
  if (!supabase) return Math.max(-1, ...local().records.filter((record) => record.table_id === tableId)
    .map((record) => record.sort_order)) + 1;
  const { data, error } = await supabase.from("based_records").select("sort_order")
    .eq("owner_id", owner(userId)).eq("table_id", tableId)
    .order("sort_order", { ascending: false }).limit(1);
  check(error);
  return Number(data?.[0]?.sort_order ?? -1) + 1;
}

export async function loadBasedRecords(userId: string | null, tableId: string, offset = 0, limit = 100, options: BasedQuery = {}): Promise<{ records: BasedRecord[]; count: number }> {
  owner(userId);
  if (!supabase) {
    const { search = "", filterFieldId, filterMode, filterValue = "", sortFieldId, descending, groupFieldId } = options;
    const text = (value: unknown) => Array.isArray(value) ? value.join(", ") : String(value ?? "");
    const records = local().records.filter((record) => record.table_id === tableId && !record.archived_at)
      .filter((record) => !search || Object.values(record.cells).some((value) => text(value).toLowerCase().includes(search.toLowerCase())))
      .filter((record) => {
        if (!filterFieldId || !filterMode) return true;
        const raw = record.cells[filterFieldId];
        const value = text(raw).toLowerCase();
        if (filterMode === "empty") return !value;
        if (filterMode === "notEmpty") return Boolean(value);
        if (filterMode === "equals") return Array.isArray(raw)
          ? raw.some((item) => item.toLowerCase() === filterValue.toLowerCase()) : value === filterValue.toLowerCase();
        return value.includes(filterValue.toLowerCase());
      })
      .sort((a, b) => {
        const group = groupFieldId ? text(a.cells[groupFieldId]).localeCompare(text(b.cells[groupFieldId])) : 0;
        const sorted = sortFieldId ? text(a.cells[sortFieldId]).localeCompare(text(b.cells[sortFieldId]), undefined, { numeric: true }) * (descending ? -1 : 1) : 0;
        return group || sorted || a.sort_order - b.sort_order || a.id.localeCompare(b.id);
      });
    return { records: records.slice(offset, offset + limit), count: records.length };
  }
  if (Object.values(options).some((value) => value !== undefined && value !== "" && value !== false)) {
    const { data, error } = await supabase.rpc("based_query_records", {
      p_table_id: tableId, p_search: options.search ?? "", p_filter_field_id: options.filterFieldId ?? null,
      p_filter_mode: options.filterMode ?? null, p_filter_value: options.filterValue ?? "",
      p_sort_field_id: options.sortFieldId ?? null, p_descending: options.descending ?? false,
      p_group_field_id: options.groupFieldId ?? null, p_offset: offset, p_limit: limit,
    });
    check(error);
    return { records: (data ?? []).map((row: { record: BasedRecord }) => row.record), count: Number(data?.[0]?.total_count ?? 0) };
  }
  const { data, error, count } = await supabase.from("based_records").select("*", { count: "exact" })
    .eq("owner_id", owner(userId)).eq("table_id", tableId).is("archived_at", null)
    .order("sort_order").order("id").range(offset, offset + limit - 1);
  check(error);
  return { records: (data ?? []) as BasedRecord[], count: count ?? 0 };
}

export async function loadBasedRecordsByIds(userId: string | null, ids: string[]): Promise<BasedRecord[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  if (!supabase) return local().records.filter((record) => unique.includes(record.id));
  const records: BasedRecord[] = [];
  for (let index = 0; index < unique.length; index += 100) {
    const { data, error } = await supabase.from("based_records").select("*")
      .eq("owner_id", owner(userId)).in("id", unique.slice(index, index + 100));
    check(error);
    records.push(...(data ?? []) as BasedRecord[]);
  }
  return records;
}

export async function loadBasedLinks(userId: string | null, relationId?: string): Promise<BasedLink[]> {
  if (!supabase) return local().links.filter((link) => !relationId || link.relation_id === relationId);
  const output: BasedLink[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from("based_links").select("*").eq("owner_id", owner(userId))
      .order("relation_id").order("left_record_id").order("right_record_id").range(offset, offset + 999);
    if (relationId) query = query.eq("relation_id", relationId);
    const { data, error } = await query;
    check(error);
    output.push(...(data ?? []) as BasedLink[]);
    if ((data ?? []).length < 1000) break;
  }
  return output;
}

export async function loadArchivedBasedRecords(userId: string | null, tableId: string): Promise<BasedRecord[]> {
  if (!supabase) return local().records.filter((record) => record.table_id === tableId && Boolean(record.archived_at));
  const { data, error } = await supabase.from("based_records").select("*").eq("owner_id", owner(userId))
    .eq("table_id", tableId).not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(100);
  check(error);
  return (data ?? []) as BasedRecord[];
}

export async function setBasedLink(userId: string | null, relationId: string, leftRecordId: string, rightRecordId: string, linked: boolean): Promise<void> {
  const value: BasedLink = { relation_id: relationId, owner_id: owner(userId), left_record_id: leftRecordId, right_record_id: rightRecordId };
  if (!supabase) {
    const data = local();
    data.links = data.links.filter((link) => !(link.relation_id === relationId && link.left_record_id === leftRecordId && link.right_record_id === rightRecordId));
    if (linked) data.links.push(value);
    save(data);
    return;
  }
  const result = linked
    ? await supabase.from("based_links").upsert(value)
    : await supabase.from("based_links").delete().eq("owner_id", owner(userId)).eq("relation_id", relationId)
      .eq("left_record_id", leftRecordId).eq("right_record_id", rightRecordId);
  check(result.error);
}

async function allRecords(userId: string | null): Promise<BasedRecord[]> {
  if (!supabase) return local().records;
  const output: BasedRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("based_records").select("*").eq("owner_id", owner(userId))
      .order("id").range(offset, offset + 999);
    check(error);
    output.push(...(data ?? []) as BasedRecord[]);
    if ((data ?? []).length < 1000) break;
  }
  return output;
}

export async function exportBased(userId: string | null): Promise<BasedBackup> {
  const catalog = await loadBasedCatalog(userId);
  return { format: "based-workspace", version: 1, exported_at: now(), ...catalog,
    records: await allRecords(userId), links: await loadBasedLinks(userId) };
}

export async function needsBasedBackup(userId: string | null): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from("based_backups").select("created_at")
    .eq("owner_id", owner(userId)).order("created_at", { ascending: false }).limit(1).maybeSingle();
  check(error);
  return !data || Date.now() - new Date(data.created_at).getTime() > 86400000;
}

export async function saveBasedBackup(userId: string | null, backup: BasedBackup): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("based_backups").insert({ owner_id: owner(userId), format_version: 1, payload: backup });
  check(error);
}

export async function restoreBased(userId: string | null, backup: BasedBackup): Promise<void> {
  if (!backup || backup.format !== "based-workspace" || backup.version !== 1)
    throw new Error("Unsupported Based backup.");
  if (![backup.folders, backup.databases, backup.tables, backup.fields, backup.relations,
    backup.records, backup.links].every(Array.isArray)) throw new Error("Incomplete Based backup.");
  owner(userId);
  if (supabase) {
    const { error } = await supabase.rpc("based_restore", { p_backup: backup });
    check(error);
    return;
  }
  save({ folders: backup.folders, databases: backup.databases, tables: backup.tables,
    fields: backup.fields, relations: backup.relations, records: backup.records, links: backup.links });
}
