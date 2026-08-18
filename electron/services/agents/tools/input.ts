/** Internal input normalization helpers shared by AgentTool modules. */
export function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

export function text(input: Record<string, unknown>, key: string, fallback = ''): string {
  return String(input[key] ?? fallback);
}

export function optionalText(input: Record<string, unknown>, key: string): string | undefined {
  const value = text(input, key).trim();
  return value || undefined;
}

export function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function optionalNum(input: Record<string, unknown>, key: string): number | undefined {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : undefined;
}

export function bool(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = input[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function limit(input: Record<string, unknown>, fallback = 50, max = 1000): number {
  return Math.max(1, Math.min(max, Math.floor(num(input, 'limit', fallback))));
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function safePositiveInt(value: number, fallback: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(Number.isFinite(value) ? value : fallback)));
}

export function enumValue<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  const value = input[key];
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

export function stringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}
