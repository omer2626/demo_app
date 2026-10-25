export const sizes = [
  "17x32",
  "19x39",
  "18x40",
  "19x44",
  "21x48",
  "23x50",
  "24x55",
  "27x58",
  "29x49",
  "30x65",
  "32x75",
  "32x72",
  "36x75",
  "38x75",
  "31x100",
  "44x75",
];
export type BagSize = {
  id: string;
  name: string;
  stock?: number;
  stock_initialized?: boolean;
  archived?: boolean;
};
export const normalizeSize = (value: string) =>
  value.toLowerCase().replace(/\s/g, "").replace(/×/g, "x");
export const validSize = (value: string) =>
  /^[1-9][0-9]{0,3}x[1-9][0-9]{0,3}$/.test(value);
export type Customer = { id: string; name: string; phone: string | null };
export type Item = {
  size: string;
  quantity: number;
  rate: number;
  bag_size_id?: string | null;
};
export type Bill = {
  id: string;
  bill_number: number;
  sale_date: string;
  customer_id: string;
  customer_name: string;
  paid: boolean;
  items: Item[];
  total: number;
  amount_received?: number;
  balance?: number;
  stock_tracked?: boolean;
};
export type Payment = {
  id: string;
  bill_id: string;
  amount: number;
  payment_date: string | null;
  note: string;
  is_opening: boolean;
  voided: boolean;
  bills?: { bill_number: number; customer_name: string; sale_date: string };
};
export type Movement = {
  id: string;
  size_name: string;
  delta: number;
  kind: string;
  movement_date: string;
  note: string;
};
export const received = (bill: Bill) =>
  Number(bill.amount_received ?? (bill.paid ? bill.total : 0));
export const remaining = (bill: Bill) =>
  Math.max(0, Math.round((bill.total - received(bill)) * 100) / 100);
export const paymentStatus = (bill: Bill) =>
  remaining(bill) === 0
    ? "Paid"
    : received(bill) > 0
      ? "Partially paid"
      : "Unpaid";
export const money = (n: number) =>
  new Intl.NumberFormat("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
export const sumMoney = (values: number[]) =>
  values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;
export const itemTotal = (item: Item) =>
  Math.round(item.quantity * Math.round(item.rate * 100)) / 100;
export const billTotal = (items: Item[]) => sumMoney(items.map(itemTotal));
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function validateItems(items: Item[], allowedSizes: string[] = sizes) {
  return (
    items.length > 0 &&
    items.every(
      (i) =>
        allowedSizes.includes(i.size) &&
        Number.isSafeInteger(i.quantity) &&
        i.quantity > 0 &&
        i.quantity <= 1000000 &&
        Number.isFinite(i.rate) &&
        i.rate > 0 &&
        i.rate <= 1000000 &&
        Math.abs(i.rate * 100 - Math.round(i.rate * 100)) < 0.00001,
    )
  );
}
export function reportRows(bills: Bill[]) {
  const rows: (string | number)[][] = [
    [
      "Bill number",
      "Date",
      "Customer",
      "Status",
      "Bag size",
      "Bundles",
      "Rate (SAR)",
      "Item total (SAR)",
      "Bill total (SAR)",
      "Received (SAR)",
      "Remaining (SAR)",
    ],
  ];
  for (const b of bills)
    b.items.forEach((i, index) =>
      rows.push([
        b.bill_number,
        b.sale_date,
        b.customer_name,
        paymentStatus(b),
        i.size,
        i.quantity,
        i.rate,
        itemTotal(i),
        index === 0 ? b.total : "",
        index === 0 ? received(b) : "",
        index === 0 ? remaining(b) : "",
      ]),
    );
  rows.push([
    "TOTAL",
    "",
    "",
    "",
    "",
    bills.reduce((s, b) => s + b.items.reduce((n, i) => n + i.quantity, 0), 0),
    "",
    "",
    sumMoney(bills.map((b) => b.total)),
    sumMoney(bills.map(received)),
    sumMoney(bills.map(remaining)),
  ]);
  return rows;
}
