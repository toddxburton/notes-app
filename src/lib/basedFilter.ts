import type { BasedField } from "./basedTypes";

export type BasedFilter = { fieldId: string; mode: "contains" | "equals" | "empty" | "notEmpty"; value: string };

export function basedFilterChoices(field: BasedField): Array<{ label: string; value: string }> | null {
  if (field.type === "checkbox") return [
    { label: "Checked", value: "true" },
    { label: "Unchecked", value: "false" },
  ];
  if (field.type === "singleSelect" || field.type === "multiSelect")
    return field.options.map((option) => ({ label: option, value: option }));
  return null;
}

export function activeBasedFilter(field: BasedField | undefined, filter: BasedFilter | null): BasedFilter | null {
  if (!field || !filter || field.id !== filter.fieldId) return null;
  if (basedFilterChoices(field) && filter.mode === "equals" && !filter.value) return null;
  return filter;
}
