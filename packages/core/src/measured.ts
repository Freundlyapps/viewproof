/** Inputs a score was computed from; shown to the user as the "why". */
export type Inputs = Record<string, number | string | boolean>;

/**
 * A measured value or an explicit absence with a reason.
 * Never substitute a default: a missing input is `no_data`.
 */
export type Measured<T> =
  | { kind: 'value'; value: T; formula: string; inputs: Inputs }
  | { kind: 'no_data'; reason: string };

export function value<T>(v: T, formula: string, inputs: Inputs): Measured<T> {
  return { kind: 'value', value: v, formula, inputs };
}

export function noData(reason: string): Measured<never> {
  return { kind: 'no_data', reason };
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
