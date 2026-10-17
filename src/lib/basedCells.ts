import type { BasedCell, BasedField } from "./basedTypes";
import { normalizeBasedOptions, updatedBasedOptions } from "./basedOptions";

type CellField = Pick<BasedField, "id" | "table_id" | "name" | "type" | "options" | "archived_at">;

export function prepareBasedCells(fields: CellField[], tableId: string, values: Record<string, unknown>, createChoices = false) {
  const cells: Record<string, BasedCell> = {};
  const optionUpdates: Array<{ fieldId: string; options: string[] }> = [];
  for (const [fieldId, value] of Object.entries(values)) {
    const field = fields.find((item) => item.id === fieldId && item.table_id === tableId && !item.archived_at);
    if (!field || field.type === "linkedRecord") throw new Error(`Invalid field: ${fieldId}`);
    if (field.type === "checkbox") {
      if (typeof value !== "boolean") throw new Error(`Expected boolean for ${field.name}.`);
      cells[fieldId] = value;
      continue;
    }
    if (field.type === "multiSelect") {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
        throw new Error(`Invalid options for ${field.name}.`);
      const selected = normalizeBasedOptions(value);
      if (!createChoices && selected.some((item) => !field.options.includes(item)))
        throw new Error(`Invalid options for ${field.name}.`);
      cells[fieldId] = selected;
      if (createChoices) {
        const options = updatedBasedOptions(field.options, selected, "append");
        if (options.length !== field.options.length) optionUpdates.push({ fieldId, options });
      }
      continue;
    }
    if (typeof value !== "string") throw new Error(`Expected text for ${field.name}.`);
    if (field.type === "number" && value && !Number.isFinite(Number(value)))
      throw new Error(`Invalid number for ${field.name}.`);
    if (field.type === "singleSelect") {
      const selected = value.trim();
      if (selected && !createChoices && !field.options.includes(selected))
        throw new Error(`Invalid option for ${field.name}.`);
      cells[fieldId] = selected;
      if (createChoices && selected) {
        const options = updatedBasedOptions(field.options, [selected], "append");
        if (options.length !== field.options.length) optionUpdates.push({ fieldId, options });
      }
      continue;
    }
    cells[fieldId] = value;
  }
  return { cells, optionUpdates };
}
