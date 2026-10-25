import { describe, it, expect } from "vitest";
import {
  billTotal,
  sumMoney,
  validateItems,
  reportRows,
  sizes,
  normalizeSize,
  validSize,
  received,
  remaining,
  paymentStatus,
  type Bill,
} from "./domain";
describe("Sales calculations", () => {
  it("sums monetary report values in whole halala", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([100.01, 200.02, 0.03])).toBe(300.06);
  });
  it("uses halala precision for fractional bundle prices", () => {
    expect(
      billTotal([
        { size: "17x32", quantity: 3, rate: 0.1 },
        { size: "19x39", quantity: 2, rate: 10.25 },
      ]),
    ).toBe(20.8);
  });
  it("rejects fractional bundles, missing sizes, invalid prices and excess decimals", () => {
    for (const item of [
      { size: "17x32", quantity: 1.5, rate: 10 },
      { size: "", quantity: 1, rate: 10 },
      { size: "17x32", quantity: 1, rate: -1 },
      { size: "17x32", quantity: 1, rate: 1.001 },
    ])
      expect(validateItems([item])).toBe(false);
    expect(validateItems([])).toBe(false);
  });
  it("accepts all sixteen products", () => {
    expect(sizes).toHaveLength(16);
    for (const size of sizes)
      expect(validateItems([{ size, quantity: 1, rate: 1.25 }])).toBe(true);
  });
  it("validates new catalog sizes and normalizes input", () => {
    expect(normalizeSize(" 40 × 80 ")).toBe("40x80");
    expect(validSize("40x80")).toBe(true);
    expect(validSize("0x80")).toBe(false);
    expect(validSize("40x80000")).toBe(false);
    expect(
      validateItems([{ size: "40x80", quantity: 2, rate: 25 }], ["40x80"]),
    ).toBe(true);
    expect(
      validateItems([{ size: "40x80", quantity: 2, rate: 25 }], ["17x32"]),
    ).toBe(false);
  });
  it("calculates partial balances at halala precision and retains legacy paid states", () => {
    const b: Bill = {
      id: "p",
      bill_number: 10,
      sale_date: "2026-10-25",
      customer_id: "c",
      customer_name: "Farm",
      paid: false,
      items: [{ size: "17x32", quantity: 1, rate: 100 }],
      total: 100,
      amount_received: 40,
    };
    expect(received(b)).toBe(40);
    expect(remaining(b)).toBe(60);
    expect(paymentStatus(b)).toBe("Partially paid");
    expect(paymentStatus({ ...b, amount_received: 100 })).toBe("Paid");
    expect(paymentStatus({ ...b, amount_received: 0 })).toBe("Unpaid");
    expect(remaining({ ...b, total: 0.3, amount_received: 0.1 })).toBe(0.2);
    expect(received({ ...b, paid: true, amount_received: undefined })).toBe(
      100,
    );
    const rows = reportRows([b]);
    expect(rows[1][9]).toBe(40);
    expect(rows[1][10]).toBe(60);
    expect(rows[2][9]).toBe(40);
    expect(rows[2][10]).toBe(60);
  });
  it("counts a multi-item bill exactly once in Excel totals", () => {
    const bill: Bill = {
      id: "1",
      bill_number: 1001,
      sale_date: "2026-10-13",
      customer_id: "1",
      customer_name: "Farm",
      paid: false,
      items: [
        { size: "17x32", quantity: 2, rate: 10 },
        { size: "19x39", quantity: 3, rate: 20 },
      ],
      total: 80,
    };
    const rows = reportRows([bill]);
    expect(rows[1][8]).toBe(80);
    expect(rows[2][8]).toBe("");
    expect(rows[3][8]).toBe(80);
    expect(rows[3][5]).toBe(5);
    expect(rows[1][3]).toBe("Unpaid");
  });
});
