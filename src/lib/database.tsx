import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ColumnType = "itemName" | "text" | "number" | "date" | "singleSelect" | "multiSelect" | "url";
export type DatabaseColumn = { id: string; name: string; type: ColumnType; options: string[] };
export type DatabaseRow = { id: string; cells: Record<string, string | string[]> };

export const columnTypes: { value: ColumnType; label: string }[] = [
  { value: "itemName", label: "Item Name" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "singleSelect", label: "Single Select" },
  { value: "multiSelect", label: "Multi-Select" },
  { value: "url", label: "URL" },
];

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<null | { kind: "new" | "edit"; columnId?: string; top: number; left: number }>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [newOption, setNewOption] = useState("");

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

  function renderCell(row: DatabaseRow, column: DatabaseColumn) {
    const value = row.cells[column.id];
    const label = `${column.name} for row ${rows.indexOf(row) + 1}`;
    if (column.type === "singleSelect") return (
      <span className="database-cell-select">
        {typeof value === "string" && value
          ? <span className="database-tag">{value}</span>
          : <span className="database-select-placeholder">Select…</span>}
        <select aria-label={label} value={typeof value === "string" ? value : ""}
          onChange={(event) => changeCell(row.id, column.id, event.target.value)}>
          <option value="">Select…</option>
          {column.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    );
    if (column.type === "multiSelect") {
      const selected = Array.isArray(value) ? value : [];
      return <div className="database-multi-cell">
        {selected.map((option) => <button key={option} type="button" className="database-tag"
          aria-label={`Remove ${option} from ${label}`}
          onClick={() => changeCell(row.id, column.id, selected.filter((item) => item !== option))}>{option} ×</button>)}
        <span className="database-cell-select database-cell-select-compact">
          <select aria-label={`Add ${label}`} value="" onChange={(event) => {
            if (event.target.value && !selected.includes(event.target.value))
              changeCell(row.id, column.id, [...selected, event.target.value]);
          }}>
            <option value="">Add…</option>
            {column.options.filter((option) => !selected.includes(option)).map((option) =>
              <option key={option} value={option}>{option}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </div>;
    }
    return <input aria-label={label} type={column.type === "date" ? "date" : column.type === "number" ? "number" : column.type === "url" ? "url" : "text"}
      value={typeof value === "string" ? value : ""}
      placeholder={column.type === "itemName" ? "New item" : ""}
      onChange={(event) => changeCell(row.id, column.id, event.target.value)} />;
  }

  return <NodeViewWrapper className="inline-database" contentEditable={false}>
    <div className="database-shell" ref={rootRef}>
    <div className="database-heading">
      <input className="database-title" aria-label="Database name" value={title}
        onChange={(event) => updateAttributes({ title: event.target.value })} />
      <button type="button" className="database-delete" aria-label={`Delete database ${title}`}
        onClick={() => { if (window.confirm(`Delete “${title}”?`)) deleteNode(); }}>Delete database</button>
    </div>
    <div className="database-scroll">
      <table className="database-table">
        <thead><tr>
          {columns.map((column) => <th key={column.id}>
            <div className="database-column-heading">
              <button type="button" aria-label={`Edit ${column.name} column`}
                data-database-menu-trigger
                aria-expanded={popover?.kind === "edit" && popover.columnId === column.id}
                onClick={(event) => openPopover(event, "edit", column.id)}>
                <span>{column.name || "Untitled"}</span><ChevronDown size={14} aria-hidden="true" />
              </button>
            </div>
          </th>)}
          <th className="database-add-column"><button type="button" aria-label="Add column"
            data-database-menu-trigger aria-expanded={popover?.kind === "new"}
            onClick={(event) => openPopover(event, "new")}>＋</button></th>
        </tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.id}>
            {columns.map((column) => <td key={column.id}>{renderCell(row, column)}</td>)}
            <td className="database-row-actions"><button type="button" aria-label={`Delete row ${rows.indexOf(row) + 1}`}
              onClick={() => updateAttributes({ rows: rows.filter((item) => item.id !== row.id) })}>×</button></td>
          </tr>)}
        </tbody>
      </table>
      <button type="button" className="database-add-row" onClick={() => updateAttributes({ rows: [...rows, { id: crypto.randomUUID(), cells: {} }] })}>＋ New row</button>
    </div>
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
  draggable: true,
  addAttributes() {
    return {
      title: { default: "Untitled database" },
      columns: { default: [], parseHTML: (element) => parseArray(element.getAttribute("data-columns")), renderHTML: (attrs) => ({ "data-columns": JSON.stringify(attrs.columns) }) },
      rows: { default: [], parseHTML: (element) => parseArray(element.getAttribute("data-rows")), renderHTML: (attrs) => ({ "data-rows": JSON.stringify(attrs.rows) }) },
    };
  },
  parseHTML() { return [{ tag: "div[data-inline-database]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-inline-database": "", "data-title": HTMLAttributes.title })];
  },
  addNodeView() { return ReactNodeViewRenderer(DatabaseView); },
});
