// Supabase caps a response at 1,000 rows by default. Fetch complete reports in pages.
export async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: null }> {
  const result: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await page(from, from + 499);
    if (error) throw error;
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < 500) return { data: result, error: null };
  }
}
