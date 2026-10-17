export function resolveCommentAnchor(
  plainText: string,
  exactQuote: string,
  occurrence?: number,
  prefix = "",
  suffix = "",
) {
  const positions: number[] = [];
  for (let position = plainText.indexOf(exactQuote); position >= 0;
    position = plainText.indexOf(exactQuote, position + exactQuote.length)) positions.push(position);
  if (!positions.length) throw new Error("The exact quote is not present in this document.");

  const matching = positions.map((position, index) => ({ position, occurrence: index + 1 }))
    .filter(({ position }) => plainText.slice(0, position).endsWith(prefix)
      && plainText.slice(position + exactQuote.length).startsWith(suffix));
  const selected = occurrence === undefined
    ? matching.length === 1 ? matching[0] : null
    : matching.find((item) => item.occurrence === occurrence);
  if (!selected) throw new Error(occurrence === undefined
    ? "The quote is ambiguous. Provide its occurrence, prefix, or suffix."
    : "The requested quote occurrence does not match the document or context.");

  return {
    occurrence: selected.occurrence,
    prefix: prefix || plainText.slice(Math.max(0, selected.position - 80), selected.position),
    suffix: suffix || plainText.slice(selected.position + exactQuote.length, selected.position + exactQuote.length + 80),
  };
}
