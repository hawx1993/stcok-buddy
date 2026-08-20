const leadingEmoji =
  /^\s*(?:(?:\p{Extended_Pictographic}️?[\u{1F3FB}-\u{1F3FF}]?|\p{Regional_Indicator}{1,2})(?:‍\p{Extended_Pictographic}️?[\u{1F3FB}-\u{1F3FF}]?)*\s*)+/u;

export function normalizeProgressLabel(label: string): string {
  const normalized = label.replace(leadingEmoji, '');
  return normalized.trimStart() || label;
}
