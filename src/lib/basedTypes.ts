export type BasedFieldType = "itemName" | "text" | "number" | "date" | "singleSelect" | "multiSelect" | "url" | "checkbox" | "linkedRecord";
export type BasedCell = string | string[] | boolean;

export interface BasedFolder {
  id: string; owner_id: string; name: string; sort_order: number; collapsed: boolean; archived_at: string | null; created_at: string;
}
export interface BasedDatabase {
  id: string; owner_id: string; folder_id: string | null; name: string; sort_order: number; archived_at: string | null; created_at: string;
}
export interface BasedTable {
  id: string; owner_id: string; database_id: string; name: string; sort_order: number; archived_at: string | null; created_at: string;
}
export interface BasedRelation {
  id: string; owner_id: string; database_id: string; left_table_id: string; right_table_id: string;
}
export interface BasedField {
  id: string; owner_id: string; table_id: string; name: string; type: BasedFieldType; options: string[];
  relation_id: string | null; relation_side: "left" | "right" | null;
  width: number | null; hidden: boolean; archived_at: string | null; sort_order: number;
}
export interface BasedRecord {
  id: string; owner_id: string; table_id: string; cells: Record<string, BasedCell>;
  sort_order: number; archived_at: string | null; created_at: string; updated_at: string;
}
export interface BasedLink {
  relation_id: string; owner_id: string; left_record_id: string; right_record_id: string;
}
export interface BasedCatalog {
  folders: BasedFolder[]; databases: BasedDatabase[]; tables: BasedTable[]; fields: BasedField[]; relations: BasedRelation[];
}
export interface BasedBackup extends BasedCatalog {
  format: "based-workspace"; version: 1; exported_at: string; records: BasedRecord[]; links: BasedLink[];
}

export const basedFieldTypes: Array<{ value: BasedFieldType; label: string }> = [
  { value: "itemName", label: "Item name" }, { value: "text", label: "Text" },
  { value: "number", label: "Number" }, { value: "date", label: "Date" },
  { value: "singleSelect", label: "Single select" }, { value: "multiSelect", label: "Multiple select" },
  { value: "url", label: "URL" }, { value: "checkbox", label: "Checkbox" },
  { value: "linkedRecord", label: "Linked records" },
];
