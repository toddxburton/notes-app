export type BasedOptionsMode = "append" | "replace";

export function normalizeBasedOptions(options: string[]): string[] {
  if (options.length > 2000) throw new Error("A field can have at most 2,000 choices.");
  const normalized = options.map((option) => option.trim());
  if (normalized.some((option) => !option || option.length > 180))
    throw new Error("Each choice must be 1–180 characters after trimming.");
  return [...new Set(normalized)];
}

export function updatedBasedOptions(current: string[], incoming: string[], mode: BasedOptionsMode): string[] {
  return normalizeBasedOptions(mode === "append" ? [...current, ...incoming] : incoming);
}
