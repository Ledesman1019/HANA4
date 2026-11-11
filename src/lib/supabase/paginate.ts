/**
 * La API de Supabase devuelve como máximo 1000 filas por consulta.
 * `fetchAll` pide el listado por tramos hasta traerlo completo (o llegar a `max`).
 *
 *   const products = await fetchAll((from, to) => supabase.from("products").select("*").order("name").range(from, to));
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  { max = 20_000, size = 1000 }: { max?: number; size?: number } = {},
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, Math.min(from + size, max) - 1);
    if (error) break;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}
