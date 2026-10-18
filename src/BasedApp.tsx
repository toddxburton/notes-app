import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArchiveRestore, ChevronDown, ChevronRight, Download, Ellipsis, FolderPlus, PanelLeftClose, PanelLeftOpen, Plus, Search, Upload, X } from "lucide-react";
import { resizedColumnWidth } from "./lib/database";
import {
  basedUpdate, createBasedDatabase, createBasedField, createBasedFolder,
  createBasedRecord, createBasedRelation, createBasedTable, exportBased, restoreBased,
  loadArchivedBasedRecords, loadBasedCatalog, loadBasedLinks, loadBasedRecords, loadBasedRecordsByIds, mergeBasedRecordCells,
  needsBasedBackup, nextBasedRecordOrder, saveBasedBackup, setBasedLink,
} from "./lib/basedRepo";
import { basedFieldTypes, type BasedBackup, type BasedCatalog, type BasedDatabase, type BasedField,
  type BasedFolder, type BasedLink, type BasedRecord, type BasedTable } from "./lib/basedTypes";
import { isSupabaseConfigured, signOut } from "./lib/supabase";

type Props = { userId: string | null; onSwitch: () => void; railWidth: number };
type Filter = { fieldId: string; mode: "contains" | "equals" | "empty" | "notEmpty"; value: string };
const blankCatalog = (): BasedCatalog => ({ folders: [], databases: [], tables: [], fields: [], relations: [] });
const rememberedDatabase = (userId: string | null) => `based-last-database-${userId ?? "local"}`;
const rememberedTable = (userId: string | null) => `based-last-table-${userId ?? "local"}`;
const order = <T extends { sort_order: number }>(items: T[]) => [...items].sort((a, b) => a.sort_order - b.sort_order);
const nextOrder = <T extends { sort_order: number }>(items: T[]) => Math.max(-1, ...items.map((item) => item.sort_order)) + 1;
const cellText = (value: unknown) => Array.isArray(value) ? value.join(", ") : value === true ? "Yes" : value === false ? "No" : String(value ?? "");

export default function BasedApp({ userId, onSwitch, railWidth }: Props) {
  const [catalog, setCatalog] = useState<BasedCatalog>(blankCatalog);
  const [databaseId, setDatabaseId] = useState<string | null>(() => localStorage.getItem(rememberedDatabase(userId)));
  const [tableId, setTableId] = useState<string | null>(() => localStorage.getItem(rememberedTable(userId)));
  const [records, setRecords] = useState<BasedRecord[]>([]);
  const [archivedRecords, setArchivedRecords] = useState<BasedRecord[]>([]);
  const [recordCount, setRecordCount] = useState(0);
  const [links, setLinks] = useState<BasedLink[]>([]);
  const [relatedRecords, setRelatedRecords] = useState<Record<string, BasedRecord[]>>({});
  const [offset, setOffset] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [searchingSidebar, setSearchingSidebar] = useState(false);
  const [resizeWidths, setResizeWidths] = useState<Record<string, number> | null>(null);
  const [search, setSearch] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortFieldId, setSortFieldId] = useState("");
  const [sortDescending, setSortDescending] = useState(false);
  const [groupFieldId, setGroupFieldId] = useState("");
  const [wrap, setWrap] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [railVisible, setRailVisible] = useState(() => localStorage.getItem("noted-sidebar-visible") !== "false");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cellMenu, setCellMenu] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkMatches, setLinkMatches] = useState<BasedRecord[]>([]);
  const [question, setQuestion] = useState<{ label: string; value: string; choices?: string[] } | null>(null);
  const questionResolver = useRef<((value: string | null) => void) | null>(null);
  const rowRequestId = useRef(0);
  const loadingRowsRef = useRef(false);
  const resizeRef = useRef<{ fieldId: string; startX: number; startWidth: number; widths: Record<string, number> } | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  function suggest(label: string, value = "", choices?: string[]): Promise<string | null> {
    return new Promise((resolve) => { questionResolver.current = resolve; setQuestion({ label, value, choices }); });
  }
  function answer(value: string | null) {
    questionResolver.current?.(value?.trim() || null);
    questionResolver.current = null;
    setQuestion(null);
  }
  async function confirmAction(label: string, action: string) {
    return await suggest(label, "Cancel", ["Cancel", action]) === action;
  }

  const database = catalog.databases.find((item) => item.id === databaseId && !item.archived_at) ?? null;
  const tables = order(catalog.tables.filter((item) => item.database_id === databaseId && !item.archived_at));
  const archivedTables = catalog.tables.filter((item) => item.database_id === databaseId && item.archived_at);
  const table = tables.find((item) => item.id === tableId) ?? tables[0] ?? null;
  const fields = order(catalog.fields.filter((item) => item.table_id === table?.id && !item.archived_at));
  const archivedFields = catalog.fields.filter((item) => item.table_id === table?.id && item.archived_at);
  const visibleFields = fields.filter((field) => !field.hidden);
  const queryableFields = fields.filter((field) => field.type !== "linkedRecord");
  function clearTableControls() {
    setSearch(""); setFilter(null); setFilterOpen(false); setSortFieldId(""); setSortDescending(false);
    setGroupFieldId(""); setOffset(0); setCellMenu(null);
  }
  function openTable(id: string) { clearTableControls(); setTableId(id); }

  const refreshCatalog = useCallback(async () => {
    const next = await loadBasedCatalog(userId);
    setCatalog(next);
    const available = next.databases.filter((item) => !item.archived_at);
    setDatabaseId((current) => available.some((item) => item.id === current) ? current : available[0]?.id ?? null);
    return next;
  }, [userId]);

  const refreshRows = useCallback(async (selectedTableId: string, selectedOffset: number) => {
    const requestId = ++rowRequestId.current;
    loadingRowsRef.current = true;
    setLoadingRows(true);
    try {
    const result = await loadBasedRecords(userId, selectedTableId, selectedOffset, 100, {
      search,
      filterFieldId: catalog.fields.some((field) => field.id === filter?.fieldId && field.table_id === selectedTableId) ? filter?.fieldId : undefined,
      filterMode: filter?.mode, filterValue: filter?.value,
      sortFieldId: catalog.fields.some((field) => field.id === sortFieldId && field.table_id === selectedTableId) ? sortFieldId : undefined,
      descending: sortDescending,
      groupFieldId: catalog.fields.some((field) => field.id === groupFieldId && field.table_id === selectedTableId) ? groupFieldId : undefined,
    });
    if (requestId === rowRequestId.current) {
      setRecords((current) => selectedOffset === 0 ? result.records : [
        ...current, ...result.records.filter((record) => !current.some((item) => item.id === record.id)),
      ]);
      setRecordCount(result.count);
    }
    } finally {
      if (requestId === rowRequestId.current) { loadingRowsRef.current = false; setLoadingRows(false); }
    }
  }, [userId, search, filter?.fieldId, filter?.mode, filter?.value, sortFieldId, sortDescending, groupFieldId, catalog.fields]);

  useEffect(() => {
    if (!filterOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!filterPopoverRef.current?.contains(event.target as Node) &&
          !filterButtonRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFilterOpen(false); };
    const closeOnScroll = () => setFilterOpen(false);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", closeOnScroll);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", closeOnScroll);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [filterOpen]);

  useEffect(() => {
    let active = true;
    void refreshCatalog().then(async (next) => {
      if (!active) return;
      if (isSupabaseConfigured && await needsBasedBackup(userId)) await saveBasedBackup(userId, await exportBased(userId));
    }).catch((caught) => setError(String(caught))).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshCatalog, userId]);

  useEffect(() => {
    if (databaseId) localStorage.setItem(rememberedDatabase(userId), databaseId);
    const selected = catalog.tables.find((item) => item.id === tableId && item.database_id === databaseId && !item.archived_at);
    if (!selected) setTableId(order(catalog.tables.filter((item) => item.database_id === databaseId && !item.archived_at))[0]?.id ?? null);
  }, [databaseId, catalog.tables, tableId, userId]);

  useEffect(() => {
    if (!table) { setRecords([]); setRecordCount(0); return; }
    localStorage.setItem(rememberedTable(userId), table.id);
    let active = true;
    void refreshRows(table.id, offset).catch((caught) => { if (active) setError(String(caught)); });
    return () => { active = false; };
  }, [table?.id, offset, refreshRows, userId]);

  function loadMoreRows(element: HTMLDivElement) {
    if (loadingRowsRef.current || !table || records.length >= recordCount || !recordCount) return;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 120) {
      loadingRowsRef.current = true;
      setOffset(records.length);
    }
  }

  useEffect(() => {
    const element = document.querySelector<HTMLDivElement>(".based-grid-scroll");
    if (element) loadMoreRows(element);
  }, [records.length, recordCount, table?.id]);

  useEffect(() => {
    if (!table) { setArchivedRecords([]); return; }
    void loadArchivedBasedRecords(userId, table.id).then(setArchivedRecords).catch((caught) => setError(String(caught)));
  }, [table?.id, userId]);

  useEffect(() => {
    if (!database) return;
    let active = true;
    const relations = catalog.relations.filter((item) => item.database_id === database.id);
    setRelatedRecords({});
    void loadBasedLinks(userId)
      .then((allLinks) => {
        if (!active) return;
        setLinks(allLinks.filter((item) => relations.some((relation) => relation.id === item.relation_id)));
      }).catch((caught) => setError(String(caught)));
    return () => { active = false; };
  }, [catalog.relations, database?.id, tableId, userId]);

  useEffect(() => {
    if (!table || !records.length || !links.length) return;
    const visibleIds = new Set(records.filter((record) => record.table_id === table.id).map((record) => record.id));
    const linkedIds = links.flatMap((link) => {
      const relation = catalog.relations.find((item) => item.id === link.relation_id);
      if (!relation) return [];
      if (relation.left_table_id === table.id && visibleIds.has(link.left_record_id)) return [link.right_record_id];
      if (relation.right_table_id === table.id && visibleIds.has(link.right_record_id)) return [link.left_record_id];
      return [];
    });
    const known = new Set(Object.values(relatedRecords).flat().map((record) => record.id));
    const missing = [...new Set(linkedIds)].filter((id) => !known.has(id));
    if (!missing.length) return;
    let active = true;
    void loadBasedRecordsByIds(userId, missing).then((found) => {
      if (!active || !found.length) return;
      setRelatedRecords((current) => {
        const next = { ...current };
        for (const record of found) {
          const rows = next[record.table_id] ?? [];
          if (!rows.some((item) => item.id === record.id)) next[record.table_id] = [...rows, record];
        }
        return next;
      });
    }).catch((caught) => { if (active) setError(String(caught)); });
    return () => { active = false; };
  }, [catalog.relations, links, records, relatedRecords, table?.id, userId]);

  useEffect(() => {
    const field = catalog.fields.find((item) => item.id === cellMenu?.fieldId);
    if (!field || field.type !== "linkedRecord") return;
    const relation = catalog.relations.find((item) => item.id === field.relation_id);
    const targetTableId = field.relation_side === "left" ? relation?.right_table_id : relation?.left_table_id;
    if (!targetTableId) return;
    let active = true;
    void loadBasedRecords(userId, targetTableId, 0, 100, { search: linkSearch }).then((result) => {
      if (active) setLinkMatches(result.records);
    }).catch((caught) => { if (active) setError(String(caught)); });
    return () => { active = false; };
  }, [cellMenu?.fieldId, catalog.fields, catalog.relations, linkSearch, userId]);

  async function run(action: () => Promise<void>) {
    try { setError(""); await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  async function addFolder() {
    const name = await suggest("Folder name"); if (!name) return;
    await run(async () => { await createBasedFolder(userId, name, nextOrder(catalog.folders)); await refreshCatalog(); });
  }
  async function addDatabase(folderId: string | null = null) {
    const name = await suggest("Database name"); if (!name) return;
    await run(async () => {
      const created = await createBasedDatabase(userId, name, folderId,
        nextOrder(catalog.databases.filter((item) => item.folder_id === folderId)));
      if (folderId) await basedUpdate<BasedFolder>("based_folders", folderId, { collapsed: false }, userId);
      const next = await refreshCatalog();
      clearTableControls(); setDatabaseId(created.id); setTableId(next.tables.find((item) => item.database_id === created.id)?.id ?? null);
    });
  }
  async function addTable() {
    if (!database) return;
    const name = await suggest("Table name", `Table ${tables.length + 1}`); if (!name) return;
    await run(async () => {
      const created = await createBasedTable(userId, database.id, name,
        nextOrder(catalog.tables.filter((item) => item.database_id === database.id)));
      await refreshCatalog(); openTable(created.id);
    });
  }
  async function addField() {
    if (!table || !database) return;
    const name = await suggest("Column name"); if (!name) return;
    const type = await suggest("Column type", "text", basedFieldTypes.map((item) => item.value)) as BasedField["type"] | null;
    if (!type || !basedFieldTypes.some((item) => item.value === type)) { setError("Choose a valid column type."); return; }
    await run(async () => {
      if (type === "linkedRecord") {
        const choices = tables.map((item) => `${item.name} (${item.id.slice(0, 8)})`);
        const selected = await suggest("Target table", choices[0], choices);
        const target = tables.find((item) => selected === `${item.name} (${item.id.slice(0, 8)})`);
        if (!target) throw new Error("Choose an existing table in this database.");
        const leftOrder = nextOrder(catalog.fields.filter((item) => item.table_id === table.id));
        await createBasedRelation(userId, database.id, table.id, target.id, name, leftOrder,
          target.id === table.id ? leftOrder + 1 : nextOrder(catalog.fields.filter((item) => item.table_id === target.id)));
      } else await createBasedField(userId, table.id, name, type,
        nextOrder(catalog.fields.filter((item) => item.table_id === table.id)));
      await refreshCatalog();
    });
  }
  async function addRecord() {
    if (!table) return;
    await run(async () => {
      await createBasedRecord(userId, table.id, await nextBasedRecordOrder(userId, table.id));
      await reloadRows();
    });
  }
  async function archiveFolder(folder: BasedFolder) {
    await run(async () => {
      for (const item of catalog.databases.filter((database) => database.folder_id === folder.id))
        await basedUpdate<BasedDatabase>("based_databases", item.id, { folder_id: null }, userId);
      await basedUpdate<BasedFolder>("based_folders", folder.id, { archived_at: new Date().toISOString() }, userId);
      await refreshCatalog();
    });
  }
  async function moveFolder(folder: BasedFolder, direction: -1 | 1) {
    const folders = order(catalog.folders.filter((item) => !item.archived_at));
    const neighbor = folders[folders.findIndex((item) => item.id === folder.id) + direction];
    if (!neighbor) return;
    await run(async () => {
      await basedUpdate<BasedFolder>("based_folders", folder.id, { sort_order: neighbor.sort_order }, userId);
      await basedUpdate<BasedFolder>("based_folders", neighbor.id, { sort_order: folder.sort_order }, userId);
      await refreshCatalog();
    });
  }
  async function moveDatabase(direction: -1 | 1) {
    if (!database) return;
    const siblings = order(catalog.databases.filter((item) => item.folder_id === database.folder_id && !item.archived_at));
    const neighbor = siblings[siblings.findIndex((item) => item.id === database.id) + direction];
    if (!neighbor) return;
    await run(async () => {
      await basedUpdate<BasedDatabase>("based_databases", database.id, { sort_order: neighbor.sort_order }, userId);
      await basedUpdate<BasedDatabase>("based_databases", neighbor.id, { sort_order: database.sort_order }, userId);
      await refreshCatalog();
    });
  }
  async function saveCell(record: BasedRecord, field: BasedField, value: string | string[] | boolean) {
    setRecords((current) => current.map((item) => item.id === record.id
      ? { ...item, cells: { ...item.cells, [field.id]: value } } : item));
    await run(async () => {
      try { await mergeBasedRecordCells(userId, record.id, { [field.id]: value }); }
      catch (caught) { await reloadRows(); throw caught; }
    });
  }
  async function reloadRows() {
    if (!table) return;
    if (offset === 0) await refreshRows(table.id, 0);
    else setOffset(0);
  }
  async function saveField(field: BasedField, changes: Partial<BasedField>) {
    await run(async () => { await basedUpdate<BasedField>("based_fields", field.id, changes, userId); await refreshCatalog(); });
  }
  function startColumnResize(event: React.PointerEvent<HTMLSpanElement>, fieldId: string) {
    if (event.button !== 0) return;
    const headers = event.currentTarget.closest("table")?.querySelectorAll<HTMLElement>("th[data-field-id]");
    const widths = Object.fromEntries(Array.from(headers ?? [], (header) => [header.dataset.fieldId!, header.getBoundingClientRect().width]));
    if (!widths[fieldId]) return;
    event.preventDefault();
    resizeRef.current = { fieldId, startX: event.clientX, startWidth: widths[fieldId], widths };
    setResizeWidths(widths);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function finishColumnResize(event: React.PointerEvent<HTMLSpanElement>, cancelled = false) {
    const resizing = resizeRef.current;
    if (!resizing) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setResizeWidths(null);
    if (!cancelled) {
      const field = fields.find((item) => item.id === resizing.fieldId);
      if (field) void saveField(field, { width: resizedColumnWidth(resizing.startWidth, event.clientX - resizing.startX) });
    }
  }
  async function moveField(field: BasedField, direction: -1 | 1) {
    const index = fields.findIndex((item) => item.id === field.id);
    const neighbor = fields[index + direction];
    if (!neighbor || field.type === "itemName" || neighbor.type === "itemName") return;
    await run(async () => {
      await basedUpdate<BasedField>("based_fields", field.id, { sort_order: neighbor.sort_order }, userId);
      await basedUpdate<BasedField>("based_fields", neighbor.id, { sort_order: field.sort_order }, userId);
      await refreshCatalog();
    });
  }
  async function moveTable(direction: -1 | 1) {
    if (!table) return;
    const index = tables.findIndex((item) => item.id === table.id);
    const neighbor = tables[index + direction];
    if (!neighbor) return;
    await run(async () => {
      await basedUpdate<BasedTable>("based_tables", table.id, { sort_order: neighbor.sort_order }, userId);
      await basedUpdate<BasedTable>("based_tables", neighbor.id, { sort_order: table.sort_order }, userId);
      await refreshCatalog();
    });
  }
  async function toggleLink(field: BasedField, record: BasedRecord, targetId: string, checked: boolean) {
    if (!field.relation_id) return;
    const left = field.relation_side === "left" ? record.id : targetId;
    const right = field.relation_side === "right" ? record.id : targetId;
    await run(async () => {
      await setBasedLink(userId, field.relation_id!, left, right, checked);
      setLinks(await loadBasedLinks(userId));
    });
  }
  function linkedIds(field: BasedField, record: BasedRecord) {
    return links.filter((link) => link.relation_id === field.relation_id &&
      (field.relation_side === "left" ? link.left_record_id === record.id : link.right_record_id === record.id))
      .map((link) => field.relation_side === "left" ? link.right_record_id : link.left_record_id);
  }
  function recordName(record: BasedRecord) {
    const nameField = catalog.fields.find((field) => field.table_id === record.table_id && field.type === "itemName");
    return cellText(nameField ? record.cells[nameField.id] : "") || "Unnamed record";
  }
  function renderCell(record: BasedRecord, field: BasedField) {
    const value = record.cells[field.id];
    if (field.type === "checkbox") return <input type="checkbox" aria-label={`${field.name} for ${recordName(record)}`}
      checked={value === true} onChange={(event) => void saveCell(record, field, event.target.checked)} />;
    if (field.type === "singleSelect") return <select aria-label={`${field.name} for ${recordName(record)}`}
      value={typeof value === "string" ? value : ""} onChange={(event) => void saveCell(record, field, event.target.value)}>
      <option value="">—</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>;
    if (field.type === "multiSelect" || field.type === "linkedRecord") {
      const relation = catalog.relations.find((item) => item.id === field.relation_id);
      const targetId = field.relation_side === "left" ? relation?.right_table_id : relation?.left_table_id;
      const targets = field.type === "linkedRecord" ? linkMatches : [];
      const chosen = field.type === "linkedRecord" ? linkedIds(field, record) : Array.isArray(value) ? value : [];
      const label = field.type === "linkedRecord" ? chosen.map((id) => {
        const item = [...targets, ...(relatedRecords[targetId ?? ""] ?? [])].find((record) => record.id === id);
        return item ? recordName(item) : id.slice(0, 8);
      }).join(", ") : chosen.join(", ");
      const open = cellMenu?.recordId === record.id && cellMenu.fieldId === field.id;
      return <div className="based-choice-cell">
        <button type="button" onClick={() => { setLinkSearch(""); setCellMenu(open ? null : { recordId: record.id, fieldId: field.id }); }}>{label || "＋"}</button>
        {open && <div className="based-choice-menu">
          {field.type === "linkedRecord" && <input aria-label="Search linked records" placeholder="Search records" value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} />}
          {(field.type === "linkedRecord" ? [
            ...targets.map((item) => ({ id: item.id, name: recordName(item) })),
            ...chosen.filter((id) => !targets.some((item) => item.id === id)).map((id) => ({ id,
              name: (relatedRecords[targetId ?? ""] ?? []).find((item) => item.id === id)
                ? recordName((relatedRecords[targetId ?? ""] ?? []).find((item) => item.id === id)!) : id.slice(0, 8) })),
          ] : field.options.map((item) => ({ id: item, name: item })))
            .map((item) => <label key={item.id}><input type="checkbox" checked={chosen.includes(item.id)}
              onChange={(event) => field.type === "linkedRecord"
                ? void toggleLink(field, record, item.id, event.target.checked)
                : void saveCell(record, field, event.target.checked ? [...chosen, item.id] : chosen.filter((id) => id !== item.id))} />{item.name}</label>)}
          <button type="button" onClick={() => setCellMenu(null)}>Done</button>
        </div>}
      </div>;
    }
    if (wrap && (field.type === "itemName" || field.type === "text")) return <textarea
      aria-label={`${field.name} for ${recordName(record)}`} rows={2}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => {
        const next = event.target.value;
        setRecords((current) => current.map((item) => item.id === record.id ? { ...item, cells: { ...item.cells, [field.id]: next } } : item));
      }}
      onBlur={(event) => { void saveCell(record, field, event.target.value); }} />;
    return <input aria-label={`${field.name} for ${recordName(record)}`}
      type={field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => {
        const next = event.target.value;
        setRecords((current) => current.map((item) => item.id === record.id ? { ...item, cells: { ...item.cells, [field.id]: next } } : item));
      }}
      onBlur={(event) => { void saveCell(record, field, event.target.value); }} />;
  }

  const displayed = records;
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const context = canvas?.getContext("2d");
  if (context) context.font = "13px Inter, sans-serif";
  const measure = (value: string) => context?.measureText(value).width ?? value.length * 7;
  const fieldWidths = visibleFields.map((field) => resizeWidths?.[field.id] ?? (field.width == null
    ? resizedColumnWidth(Math.max(measure(field.name || "Untitled") + 48,
      ...records.map((record) => measure(cellText(record.cells[field.id]).split("\n").sort((a, b) => b.length - a.length)[0] ?? "") + 28)), 0)
    : resizedColumnWidth(field.width, 0)));

  function download(name: string, value: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function doExport() { await run(async () => download("based-backup.json", await exportBased(userId))); }
  async function doImport(file: File) {
    await run(async () => {
      const backup = JSON.parse(await file.text()) as BasedBackup;
      if (backup.format !== "based-workspace" || backup.version !== 1) throw new Error("Unsupported Based backup.");
      if (!await confirmAction("Replace all Based data with this backup? Noted notes will not change.", "Replace")) return;
      await restoreBased(userId, backup); await refreshCatalog();
    });
  }

  const activeDatabases = order(catalog.databases.filter((item) => !item.archived_at && item.name.toLowerCase().includes(sidebarSearch.toLowerCase())));
  const archivedDatabases = catalog.databases.filter((item) => item.archived_at);
  return <div className={`app-shell based-app ${railVisible ? "" : "rail-hidden"} ${mobileRailOpen ? "mobile-rail-open" : ""}`} style={{ "--rail": `${railWidth}px` } as React.CSSProperties}>
    <button type="button" className="mobile-rail-backdrop" aria-label="Close sidebar" onClick={() => setMobileRailOpen(false)} />
    <aside className="document-rail" aria-label="Based databases" id="based-rail">
      <div className="rail-actions">
        <button type="button" className="rail-brand based-brand" title="Switch to Noted" onClick={onSwitch}>Based</button>
        <div className="rail-tools">
          <button type="button" className="icon-button" aria-label="Hide sidebar" title="Hide sidebar" onClick={() => { setRailVisible(false); localStorage.setItem("noted-sidebar-visible", "false"); }}><PanelLeftClose size={18} /></button>
          <button type="button" className={`icon-button ${searchingSidebar ? "is-active" : ""}`} aria-label="Search databases" title="Search databases" onClick={() => setSearchingSidebar((value) => !value)}><Search size={18} /></button>
          <button type="button" className="new-note" aria-label="New database" title="New database" onClick={() => void addDatabase()}><Plus size={18} /></button>
          <button type="button" className="mobile-rail-close" aria-label="Close sidebar" onClick={() => setMobileRailOpen(false)}><X size={18} /></button>
        </div>
      </div>
      {searchingSidebar && <div className="search-box"><Search size={15} /><input autoFocus aria-label="Search databases" placeholder="Search databases" value={sidebarSearch} onChange={(event) => setSidebarSearch(event.target.value)} />{sidebarSearch && <button aria-label="Clear search" onClick={() => setSidebarSearch("")}><X size={14} /></button>}</div>}
      <div className="document-list">
        <div className="rail-section-heading"><p className="rail-label">Folders</p><button type="button" aria-label="Create folder" title="Create folder" onClick={() => void addFolder()}><FolderPlus size={16} /></button></div>
        {order(catalog.folders.filter((item) => !item.archived_at)).map((folder) => <div key={folder.id} className="based-folder">
          <div className="based-folder-heading"><button className="based-folder-toggle" aria-label={`${folder.collapsed ? "Expand" : "Collapse"} ${folder.name}`}
            aria-expanded={!folder.collapsed} onClick={() => void run(async () => {
              await basedUpdate<BasedFolder>("based_folders", folder.id, { collapsed: !folder.collapsed }, userId); await refreshCatalog();
            })}>{folder.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<span>{folder.name}</span></button><button className="based-folder-new" aria-label={`New database in ${folder.name}`} title={`New database in ${folder.name}`} onClick={() => void addDatabase(folder.id)}><Plus size={16} /></button>
            <button aria-label={`Folder actions for ${folder.name}`} onClick={async () => {
              const action = await suggest("Folder action", "rename", ["rename", "move up", "move down", "archive"]);
              if (action === "archive") { void archiveFolder(folder); return; }
              if (action === "move up") { void moveFolder(folder, -1); return; }
              if (action === "move down") { void moveFolder(folder, 1); return; }
              if (action !== "rename") return;
              const name = await suggest("Rename folder", folder.name);
              if (name) void run(async () => { await basedUpdate<BasedFolder>("based_folders", folder.id, { name }, userId); await refreshCatalog(); });
            }}><Ellipsis size={14} /></button></div>
          {!folder.collapsed && activeDatabases.filter((item) => item.folder_id === folder.id).map((item) => <button key={item.id} type="button"
            className={`based-sidebar-item ${databaseId === item.id ? "is-selected" : ""}`} onClick={() => { clearTableControls(); setDatabaseId(item.id); setTableId(null); }}>{item.name}</button>)}
        </div>)}
        <p className="rail-label drop-target">Databases</p>
        {activeDatabases.filter((item) => !item.folder_id).map((item) => <button key={item.id} type="button"
          className={`based-sidebar-item ${databaseId === item.id ? "is-selected" : ""}`} onClick={() => { clearTableControls(); setDatabaseId(item.id); setTableId(null); }}>{item.name}</button>)}
        {!catalog.databases.length && <p className="empty-list">Create a database to begin.</p>}
        {archivedDatabases.length > 0 && <details className="archive-list"><summary>Archived ({archivedDatabases.length})</summary>
          {archivedDatabases.map((item) => <div className="archive-row" key={item.id}><span>{item.name}</span>
            <button aria-label={`Restore ${item.name}`} onClick={() => void run(async () => { await basedUpdate<BasedDatabase>("based_databases", item.id, { archived_at: null }, userId); await refreshCatalog(); })}><ArchiveRestore size={14} /></button></div>)}
        </details>}
        {catalog.folders.some((item) => item.archived_at) && <details className="archive-list"><summary>Archived folders</summary>
          {catalog.folders.filter((item) => item.archived_at).map((item) => <div className="archive-row" key={item.id}><span>{item.name}</span>
            <button aria-label={`Restore folder ${item.name}`} onClick={() => void run(async () => {
              await basedUpdate<BasedFolder>("based_folders", item.id, { archived_at: null }, userId); await refreshCatalog();
            })}><ArchiveRestore size={14} /></button></div>)}</details>}
      </div>
      <div className="rail-footer"><button className="icon-button" title="Based settings" aria-label="Based settings" onClick={() => setShowSettings(true)}><Ellipsis size={19} /></button></div>
    </aside>
    <main className="workspace">
      <header className="workspace-header">
        <div className="workspace-location">
          {!railVisible && <button type="button" className="sidebar-show" aria-label="Show sidebar" title="Show sidebar" onClick={() => { setRailVisible(true); localStorage.setItem("noted-sidebar-visible", "true"); }}><PanelLeftOpen size={18} /></button>}
          <span className="document-breadcrumb desktop-breadcrumb">{database?.name ?? "Based"}</span>
        </div>
        <button type="button" className="document-breadcrumb mobile-rail-toggle" aria-label="Open sidebar" onClick={() => setMobileRailOpen(true)}><span>{database?.name ?? "Based"}</span><ChevronDown size={14} /></button>
        <div className="header-actions"><span className="based-save-label">{isSupabaseConfigured ? "Saved to Supabase" : "Saved on this device"}</span>
          {database && <button className="header-button" onClick={async () => {
            const name = await suggest("Rename database", database.name);
            if (name) void run(async () => { await basedUpdate<BasedDatabase>("based_databases", database.id, { name }, userId); await refreshCatalog(); });
          }}>Rename</button>}
          {database && <button className="header-button" onClick={async () => {
            const choices = ["No folder", ...catalog.folders.filter((item) => !item.archived_at).map((item) => `${item.name} (${item.id.slice(0, 8)})`)];
            const selected = await suggest("Move database to folder", "No folder", choices);
            if (!selected) return;
            const folder = catalog.folders.find((item) => selected.endsWith(`(${item.id.slice(0, 8)})`));
            void run(async () => { await basedUpdate<BasedDatabase>("based_databases", database.id, { folder_id: folder?.id ?? null }, userId); await refreshCatalog(); });
          }}>Move</button>}
          {database && <button className="header-button" aria-label="Move database up" onClick={() => void moveDatabase(-1)}>↑</button>}
          {database && <button className="header-button" aria-label="Move database down" onClick={() => void moveDatabase(1)}>↓</button>}
          {database && <button className="header-button" onClick={async () => {
            if (!await confirmAction(`Archive “${database.name}”?`, "Archive")) return;
            void run(async () => { await basedUpdate<BasedDatabase>("based_databases", database.id, { archived_at: new Date().toISOString() }, userId); await refreshCatalog(); });
          }}>Archive</button>}
        </div>
      </header>
      {loading ? <div className="editor-loading">Loading Based…</div> : !database ? <div className="based-empty">Create a database using the + button in the sidebar.</div> : <>
        <div className="based-tabs" role="tablist" aria-label="Tables">
          {tables.map((item) => <button key={item.id} role="tab" aria-selected={table?.id === item.id}
            className={table?.id === item.id ? "is-active" : ""} onClick={() => openTable(item.id)}>{item.name}</button>)}
          <button type="button" aria-label="New table" title="New table" onClick={() => void addTable()}><Plus size={16} /></button>
          {archivedTables.length > 0 && <select aria-label="Restore archived table" value="" onChange={(event) => {
            const id = event.target.value; if (!id) return;
            void run(async () => { await basedUpdate<BasedTable>("based_tables", id, { archived_at: null }, userId); await refreshCatalog(); openTable(id); });
          }}><option value="">Archived tables</option>{archivedTables.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        </div>
        {table && <div className="based-table-area">
          <div className="based-table-toolbar">
            <strong>{table.name}</strong>
            <button onClick={async () => { const name = await suggest("Rename table", table.name); if (name) void run(async () => { await basedUpdate<BasedTable>("based_tables", table.id, { name }, userId); await refreshCatalog(); }); }}>Rename table</button>
            <button aria-label="Move table left" disabled={tables[0]?.id === table.id} onClick={() => void moveTable(-1)}>←</button>
            <button aria-label="Move table right" disabled={tables[tables.length - 1]?.id === table.id} onClick={() => void moveTable(1)}>→</button>
            <button onClick={async () => {
              if (!await confirmAction(`Archive table “${table.name}”?`, "Archive")) return;
              clearTableControls();
              void run(async () => { await basedUpdate<BasedTable>("based_tables", table.id, { archived_at: new Date().toISOString() }, userId); await refreshCatalog(); });
            }}>Archive table</button>
            <input aria-label="Search rows" placeholder="Search rows" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
            <button ref={filterButtonRef} type="button" className={filter ? "is-active" : ""} aria-label="Filter records" aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}>Filter{filter ? " · 1" : ""}</button>
            <select aria-label="Sort field" value={sortFieldId} onChange={(event) => { setSortFieldId(event.target.value); setOffset(0); }}><option value="">Sort</option>{queryableFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
            {sortFieldId && <button onClick={() => { setSortDescending((current) => !current); setOffset(0); }}>{sortDescending ? "↓" : "↑"}</button>}
            <select aria-label="Group field" value={groupFieldId} onChange={(event) => { setGroupFieldId(event.target.value); setOffset(0); }}><option value="">Group</option>{queryableFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>
            <button aria-pressed={wrap} onClick={() => setWrap((current) => !current)}>Wrap {wrap ? "on" : "off"}</button>
            <button onClick={() => void addField()}>＋ Column</button>
          </div>
          <div className="based-grid-scroll" onScroll={(event) => loadMoreRows(event.currentTarget)}><table className={`based-grid ${wrap ? "is-wrapped" : ""}`} style={{ width: fieldWidths.reduce((sum, width) => sum + width, 84) }}>
            <colgroup><col style={{ width: 44 }} />{visibleFields.map((field, index) => <col key={field.id} style={{ width: fieldWidths[index] }} />)}<col style={{ width: 40 }} /></colgroup>
            <thead><tr><th className="based-row-number">#</th>{visibleFields.map((field) => <th key={field.id} data-field-id={field.id}>
              <button className="based-field-name" onClick={async () => {
                const name = await suggest("Rename column", field.name); if (name) void saveField(field, { name });
              }}>{field.name}<ChevronDown size={13} /></button>
              <button className="based-field-settings" aria-label={`Settings for ${field.name}`} onClick={async () => {
                const action = await suggest("Column action", "options", ["options", "hide", "width", "move left", "move right", "archive"]);
                if (action === "options" && (field.type === "singleSelect" || field.type === "multiSelect")) {
                  const values = await suggest("Options, separated by commas", field.options.join(", "));
                  if (values !== null) void saveField(field, { options: values.split(",").map((item) => item.trim()).filter(Boolean) });
                } else if (action === "hide") void saveField(field, { hidden: true });
                else if (action === "width") { const width = Number(await suggest("Width in pixels (120–420)", String(field.width ?? 210))); if (width >= 120 && width <= 420) void saveField(field, { width }); }
                else if (action === "move left") void moveField(field, -1);
                else if (action === "move right") void moveField(field, 1);
                else if (action === "archive" && field.type !== "itemName" && await confirmAction(`Archive column “${field.name}”? Its values will be kept.`, "Archive"))
                  void saveField(field, { archived_at: new Date().toISOString() });
              }}><Ellipsis size={13} /></button>
              <span className="database-column-resize" role="separator" aria-label={`Resize ${field.name} column`}
                aria-orientation="vertical" aria-valuenow={Math.round(fieldWidths[visibleFields.indexOf(field)])}
                aria-valuemin={120} aria-valuemax={420} tabIndex={0}
                onPointerDown={(event) => startColumnResize(event, field.id)}
                onDoubleClick={() => void saveField(field, { width: null })}
                onPointerMove={(event) => { const resizing = resizeRef.current; if (resizing) setResizeWidths({ ...resizing.widths, [resizing.fieldId]: resizedColumnWidth(resizing.startWidth, event.clientX - resizing.startX) }); }}
                onPointerUp={(event) => finishColumnResize(event)}
                onPointerCancel={(event) => finishColumnResize(event, true)}
                onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); void saveField(field, { width: resizedColumnWidth(fieldWidths[visibleFields.indexOf(field)], event.key === "ArrowRight" ? 10 : -10) }); } }} />
            </th>)}<th className="based-add-column"><button onClick={() => void addField()} aria-label="Add column">＋</button></th></tr></thead>
            <tbody>{displayed.map((record, index) => <Fragment key={record.id}>
              {groupFieldId && (index === 0 || cellText(displayed[index - 1]?.cells[groupFieldId]) !== cellText(record.cells[groupFieldId])) &&
                <tr className="based-group-end"><td colSpan={visibleFields.length + 2}>{cellText(record.cells[groupFieldId]) || "Empty"}</td></tr>}
              <tr>
              <td className="based-row-number">{index + 1}</td>
              {visibleFields.map((field) => <td key={field.id}>{renderCell(record, field)}</td>)}
              <td className="based-row-actions"><button aria-label={`Archive row ${index + 1}`} onClick={async () => {
                if (!await confirmAction("Archive this record?", "Archive")) return;
                void run(async () => { await basedUpdate<BasedRecord>("based_records", record.id, { archived_at: new Date().toISOString() }, userId); await reloadRows(); setArchivedRecords(await loadArchivedBasedRecords(userId, table.id)); });
              }}>×</button></td>
            </tr></Fragment>)}
              {!displayed.length && <tr><td colSpan={visibleFields.length + 2} className="based-no-rows">No rows</td></tr>}
            </tbody>
          </table></div>
          <div className="based-grid-footer"><button onClick={() => void addRecord()}>＋ New row</button><span>{records.length} of {recordCount} records{loadingRows ? " · Loading…" : ""}</span></div>
          {fields.some((field) => field.hidden) && <div className="based-hidden-fields">Hidden columns: {fields.filter((field) => field.hidden).map((field) => <button key={field.id} onClick={() => void saveField(field, { hidden: false })}>{field.name} ＋</button>)}</div>}
          {archivedFields.length > 0 && <details className="based-hidden-fields"><summary>Archived columns ({archivedFields.length})</summary>
            {archivedFields.map((field) => <button key={field.id} onClick={() => void saveField(field, { archived_at: null })}>{field.name} <ArchiveRestore size={12} /></button>)}
          </details>}
          {archivedRecords.length > 0 && <details className="based-hidden-fields"><summary>Archived records ({archivedRecords.length})</summary>
            {archivedRecords.map((record) => <button key={record.id} aria-label={`Restore ${recordName(record)}`} onClick={() => void run(async () => {
              await basedUpdate<BasedRecord>("based_records", record.id, { archived_at: null }, userId);
              await reloadRows(); setArchivedRecords(await loadArchivedBasedRecords(userId, table.id));
            })}>{recordName(record)} <ArchiveRestore size={12} /></button>)}
          </details>}
        </div>}
      </>}
    </main>
    {filterOpen && table && <div ref={filterPopoverRef} className="based-filter-popover" role="dialog" aria-label="Filter records"
      style={{ left: Math.max(12, Math.min(filterButtonRef.current?.getBoundingClientRect().left ?? 12, window.innerWidth - 356)),
        top: Math.max(12, Math.min((filterButtonRef.current?.getBoundingClientRect().bottom ?? 50) + 6, window.innerHeight - 220)) }}>
      <div className="based-filter-heading"><strong>Filter records</strong><button type="button" aria-label="Close filters" onClick={() => setFilterOpen(false)}><X size={15} /></button></div>
      <p>Show records where</p>
      <div className="based-filter-condition">
        <select autoFocus aria-label="Filter field" value={filter?.fieldId ?? ""} onChange={(event) => { setFilter(event.target.value ? { fieldId: event.target.value, mode: "contains", value: "" } : null); setOffset(0); }}>
          <option value="">Choose a field</option>{queryableFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select>
        {filter && <><select aria-label="Filter condition" value={filter.mode} onChange={(event) => { setFilter({ ...filter, mode: event.target.value as Filter["mode"] }); setOffset(0); }}>
          <option value="contains">contains</option><option value="equals">is</option><option value="empty">is empty</option><option value="notEmpty">is not empty</option></select>
          {(filter.mode === "contains" || filter.mode === "equals") && <input aria-label="Filter value" placeholder="Enter a value" value={filter.value} onChange={(event) => { setFilter({ ...filter, value: event.target.value }); setOffset(0); }} />}</>}
      </div>
      {filter && <button type="button" className="based-filter-clear" onClick={() => { setFilter(null); setOffset(0); }}>Clear condition</button>}
    </div>}
    {showSettings && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false); }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Based settings">
        <div className="modal-heading"><div><h2>Based settings</h2><p>Back up and restore your databases separately from Noted.</p></div>
          <button className="icon-button" aria-label="Close" onClick={() => setShowSettings(false)}><X size={18} /></button></div>
        <div className="setting-row"><div><h3>Backup and restore</h3><p>Download a versioned JSON backup of Based.</p></div>
          <div className="setting-actions"><button onClick={() => void doExport()}><Download size={16} /> Export</button>
            <label className="button-label"><Upload size={16} /> Import<input type="file" accept="application/json" onChange={(event) => {
              const file = event.target.files?.[0]; if (file) void doImport(file);
            }} /></label></div></div>
        {isSupabaseConfigured && <div className="setting-row"><div><h3>Account</h3><p>Based uses your Noted sign-in.</p></div><button onClick={() => void signOut()}>Sign out</button></div>}
      </section>
    </div>}
    {question && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) answer(null); }}>
      <form className="rail-dialog based-question" role="dialog" aria-modal="true" aria-label={question.label} onSubmit={(event) => { event.preventDefault(); answer(question.value); }}>
        <h2>{question.label}</h2>
        {question.choices ? <select autoFocus aria-label={question.label} value={question.value} onChange={(event) => setQuestion({ ...question, value: event.target.value })}>
          {question.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>
          : <input autoFocus aria-label={question.label} value={question.value} onChange={(event) => setQuestion({ ...question, value: event.target.value })} />}
        <div className="rail-dialog-actions"><button type="button" onClick={() => answer(null)}>Cancel</button><button type="submit" className="rail-dialog-primary" disabled={!question.value.trim()}>{question.choices ? "Continue" : "Save"}</button></div>
      </form>
    </div>}
    {error && <div className="error-toast" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
  </div>;
}
