import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChevronDown, Pencil, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ColumnType = "itemName" | "text" | "number" | "date" | "singleSelect" | "multiSelect" | "url";
export type DatabaseColumn = { id: string; name: string; type: ColumnType; options: string[]; width?: number };
export type DatabaseRow = { id: string; cells: Record<string, string | string[]> };
export type DatabaseFilter = { columnId: string; operator: "contains" | "equals" | "empty" | "notEmpty"; value: string };
export const minColumnWidth = 120;
export const maxColumnWidth = 420;

export const columnTypes: { value: ColumnType; label: string }[] = [
  { value: "itemName", label: "Item Name" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "singleSelect", label: "Single Select" },
  { value: "multiSelect", label: "Multi-Select" },
  { value: "url", label: "URL" },
];

export function matchingMultiSelectOptions(options: string[], selected: string[], query: string): string[] {
  const normalized = query.trim().toLocaleLowerCase();
  return options
    .filter((option) => !selected.includes(option) && option.toLocaleLowerCase().includes(normalized))
    .sort((first, second) => {
      const firstStarts = first.toLocaleLowerCase().startsWith(normalized);
      const secondStarts = second.toLocaleLowerCase().startsWith(normalized);
      return Number(secondStarts) - Number(firstStarts) || first.localeCompare(second);
    });
}

export function resizedColumnWidth(startWidth: number, distance: number): number {
  return Math.max(minColumnWidth, Math.min(maxColumnWidth, Math.round(startWidth + distance)));
}

function cellText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

export function visibleDatabaseRows(rows: DatabaseRow[], columns: DatabaseColumn[], search: string, filter: DatabaseFilter | null): DatabaseRow[] {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (query && !columns.some((column) => cellText(row.cells[column.id]).toLocaleLowerCase().includes(query))) return false;
    if (!filter || !columns.some((column) => column.id === filter.columnId)) return true;
    const value = row.cells[filter.columnId];
    const text = cellText(value).toLocaleLowerCase();
    const needle = filter.value.trim().toLocaleLowerCase();
    if (filter.operator === "empty") return !text.trim();
    if (filter.operator === "notEmpty") return Boolean(text.trim());
    if (!needle) return true;
    if (filter.operator === "equals") return Array.isArray(value) ? value.some((item) => item.toLocaleLowerCase() === needle) : text === needle;
    return text.includes(needle);
  });
}

export function databaseRowGroups(rows: DatabaseRow[], column: DatabaseColumn | undefined): { label: string; rows: DatabaseRow[] }[] {
  if (!column) return [{ label: "", rows }];
  const groups = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const label = cellText(row.cells[column.id]).trim() || "Empty";
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return Array.from(groups, ([label, groupedRows]) => ({ label, rows: groupedRows }));
}

export function contentColumnWidth(column: DatabaseColumn, rows: DatabaseRow[], measure: (text: string) => number): number {
  const headerWidth = measure(column.name || "Untitled") + 48;
  const cellWidth = rows.reduce((width, row) => {
    const value = row.cells[column.id];
    const text = cellText(value);
    const candidate = column.type === "multiSelect" && Array.isArray(value)
      ? value.reduce((sum, tag) => sum + measure(tag) + 22, 0) + 20
      : measure(text.split("\n").sort((a, b) => b.length - a.length)[0] ?? "") + 28;
    return Math.max(width, candidate);
  }, 0);
  return resizedColumnWidth(Math.max(headerWidth, cellWidth), 0);
}

export function defaultColumnWidth(type: ColumnType): number {
  if (type === "singleSelect" || type === "multiSelect") return 240;
  if (type === "date") return 170;
  if (type === "number") return 140;
  return 200;
}

export function externalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

export function newDatabase() {
  return {
    title: "Untitled database",
    columns: [
      { id: crypto.randomUUID(), name: "Item Name", type: "itemName", options: [] },
      ...[1, 2, 3].map((number) => ({ id: crypto.randomUUID(), name: `Text ${number}`, type: "text" as const, options: [] })),
    ] as DatabaseColumn[],
    rows: [{ id: crypto.randomUUID(), cells: {} }] as DatabaseRow[],
  };
}

function parseArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function DatabaseView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const title = String(node.attrs.title ?? "Untitled database");
  const columns = (node.attrs.columns ?? []) as DatabaseColumn[];
  const rows = (node.attrs.rows ?? []) as DatabaseRow[];
  const filter = (node.attrs.filter ?? null) as DatabaseFilter | null;
  const groupBy = String(node.attrs.groupBy ?? "");
  const wrap = Boolean(node.attrs.wrap);
  const rootRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<null | { columnId: string; startX: number; startWidth: number; widths: Record<string, number> }>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const multiMenuId = useId();
  const [popover, setPopover] = useState<null | { kind: "new" | "edit"; columnId?: string; top: number; left: number }>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [newOption, setNewOption] = useState("");
  const [multiMenu, setMultiMenu] = useState<null | { rowId: string; columnId: string; top: number; left: number; width: number }>(null);
  const [multiQuery, setMultiQuery] = useState("");
  const [multiHighlighted, setMultiHighlighted] = useState(0);
  const [resizeWidths, setResizeWidths] = useState<Record<string, number> | null>(null);
  const [textEditor, setTextEditor] = useState<null | { rowId: string; columnId: string; top: number; left: number; width: number }>(null);
  const [editingUrl, setEditingUrl] = useState<null | { rowId: string; columnId: string }>(null);
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  useLayoutEffect(() => {
    if (!textEditor || !textEditorRef.current) return;
    const element = textEditorRef.current;
    element.focus();
    sizeTextEditor(element);
  }, [textEditor?.rowId, textEditor?.columnId]);

  useEffect(() => {
    if (!textEditor) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (!target.closest(".database-text-editor, .database-text-cell")) setTextEditor(null);
    }
    function handleScroll(event: Event) {
      if (!(event.target instanceof Element) || !event.target.closest(".database-text-editor")) setTextEditor(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [textEditor]);

  useEffect(() => {
    if (!popover) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (!rootRef.current?.contains(target)
        || !target.closest(".database-popover, [data-database-menu-trigger]")) setPopover(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPopover(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popover]);

  useEffect(() => {
    if (!multiMenu) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (!rootRef.current?.contains(target) || !target.closest(".database-multi-cell, .database-multi-menu")) setMultiMenu(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [multiMenu]);

  useLayoutEffect(() => {
    if (!multiMenu) return;
    const root = rootRef.current;
    const cell = root?.querySelector<HTMLElement>("[data-multi-active='true']")?.closest("td");
    if (!root || !cell) return;
    const rootRect = root.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const width = Math.min(Math.max(220, cellRect.width), rootRect.width);
    const top = cellRect.bottom - rootRect.top + 4;
    const left = Math.max(0, Math.min(cellRect.left - rootRect.left, rootRect.width - width));
    setMultiMenu((current) => current && (current.top !== top || current.left !== left || current.width !== width)
      ? { ...current, top, left, width } : current);
  }, [rows, multiMenu?.rowId, multiMenu?.columnId]);

  function openMultiMenu(rowId: string, columnId: string, cell: HTMLElement) {
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const width = Math.min(Math.max(220, cellRect.width), rootRect.width);
    setMultiMenu({ rowId, columnId, top: cellRect.bottom - rootRect.top + 4,
      left: Math.max(0, Math.min(cellRect.left - rootRect.left, rootRect.width - width)), width });
    if (multiMenu?.rowId !== rowId || multiMenu.columnId !== columnId) setMultiQuery("");
    setMultiHighlighted(0);
    setPopover(null);
  }

  function chooseSelectOption(row: DatabaseRow, column: DatabaseColumn, option: string, create: boolean) {
    const selected = Array.isArray(row.cells[column.id]) ? row.cells[column.id] as string[] : [];
    if (column.type === "multiSelect" && selected.includes(option)) return;
    updateAttributes({
      columns: create ? columns.map((item) => item.id === column.id
        ? { ...item, options: [...item.options, option] } : item) : columns,
      rows: rows.map((item) => item.id === row.id
        ? { ...item, cells: { ...item.cells, [column.id]: column.type === "singleSelect" ? option : [...selected, option] } } : item),
    });
    setMultiQuery("");
    setMultiHighlighted(0);
    if (column.type === "singleSelect") {
      rootRef.current?.querySelector<HTMLInputElement>("[data-multi-active='true'] .database-multi-input")?.blur();
      setMultiMenu(null);
    }
  }

  function openPopover(event: React.MouseEvent<HTMLButtonElement>, kind: "new" | "edit", columnId?: string) {
    if (popover?.kind === kind && popover.columnId === columnId) {
      setPopover(null);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    setPopover({
      kind, columnId,
      top: buttonRect.bottom - rootRect.top + 6,
      left: Math.max(0, Math.min(buttonRect.left - rootRect.left, rootRect.width - 248)),
    });
    if (kind === "new") setNewColumnName("");
    if (kind === "edit") setNewOption("");
  }

  function changeColumn(id: string, change: Partial<DatabaseColumn>) {
    updateAttributes({ columns: columns.map((column) => column.id === id ? { ...column, ...change } : column) });
  }

  function changeCell(rowId: string, columnId: string, value: string | string[]) {
    updateAttributes({ rows: rows.map((row) => row.id === rowId
      ? { ...row, cells: { ...row.cells, [columnId]: value } } : row) });
  }

  function addOption(column: DatabaseColumn) {
    const option = newOption.trim();
    if (!option || column.options.includes(option)) return;
    changeColumn(column.id, { options: [...column.options, option] });
    setNewOption("");
  }

  function removeOption(column: DatabaseColumn, option: string) {
    updateAttributes({
      columns: columns.map((item) => item.id === column.id
        ? { ...item, options: item.options.filter((value) => value !== option) } : item),
      rows: rows.map((row) => {
        const value = row.cells[column.id];
        if (Array.isArray(value)) return { ...row, cells: { ...row.cells,
          [column.id]: value.filter((item) => item !== option) } };
        if (value === option) return { ...row, cells: { ...row.cells, [column.id]: "" } };
        return row;
      }),
    });
  }

  function addColumn(type: ColumnType) {
    const id = crypto.randomUUID();
    const name = newColumnName.trim() || columnTypes.find((item) => item.value === type)?.label || "New column";
    updateAttributes({ columns: [...columns, { id, name, type, options: [] }] });
    setPopover(null);
  }

  function measuredColumnWidths(): Record<string, number> {
    const headers = rootRef.current?.querySelectorAll<HTMLElement>(".database-table th[data-column-id]");
    return Object.fromEntries(Array.from(headers ?? [], (header) =>
      [header.dataset.columnId!, header.getBoundingClientRect().width]));
  }

  function startColumnResize(event: React.PointerEvent<HTMLSpanElement>, columnId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    const widths = measuredColumnWidths();
    if (!widths[columnId]) return;
    resizeRef.current = { columnId, startX: event.clientX, startWidth: widths[columnId], widths };
    setResizeWidths(widths);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveColumnResize(event: React.PointerEvent<HTMLSpanElement>) {
    const resizing = resizeRef.current;
    if (!resizing) return;
    setResizeWidths({ ...resizing.widths,
      [resizing.columnId]: resizedColumnWidth(resizing.startWidth, event.clientX - resizing.startX) });
  }

  function finishColumnResize(event: React.PointerEvent<HTMLSpanElement>, cancelled = false) {
    const resizing = resizeRef.current;
    if (!resizing) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setResizeWidths(null);
    if (cancelled) return;
    const widths = { ...resizing.widths,
      [resizing.columnId]: resizedColumnWidth(resizing.startWidth, event.clientX - resizing.startX) };
    updateAttributes({ columns: columns.map((column) => column.id === resizing.columnId
      ? { ...column, width: widths[column.id] } : column) });
  }

  function sizeTextEditor(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(320, window.innerHeight - 32, Math.max(80, element.scrollHeight))}px`;
    if (element.parentElement && textEditor) {
      const height = element.parentElement.getBoundingClientRect().height;
      element.parentElement.style.top = `${Math.max(12, Math.min(textEditor.top, window.innerHeight - height - 12))}px`;
    }
  }

  function openTextEditor(rowId: string, columnId: string, cell: HTMLElement) {
    const rect = cell.getBoundingClientRect();
    const width = Math.min(Math.max(320, rect.width), window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 100));
    setTextEditor({ rowId, columnId, top, left, width });
    setMultiMenu(null);
    setPopover(null);
  }

  function renderCell(row: DatabaseRow, column: DatabaseColumn) {
    const value = row.cells[column.id];
    const label = `${column.name} for row ${rows.indexOf(row) + 1}`;
    if (column.type === "singleSelect" || column.type === "multiSelect") {
      const selected = column.type === "singleSelect"
        ? typeof value === "string" && value ? [value] : []
        : Array.isArray(value) ? value : [];
      const isOpen = multiMenu?.rowId === row.id && multiMenu.columnId === column.id;
      const matches = matchingMultiSelectOptions(column.options, selected, isOpen ? multiQuery : "");
      return <div className="database-multi-cell" data-multi-cell data-multi-active={isOpen} data-has-tags={selected.length > 0}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.querySelector("input")?.focus(); }}>
        {selected.map((option) => <button key={option} type="button" className="database-tag"
          aria-label={`Remove ${option} from ${label}`}
          onClick={() => changeCell(row.id, column.id, column.type === "singleSelect" ? "" : selected.filter((item) => item !== option))}>{option} ×</button>)}
        <input
          className="database-multi-input"
          aria-label={`${column.type === "singleSelect" ? "Choose" : "Add"} ${label}`}
          aria-expanded={isOpen}
          aria-controls={isOpen ? multiMenuId : undefined}
          aria-activedescendant={isOpen && matches.length ? `${multiMenuId}-option-${Math.min(multiHighlighted, matches.length - 1)}` : undefined}
          role="combobox"
          autoComplete="off"
          value={isOpen ? multiQuery : ""}
          onFocus={(event) => openMultiMenu(row.id, column.id, event.currentTarget.closest("td")!)}
          onClick={(event) => { if (!isOpen) openMultiMenu(row.id, column.id, event.currentTarget.closest("td")!); }}
          onChange={(event) => { setMultiQuery(event.target.value); setMultiHighlighted(0); }}
          onBlur={(event) => {
            if (!event.relatedTarget || !rootRef.current?.querySelector(".database-multi-menu")?.contains(event.relatedTarget)) setMultiMenu(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setMultiMenu(null); }
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (matches.length) setMultiHighlighted((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (matches.length) chooseSelectOption(row, column, matches[Math.min(multiHighlighted, matches.length - 1)], false);
              else {
                const option = multiQuery.trim();
                if (option && !column.options.some((item) => item.toLocaleLowerCase() === option.toLocaleLowerCase()))
                  chooseSelectOption(row, column, option, true);
              }
            }
          }}
        />
      </div>;
    }
    if (column.type === "itemName" || column.type === "text") return <button type="button"
      className="database-text-cell"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={textEditor?.rowId === row.id && textEditor.columnId === column.id}
      onClick={(event) => openTextEditor(row.id, column.id, event.currentTarget)}>
      {typeof value === "string" && value ? value : column.type === "itemName" ? "New item" : "\u00a0"}
    </button>;
    if (column.type === "url") {
      const urlValue = typeof value === "string" ? value : "";
      const isEditing = editingUrl?.rowId === row.id && editingUrl.columnId === column.id;
      if (urlValue && !isEditing) {
        const href = externalUrl(urlValue);
        return <div className="database-url-cell">
          {href ? <a href={href} target="_blank" rel="noopener noreferrer"
            aria-label={`Open ${urlValue} in a new tab`} title={urlValue}>{urlValue}</a>
            : <span title={urlValue}>{urlValue}</span>}
          <button type="button" aria-label={`Edit ${label}`} title="Edit URL"
            onClick={() => setEditingUrl({ rowId: row.id, columnId: column.id })}><Pencil size={13} aria-hidden="true" /></button>
        </div>;
      }
      return <input aria-label={label} type="url" autoFocus={isEditing}
        value={urlValue}
        onFocus={() => setEditingUrl({ rowId: row.id, columnId: column.id })}
        onChange={(event) => changeCell(row.id, column.id, event.target.value)}
        onBlur={() => setEditingUrl(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            setEditingUrl(null);
            event.currentTarget.blur();
          }
        }} />;
    }
    return <input aria-label={label} type={column.type === "date" ? "date" : "number"}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => changeCell(row.id, column.id, event.target.value)} />;
  }

  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const context = canvas?.getContext("2d");
  if (context) context.font = "13px Inter, sans-serif";
  const measure = (value: string) => context?.measureText(value).width ?? value.length * 7;
  const columnWidths = columns.map((column) => resizeWidths?.[column.id]
    ?? (column.width === undefined ? contentColumnWidth(column, rows, measure) : resizedColumnWidth(column.width, 0)));
  const tableWidth = `${columnWidths.reduce((sum, width) => sum + width, 36)}px`;
  const visibleRows = visibleDatabaseRows(rows, columns, search, filter);
  const groups = databaseRowGroups(visibleRows, columns.find((column) => column.id === groupBy));

  return <NodeViewWrapper className="inline-database" contentEditable={false}>
    <div className="database-shell" ref={rootRef}>
    <div className="database-heading">
      <input className="database-title" aria-label="Database name" value={title}
        onChange={(event) => updateAttributes({ title: event.target.value })} />
      <button type="button" className="database-delete" aria-label={`Delete database ${title}`}
        onClick={() => { if (window.confirm(`Delete “${title}”?`)) deleteNode(); }}>Delete database</button>
    </div>
    <div className="database-toolbar">
      <label className="database-search"><Search size={14} aria-hidden="true" /><input aria-label="Search database" placeholder="Search rows" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button type="button" className={filter ? "is-active" : ""} aria-expanded={showFilter} onClick={() => setShowFilter((value) => !value)}>Filter{filter ? " •" : ""}</button>
      <label>Group by <select aria-label="Group database by" value={groupBy} onChange={(event) => updateAttributes({ groupBy: event.target.value })}>
        <option value="">None</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.name || "Untitled"}</option>)}
      </select></label>
      <button type="button" aria-pressed={wrap} onClick={() => updateAttributes({ wrap: !wrap })}>{wrap ? "Wrap: on" : "Wrap: off"}</button>
    </div>
    {showFilter && <div className="database-filter" role="group" aria-label="Database filter">
      <select aria-label="Filter column" value={filter?.columnId ?? ""} onChange={(event) => updateAttributes({ filter: event.target.value ? { columnId: event.target.value, operator: "contains", value: "" } : null })}>
        <option value="">Choose column</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.name || "Untitled"}</option>)}
      </select>
      {filter && <><select aria-label="Filter condition" value={filter.operator} onChange={(event) => updateAttributes({ filter: { ...filter, operator: event.target.value as DatabaseFilter["operator"] } })}>
        <option value="contains">Contains</option><option value="equals">Is</option><option value="empty">Is empty</option><option value="notEmpty">Is not empty</option>
      </select>{(filter.operator === "contains" || filter.operator === "equals") && <input aria-label="Filter value" placeholder="Value" value={filter.value} onChange={(event) => updateAttributes({ filter: { ...filter, value: event.target.value } })} />}
      <button type="button" onClick={() => updateAttributes({ filter: null })}>Clear filter</button></>}
    </div>}
    <div className="database-scroll">
      <table className={`database-table ${wrap ? "is-wrapped" : ""}`} style={{ width: tableWidth }}>
        <colgroup>
          {columns.map((column, index) => <col key={column.id} style={{ width: columnWidths[index] }} />)}
          <col style={{ width: 36 }} />
        </colgroup>
        <thead><tr>
          {columns.map((column, index) => <th key={column.id} data-column-id={column.id}>
            <div className="database-column-heading">
              <button type="button" aria-label={`Edit ${column.name} column`}
                data-database-menu-trigger
                aria-expanded={popover?.kind === "edit" && popover.columnId === column.id}
                onClick={(event) => openPopover(event, "edit", column.id)}>
                <span>{column.name || "Untitled"}</span><ChevronDown size={14} aria-hidden="true" />
              </button>
            </div>
            <span className="database-column-resize" role="separator" aria-label={`Resize ${column.name} column`}
              aria-orientation="vertical" aria-valuenow={columnWidths[index] ? Math.round(columnWidths[index]) : undefined}
              aria-valuemin={minColumnWidth} aria-valuemax={maxColumnWidth} tabIndex={0}
              onPointerDown={(event) => startColumnResize(event, column.id)}
              onDoubleClick={() => changeColumn(column.id, { width: undefined })}
              onPointerMove={moveColumnResize}
              onPointerUp={finishColumnResize}
              onPointerCancel={(event) => finishColumnResize(event, true)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const widths = measuredColumnWidths();
                changeColumn(column.id, { width: resizedColumnWidth(widths[column.id], event.key === "ArrowRight" ? 10 : -10) });
              }} />
          </th>)}
          <th className="database-add-column"><button type="button" aria-label="Add column"
            data-database-menu-trigger aria-expanded={popover?.kind === "new"}
            onClick={(event) => openPopover(event, "new")}>＋</button></th>
        </tr></thead>
        <tbody>
          {!visibleRows.length && <tr className="database-empty-row"><td colSpan={columns.length + 1}>{rows.length ? "No matching rows" : "No rows yet"}</td></tr>}
          {groups.flatMap((group) => [
            ...(groupBy ? [<tr className="database-group-row" key={`group-${group.label}`}><th colSpan={columns.length + 1}>{group.label} <span>{group.rows.length}</span></th></tr>] : []),
            ...group.rows.map((row) => <tr key={row.id}>
            {columns.map((column) => <td key={column.id}>{renderCell(row, column)}</td>)}
            <td className="database-row-actions"><button type="button" aria-label={`Delete row ${rows.indexOf(row) + 1}`}
              onClick={() => updateAttributes({ rows: rows.filter((item) => item.id !== row.id) })}>×</button></td>
          </tr>)])}
        </tbody>
      </table>
      <button type="button" className="database-add-row" onClick={() => updateAttributes({ rows: [...rows, { id: crypto.randomUUID(), cells: {} }] })}>＋ New row</button>
    </div>
    {textEditor && (() => {
      const row = rows.find((item) => item.id === textEditor.rowId);
      const column = columns.find((item) => item.id === textEditor.columnId);
      if (!row || !column || (column.type !== "itemName" && column.type !== "text")) return null;
      return createPortal(<div className="database-text-editor" role="dialog"
        aria-label={`Edit ${column.name} for row ${rows.indexOf(row) + 1}`}
        style={{ top: textEditor.top, left: textEditor.left, width: textEditor.width }}>
        <textarea ref={textEditorRef} aria-label={`${column.name} for row ${rows.indexOf(row) + 1}`}
          value={typeof row.cells[column.id] === "string" ? row.cells[column.id] as string : ""}
          placeholder={column.type === "itemName" ? "New item" : ""}
          onChange={(event) => { sizeTextEditor(event.currentTarget); changeCell(row.id, column.id, event.target.value); }}
          onBlur={() => setTextEditor(null)}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setTextEditor(null); } }} />
      </div>, document.body);
    })()}
    {multiMenu && (() => {
      const row = rows.find((item) => item.id === multiMenu.rowId);
      const column = columns.find((item) => item.id === multiMenu.columnId);
      if (!row || !column || (column.type !== "multiSelect" && column.type !== "singleSelect")) return null;
      const cellValue = row.cells[column.id];
      const selected = column.type === "singleSelect"
        ? typeof cellValue === "string" && cellValue ? [cellValue] : []
        : Array.isArray(cellValue) ? cellValue : [];
      const matches = matchingMultiSelectOptions(column.options, selected, multiQuery);
      const newTag = multiQuery.trim();
      const canCreate = Boolean(newTag) && !column.options.some((option) => option.toLocaleLowerCase() === newTag.toLocaleLowerCase());
      return <div id={multiMenuId} className="database-multi-menu" role="listbox"
        aria-label={`${column.name} options`} style={{ top: multiMenu.top, left: multiMenu.left, width: multiMenu.width }}>
        {matches.map((option, index) => <button type="button" role="option" aria-selected={index === multiHighlighted}
          id={`${multiMenuId}-option-${index}`} key={option} className={index === multiHighlighted ? "is-highlighted" : ""}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => chooseSelectOption(row, column, option, false)}>{option}</button>)}
        {canCreate && <button type="button" className="database-multi-create" role="option" aria-selected={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => chooseSelectOption(row, column, newTag, true)}>Create “{newTag}”</button>}
        {!matches.length && !canCreate && <div className="database-multi-empty">No options available</div>}
      </div>;
    })()}
    {popover?.kind === "new" && <div className="database-popover" style={{ top: popover.top, left: popover.left }}>
      <label className="database-popover-label" htmlFor="new-database-column">New property</label>
      <input id="new-database-column" className="database-popover-name" aria-label="New column name"
        autoFocus value={newColumnName} placeholder="Property name" onChange={(event) => setNewColumnName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") addColumn("text"); }} />
      <div className="database-popover-caption">Property type</div>
      <div className="database-type-list">
        {columnTypes.map((type) => <button type="button" key={type.value}
          onClick={() => addColumn(type.value)}>{type.label}</button>)}
      </div>
    </div>}
    {popover?.kind === "edit" && (() => {
      const column = columns.find((item) => item.id === popover.columnId);
      if (!column) return null;
      return <div className="database-popover" style={{ top: popover.top, left: popover.left }}>
        <label className="database-popover-label">Column name
          <input className="database-popover-name" aria-label="Column name" value={column.name}
            onChange={(event) => changeColumn(column.id, { name: event.target.value })} />
        </label>
        <label className="database-popover-label">Type
          <span className="database-popover-select">
          <select aria-label="Column type" value={column.type} onChange={(event) => {
            const type = event.target.value as ColumnType;
            updateAttributes({
              columns: columns.map((item) => item.id === column.id ? { ...item, type } : item),
              rows: rows.map((row) => ({ ...row, cells: { ...row.cells,
                [column.id]: type === "multiSelect" ? [] : "" } })),
            });
          }}>
            {columnTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        {(column.type === "singleSelect" || column.type === "multiSelect") && <div className="database-options">
          <div className="database-popover-label">Options</div>
          {column.options.length > 0 && <div className="database-option-tags">
            {column.options.map((option) => <button key={option} type="button" className="database-tag"
              aria-label={`Remove ${option} option`} onClick={() => removeOption(column, option)}>{option} ×</button>)}
          </div>}
          <div className="database-option-entry">
            <input aria-label="New option" placeholder="Add an option" value={newOption}
              onChange={(event) => setNewOption(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOption(column); } }} />
            <button type="button" aria-label="Add option" disabled={!newOption.trim() || column.options.includes(newOption.trim())}
              onClick={() => addOption(column)}>Add</button>
          </div>
        </div>}
        {columns.length > 1 && <button type="button" className="database-remove-column"
          onClick={() => {
            updateAttributes({ columns: columns.filter((item) => item.id !== column.id) });
            setPopover(null);
          }}>Delete column</button>}
      </div>;
    })()}
    </div>
  </NodeViewWrapper>;
}

export const InlineDatabase = Node.create({
  name: "inlineDatabase",
  group: "block",
  atom: true,
  draggable: false,
  addAttributes() {
    return {
      title: { default: "Untitled database" },
      columns: { default: [], parseHTML: (element) => parseArray(element.getAttribute("data-columns")), renderHTML: (attrs) => ({ "data-columns": JSON.stringify(attrs.columns) }) },
      rows: { default: [], parseHTML: (element) => parseArray(element.getAttribute("data-rows")), renderHTML: (attrs) => ({ "data-rows": JSON.stringify(attrs.rows) }) },
      filter: { default: null, parseHTML: (element) => { try { return JSON.parse(element.getAttribute("data-filter") || "null"); } catch { return null; } }, renderHTML: (attrs) => ({ "data-filter": JSON.stringify(attrs.filter) }) },
      groupBy: { default: "", parseHTML: (element) => element.getAttribute("data-group-by") ?? "", renderHTML: (attrs) => ({ "data-group-by": attrs.groupBy }) },
      wrap: { default: false, parseHTML: (element) => element.getAttribute("data-wrap") === "true", renderHTML: (attrs) => ({ "data-wrap": String(attrs.wrap) }) },
    };
  },
  parseHTML() { return [{ tag: "div[data-inline-database]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-inline-database": "", "data-title": HTMLAttributes.title })];
  },
  addNodeView() { return ReactNodeViewRenderer(DatabaseView); },
});
