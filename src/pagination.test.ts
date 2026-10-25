import { it, expect } from "vitest";
import { fetchAll } from "./pagination";
it("includes all rows beyond the server limit", async () => {
  const rows = Array.from({ length: 1234 }, (_, id) => ({ id }));
  const result = await fetchAll(async (from, to) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }));
  expect(result.data).toHaveLength(1234);
  expect(result.data[1233].id).toBe(1233);
});
it("does not return an incomplete report when a later page fails", async () => {
  await expect(
    fetchAll(async (from) =>
      from === 0
        ? { data: Array(500).fill(1), error: null }
        : { data: null, error: { message: "Connection failed" } },
    ),
  ).rejects.toMatchObject({ message: "Connection failed" });
});
