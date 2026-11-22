/** D1 allows at most 100 bound parameters per statement: run IN-list queries in chunks. */
export const IN_CHUNK = 90;

export async function chunked<T>(ids: readonly string[], run: (chunk: string[], placeholders: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    out.push(...(await run(chunk, chunk.map(() => '?').join(','))));
  }
  return out;
}
