export function uniqueRowsByCode<T extends { code: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.code, row])).values()];
}
