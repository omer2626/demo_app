import { useEffect, useState, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  Plus,
  Users,
  Package,
  ArrowUpRight,
  Download,
  Search,
  Printer,
  X,
  LogOut,
  Check,
  Pencil,
  Trash2,
  ChevronRight,
  Moon,
  Sun,
} from "lucide-react";
import { fetchAll } from "./pagination";
import { StockPanel, StockDialog, PaymentDialog } from "./Operations";
import { db, configured } from "./database";
import {
  sizes,
  today,
  money,
  sumMoney,
  billTotal,
  validateItems,
  reportRows,
  normalizeSize,
  validSize,
  received,
  remaining,
  paymentStatus,
  type Payment,
  type Movement,
  type BagSize,
  type Customer,
  type Bill,
  type Item,
} from "./domain";
const samples: Customer[] = [
  { id: "1", name: "Al Noor Farms", phone: "050 123 4567" },
  { id: "2", name: "Green Valley Agriculture", phone: "055 987 6543" },
  { id: "3", name: "Al Rashid Trading", phone: null },
];
const sampleBills: Bill[] = [
  {
    id: "1",
    bill_number: 1003,
    sale_date: today(),
    customer_id: "1",
    customer_name: samples[0].name,
    paid: true,
    items: [
      { size: "19x39", quantity: 12, rate: 85 },
      { size: "23x50", quantity: 8, rate: 110 },
    ],
    total: 1900,
  },
  {
    id: "2",
    bill_number: 1002,
    sale_date: today(),
    customer_id: "2",
    customer_name: samples[1].name,
    paid: false,
    items: [{ size: "32x75", quantity: 15, rate: 145 }],
    total: 2175,
  },
  {
    id: "3",
    bill_number: 1001,
    sale_date: today(),
    customer_id: "3",
    customer_name: samples[2].name,
    paid: true,
    items: [{ size: "17x32", quantity: 20, rate: 70 }],
    total: 1400,
  },
];
function BrandMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="28"
      height="28"
      fill="none"
      aria-hidden="true"
    >
      <path d="M16 3 29 16 16 29 3 16Z" stroke="currentColor" strokeWidth="2" />
      <path
        d="m8 16 8 8 8-8M8 12l8 8 8-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }, [theme]);
  const [catalog, setCatalog] = useState<BagSize[]>(
      sizes.map((name, index) => ({ id: String(index), name })),
    ),
    [catalogReady, setCatalogReady] = useState(!configured),
    [catalogError, setCatalogError] = useState("");
  const [sizeEditing, setSizeEditing] = useState<BagSize | null>(null),
    [sizeName, setSizeName] = useState("");
  const availableSizes = catalog.map((p) => p.name);

  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(!configured);
  const [tab, setTab] = useState("sales"),
    [date, setDate] = useState(today()),
    [customers, setCustomers] = useState<Customer[]>(configured ? [] : samples),
    [bills, setBills] = useState<Bill[]>(configured ? [] : sampleBills);
  const [noticeState, setNoticeState] = useState({ text: "", version: 0 });
  const notice = noticeState.text;
  const setNotice = (text: string) =>
    setNoticeState((previous) => ({ text, version: previous.version + 1 }));
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [modal, setModal] = useState<"sale" | "customer" | "size" | null>(null),
    [editing, setEditing] = useState<Bill | null>(null),
    [customer, setCustomer] = useState(""),
    [saleDate, setSaleDate] = useState(today()),
    [paymentMode, setPaymentMode] = useState("full"),
    [initialPayment, setInitialPayment] = useState(""),
    [saleRequestId, setSaleRequestId] = useState(() => crypto.randomUUID()),
    [items, setItems] = useState<Item[]>([{ size: "", quantity: 1, rate: 0 }]);
  const [stockTarget, setStockTarget] = useState<BagSize | null>(null),
    [paymentTarget, setPaymentTarget] = useState<Bill | null>(null),
    [movements, setMovements] = useState<Movement[]>([]),
    [collections, setCollections] = useState<Payment[]>([]),
    [outstanding, setOutstanding] = useState<Bill[]>([]),
    [operationsReady, setOperationsReady] = useState(!configured);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [noticeState.version]);
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [printBill, setPrintBill] = useState<Bill | null>(null);
  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message);
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = db.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const loadRequest = useRef(0);
  const normalizeBill = (b: Bill & { sale_items: Item[] }) => ({
    ...b,
    items: b.sale_items,
    total: Number(b.total),
    amount_received: Number(b.amount_received ?? (b.paid ? b.total : 0)),
  });
  async function load() {
    if (!db || !session) return;
    const request = ++loadRequest.current;
    setLoading(true);
    setError("");
    try {
      const [c, b, o, p, m] = await Promise.all([
        fetchAll((from, to) =>
          db!
            .from("customers")
            .select("id,name,phone")
            .eq("is_archived", false)
            .order("name")
            .order("id")
            .range(from, to),
        ),
        fetchAll((from, to) =>
          db!
            .from("bills")
            .select("*,sale_items(size,quantity,rate,position,bag_size_id)")
            .eq("is_deleted", false)
            .eq("sale_date", date)
            .order("bill_number", { ascending: false })
            .range(from, to),
        ),
        fetchAll((from, to) =>
          db!
            .from("bills")
            .select("*,sale_items(size,quantity,rate,position,bag_size_id)")
            .eq("is_deleted", false)
            .gt("balance", 0)
            .order("sale_date")
            .order("id")
            .range(from, to),
        ),
        fetchAll((from, to) =>
          db!
            .from("payments")
            .select("*,bills(bill_number,customer_name,sale_date)")
            .eq("payment_date", date)
            .eq("voided", false)
            .eq("is_opening", false)
            .order("created_at")
            .order("id")
            .range(from, to),
        ),
        db
          .from("stock_movements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (request !== loadRequest.current) return;
      for (const result of [c, b, o, p, m])
        if (result.error) throw result.error;
      setCustomers(c.data!);
      const mapBill = (row: Record<string, unknown>) =>
        normalizeBill({
          ...row,
          sale_items: (row.sale_items as (Item & { position: number })[]).sort(
            (a, b) => a.position - b.position,
          ),
        } as unknown as Bill & { sale_items: Item[] });
      setBills(b.data!.map(mapBill));
      setOutstanding(o.data!.map(mapBill));
      setCollections(
        p.data!.map((row) => ({ ...row, amount: Number(row.amount) })),
      );
      setMovements(m.data!);
      setOperationsReady(true);
    } catch (e) {
      if (request !== loadRequest.current) return;
      setOperationsReady(false);
      setError(
        `Unable to load stock and payments. If you have not applied the update, run the latest database updates through 006 in Supabase first. ${(e as Error).message}`,
      );
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }
  function operationSaved(message: string) {
    setNotice(message);
    void load();
    void loadCatalog();
  }
  async function loadCatalog() {
    if (!db || !session) return;
    setCatalogReady(false);
    setCatalogError("");
    try {
      const { error: initError } = await db.rpc("initialize_bag_sizes");
      if (initError) throw initError;
      const { data, error } = await fetchAll((from, to) =>
        db!
          .from("bag_sizes")
          .select("id,name,stock,stock_initialized,archived")
          .eq("archived", false)
          .order("created_at")
          .order("id")
          .range(from, to),
      );
      if (error) throw error;
      setCatalog(data);
      setCatalogReady(true);
    } catch {
      setCatalogError(
        "Bag size management needs a database update. Run 004_stock_and_payments.sql (after updates 002 and 003) in Supabase SQL Editor, then click Retry. Your existing sales are safe.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, [session, date]);
  useEffect(() => {
    void loadCatalog();
  }, [session]);
  function openSize(size?: BagSize) {
    setError("");
    setSizeEditing(size ?? null);
    setSizeName(size?.name ?? "");
    setModal("size");
  }
  async function clearStock(product: BagSize) {
    if (!db || busy) return;
    if (
      !window.confirm(
        `Delete all ${product.stock} bundles of stock for ${product.name}? Available stock will become zero. The bag size and existing bills will remain.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { error } = await db.rpc("clear_stock", {
        p_size_id: product.id,
        p_request_id: crypto.randomUUID(),
      });
      if (error) throw error;
      operationSaved("Stock deleted. Available bundles are now zero.");
    } catch (e) {
      setError(
        `Could not delete stock. If this is your first time using this button, run database update 005. ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteSize(product: BagSize) {
    if (!db || !session || busy) return;
    if (
      !window.confirm(
        `Delete bag size ${product.name}? It will no longer appear in new sales. Existing bills will keep this size.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { error } = await db.rpc("archive_bag_size", { p_id: product.id });
      if (error) throw error;
      setCatalog((c) => c.filter((p) => p.id !== product.id));
      setNotice("Bag size deleted. Existing bills are unchanged.");
    } catch (e) {
      const failure = e as { code?: string; message: string };
      setError(
        failure.code === "42501"
          ? "Deleting sizes needs a database update. Run 004_stock_and_payments.sql in Supabase SQL Editor, then try again."
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveSize() {
    const value = normalizeSize(sizeName);
    if (!validSize(value)) {
      setError(
        "Enter dimensions such as 17x32. Use whole numbers from 1 to 9999.",
      );
      return;
    }
    if (catalog.some((p) => p.name === value && p.id !== sizeEditing?.id)) {
      setError("This bag size already exists.");
      return;
    }
    if (!db || !session) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await db
        .rpc("save_bag_size", { p_id: sizeEditing?.id ?? null, p_name: value })
        .select("id,name,stock,stock_initialized")
        .single();
      if (error) throw error;
      setCatalog((c) =>
        sizeEditing
          ? c.map((p) => (p.id === data.id ? data : p))
          : [...c, data],
      );
      setModal(null);
      setNotice(
        sizeEditing
          ? "Bag size updated. Existing bills keep their original size."
          : "Bag size added. It is ready to use in new sales.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const reset = () => setPrintBill(null);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);
  const dayBills = bills.filter((b) => b.sale_date === date),
    total = sumMoney(dayBills.map((b) => b.total)),
    bundles = dayBills.reduce(
      (s, b) => s + b.items.reduce((n, i) => n + i.quantity, 0),
      0,
    );
  const visible = (tab === "balances" ? outstanding : dayBills).filter(
    (b) =>
      b.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      String(b.bill_number).includes(search),
  );
  function openSale(b?: Bill) {
    setError("");
    setEditing(b ?? null);
    setCustomer(b?.customer_id ?? "");
    setSaleDate(b?.sale_date ?? date);
    setPaymentMode("full");
    setInitialPayment("");
    setSaleRequestId(crypto.randomUUID());
    setItems(
      b ? b.items.map((i) => ({ ...i })) : [{ size: "", quantity: 1, rate: 0 }],
    );
    setModal("sale");
  }
  function changeItem(index: number, patch: Partial<Item>) {
    setItems((v) =>
      v.map((item, i) =>
        i === index
          ? {
              ...item,
              ...patch,
              ...(patch.size !== undefined
                ? {
                    bag_size_id:
                      catalog.find((p) => p.name === patch.size)?.id ?? null,
                  }
                : {}),
            }
          : item,
      ),
    );
  }
  async function saveSale() {
    if (
      !customer ||
      !validateItems(items, [
        ...availableSizes,
        ...(editing?.items.map((i) => i.size) ?? []),
      ])
    ) {
      setError(
        "Select a customer and size, then enter whole bundles and a positive price with at most two decimal places.",
      );
      return;
    }
    if (!db) {
      setError(
        "This is a sample preview. Connect Supabase to save real sales.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await db.rpc("save_bill_v2", {
        p_id: editing?.id ?? null,
        p_customer_id: customer,
        p_date: saleDate,
        p_items: items,
        p_initial_payment: editing
          ? 0
          : paymentMode === "full"
            ? billTotal(items)
            : paymentMode === "partial"
              ? Number(initialPayment)
              : 0,
        p_request_id: saleRequestId,
      });
      if (error) throw error;
      setModal(null);
      setNotice(
        editing ? "Bill updated in database." : "Bill saved in database.",
      );
      if (date !== saleDate) setDate(saleDate);
      else await load();
      await loadCatalog();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addCustomer() {
    if (!name.trim()) return;
    if (!db) {
      setError("Connect Supabase to save customers.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data, error } = await db
        .from("customers")
        .insert({
          name: name.trim(),
          phone: phone.trim() || null,
          owner_id: session!.user.id,
        })
        .select("id,name,phone")
        .single();
      if (error) throw error;
      setCustomers((c) =>
        [...c, data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setModal(null);
      setName("");
      setPhone("");
      setNotice("Customer saved in database.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteCustomer(record: Customer) {
    if (!db || busy) return;
    if (
      !window.confirm(
        `Delete ${record.name} from your customers? Their past bills, payments and remaining balances will be kept. You can still receive payment on their existing bills.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { error } = await db.rpc("archive_customer", { p_id: record.id });
      if (error) throw error;
      setCustomers((current) => current.filter((c) => c.id !== record.id));
      setNotice("Customer deleted. Their past bills and payments are kept.");
    } catch (e) {
      setError(
        `Could not delete customer. Check that database update 006 has been applied. ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteBill(b: Bill) {
    if (
      !db ||
      !window.confirm(
        `Delete bill #${b.bill_number} for ${b.customer_name} from active sales? Tracked bundles will return to stock. Recorded payments will remain in history; this does not record a refund.`,
      )
    )
      return;
    setBusy(true);
    try {
      const { error } = await db.rpc("delete_bill_v2", { p_id: b.id });
      if (error) throw error;
      await load();
      await loadCatalog();
      setNotice("Bill deleted. Tracked stock restored.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportExcel() {
    try {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("Daily sales", {
        pageSetup: {
          paperSize: 9,
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        },
      });
      sheet.addRows(reportRows(dayBills));
      sheet.columns.forEach((column, index) => {
        column.width = [12, 14, 30, 18, 12, 12, 15, 20, 20, 20, 20][index];
      });
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF245B49" },
        };
      });
      sheet.getRow(sheet.rowCount).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: "A1", to: "K1" };
      for (const col of [7, 8, 9, 10, 11])
        sheet.getColumn(col).numFmt = "#,##0.00";
      sheet.pageSetup.printTitlesRow = "1:1";
      const paymentsSheet = book.addWorksheet("Collections");
      paymentsSheet.addRows([
        [
          "Payment date",
          "Bill number",
          "Customer",
          "Bill date",
          "Received (SAR)",
        ],
        ...collections.map((p) => [
          p.payment_date,
          p.bills?.bill_number ?? "",
          p.bills?.customer_name ?? "",
          p.bills?.sale_date ?? "",
          p.amount,
        ]),
        ["TOTAL", "", "", "", sumMoney(collections.map((p) => p.amount))],
      ]);
      paymentsSheet.columns.forEach((col, index) => {
        col.width = [16, 14, 30, 16, 20][index];
      });
      paymentsSheet.getColumn(5).numFmt = "#,##0.00";
      paymentsSheet.getRow(1).font = { bold: true };
      const buffer = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `tawakkalna-sales-${date}${configured ? "" : "-SAMPLE"}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(`Could not export: ${(e as Error).message}`);
    }
  }
  function print(b: Bill | null) {
    setPrintBill(b);
    setTimeout(() => window.print(), 100);
  }
  if (!authReady)
    return (
      <div className="auth">
        <h2>Connecting securely…</h2>
      </div>
    );
  if (configured && !session)
    return (
      <div className="auth">
        <button
          className="theme-toggle auth-theme"
          aria-label={
            theme === "light" ? "Switch to dark mode" : "Switch to light mode"
          }
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <div className="auth-card">
          <div className="brand">
            <span className="brand-icon">
              <BrandMark />
            </span>{" "}
            Tawakkalna Polymers
          </div>
          <h1>Welcome back.</h1>
          <p>Sign in to your sales workspace.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const { error } = await db!.auth.signInWithPassword({
                email,
                password,
              });
              setError(error?.message ?? "");
              setBusy(false);
            }}
          >
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="hint">
            Your owner account is created in Supabase. Public registration is
            disabled.
          </p>
        </div>
      </div>
    );
  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-icon">
              <BrandMark />
            </span>
            <div>
              Tawakkalna
              <br />
              Polymers
            </div>
          </div>
          <div className="workspace-label">YOUR WORKSPACE</div>
          <nav>
            <button
              className={tab === "sales" ? "active" : ""}
              onClick={() => {
                setTab("sales");
                setSearch("");
              }}
            >
              <LayoutDashboard size={19} /> Daily sales
            </button>
            <button
              className={tab === "customers" ? "active" : ""}
              onClick={() => {
                setTab("customers");
                setSearch("");
              }}
            >
              <Users size={19} /> Customers
            </button>
            <button
              className={tab === "products" ? "active" : ""}
              onClick={() => setTab("products")}
            >
              <Package size={19} /> Bag sizes
            </button>
            <button
              className={tab === "stock" ? "active" : ""}
              onClick={() => setTab("stock")}
            >
              <Package size={19} /> Stock
            </button>
            <button
              className={tab === "balances" ? "active" : ""}
              onClick={() => {
                setTab("balances");
                setSearch("");
              }}
            >
              <Users size={19} /> Unpaid bills
            </button>
          </nav>
          <div className="profile">
            <span className="avatar">O</span>
            <div>
              <strong>Owner workspace</strong>
              <small>{configured ? "Secure database" : "Sample preview"}</small>
            </div>
            {configured && (
              <button title="Sign out" onClick={() => void db!.auth.signOut()}>
                <LogOut size={17} />
              </button>
            )}
          </div>
        </aside>
        <main>
          <header className="topbar">
            <span>
              Workspace <ChevronRight size={14} />{" "}
              <strong>
                {tab === "sales"
                  ? "Daily sales"
                  : tab === "customers"
                    ? "Customers"
                    : tab === "stock"
                      ? "Warehouse stock"
                      : tab === "balances"
                        ? "Unpaid bills"
                        : "Bag sizes"}
              </strong>
            </span>
            <div className="header-tools">
              <button
                className="theme-toggle"
                title={
                  theme === "light"
                    ? "Switch to dark mode"
                    : "Switch to light mode"
                }
                aria-label={
                  theme === "light"
                    ? "Switch to dark mode"
                    : "Switch to light mode"
                }
                onClick={() =>
                  setTheme((t) => (t === "light" ? "dark" : "light"))
                }
              >
                {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <span className="connection">
                <i />
                {configured ? "Database configured" : "Sample preview"}
              </span>
            </div>
          </header>
          <div className="content">
            {!configured && (
              <div className="preview-banner">
                <strong>You’re viewing sample data.</strong> Connect Supabase to
                securely save your actual customers and sales.{" "}
                <span>See README.md for setup.</span>
              </div>
            )}
            <div className="page-heading">
              <div>
                <div className="eyebrow">KEEP BUSINESS MOVING</div>
                <h1>
                  {tab === "sales"
                    ? "Your sales, at a glance."
                    : tab === "customers"
                      ? "Good business starts with people."
                      : tab === "stock"
                        ? "Your warehouse, in balance."
                        : tab === "balances"
                          ? "Unpaid customer bills"
                          : "Bag sizes"}
                </h1>
                <p>
                  {tab === "sales"
                    ? "Record a sale, check your day, and leave the paperwork to us."
                    : tab === "customers"
                      ? "Keep your customers in one easy-to-find place."
                      : tab === "stock"
                        ? "Opening stock, deliveries, and corrections — all in bundles."
                        : tab === "balances"
                          ? "All outstanding bills, across every date. Record payments here."
                          : "Your complete collection of leno mesh bags. Sold by the bundle."}
                </p>
              </div>
              <button
                className="primary"
                disabled={
                  busy ||
                  (configured && !operationsReady) ||
                  (tab === "products" && !catalogReady)
                }
                onClick={() =>
                  tab === "customers"
                    ? (setModal("customer"), setError(""))
                    : tab === "products"
                      ? openSize()
                      : openSale()
                }
              >
                <Plus size={19} />
                {tab === "customers"
                  ? "Add customer"
                  : tab === "products"
                    ? "Add bag size"
                    : "New sale"}
              </button>
            </div>
            {catalogError && (
              <div className="error" role="alert">
                {catalogError}
                <button onClick={() => void loadCatalog()}>Retry</button>
              </div>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
                <button onClick={() => void load()}>Retry loading</button>
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                <Check size={17} />
                {notice}
                <button aria-label="Dismiss" onClick={() => setNotice("")}>
                  <X size={15} />
                </button>
              </div>
            )}
            {tab === "stock" && (
              <StockPanel
                catalog={catalog}
                movements={movements}
                onAdjust={setStockTarget}
                onClear={(product) => void clearStock(product)}
                busy={busy}
              />
            )}
            {(tab === "sales" || tab === "balances") && (
              <>
                <div
                  className="stats"
                  style={tab === "balances" ? { display: "none" } : {}}
                >
                  <div className="stat">
                    <span>
                      Total sales <ArrowUpRight size={18} />
                    </span>
                    <div>
                      <small>SAR</small> {money(total)}
                    </div>
                    <p>All bills for the selected day</p>
                  </div>
                  <div className="stat">
                    <span>
                      Bills recorded <LayoutDashboard size={17} />
                    </span>
                    <div>{dayBills.length.toString().padStart(2, "0")}</div>
                    <p>
                      <b className="green">
                        {dayBills.filter((b) => remaining(b) === 0).length} paid
                      </b>
                      <span className="dot">·</span>
                      {dayBills.filter((b) => remaining(b) > 0).length} unpaid /
                      partial
                    </p>
                  </div>
                  <div className="stat">
                    <span>
                      Bundles sold <Package size={18} />
                    </span>
                    <div>{bundles}</div>
                    <p>
                      Across{" "}
                      {
                        new Set(
                          dayBills.flatMap((b) => b.items.map((i) => i.size)),
                        ).size
                      }{" "}
                      bag sizes
                    </p>
                  </div>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {tab === "balances"
                          ? "All unpaid bills"
                          : "Daily sales"}
                      </h2>
                      <p>
                        {tab === "balances"
                          ? `Outstanding: SAR ${money(sumMoney(outstanding.map(remaining)))}`
                          : "Every bill, all in one place."}
                      </p>
                    </div>
                    <div
                      className="tools"
                      style={tab === "balances" ? { display: "none" } : {}}
                    >
                      <input
                        aria-label="Sales date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                      <button
                        className="secondary"
                        disabled={
                          !dayBills.length || loading || !operationsReady
                        }
                        onClick={exportExcel}
                      >
                        <Download size={16} />
                        Export Excel
                      </button>
                      <button
                        className="icon-button"
                        title="Print daily report"
                        disabled={loading || !operationsReady}
                        onClick={() => print(null)}
                      >
                        <Printer size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="table-filter">
                    <div className="search">
                      <Search size={17} />
                      <input
                        placeholder="Search customer or bill number…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <span>{visible.length} bills</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>BILL / CUSTOMER</th>
                          <th>ITEMS</th>
                          <th>BUNDLES</th>
                          <th>BILL TOTAL (SAR)</th>
                          <th>REMAINING (SAR)</th>
                          <th>STATUS</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((b) => (
                          <tr key={b.id}>
                            <td>
                              <div className="customer-cell">
                                <span className="customer-avatar">
                                  {b.customer_name.slice(0, 1)}
                                </span>
                                <div>
                                  <strong>{b.customer_name}</strong>
                                  <small>
                                    Bill #{b.bill_number} · {b.sale_date}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span>
                                {b.items[0]?.size.replace("x", " × ")}
                              </span>
                              {b.items.length > 1 && (
                                <small className="more">
                                  {" "}
                                  +{b.items.length - 1} more
                                </small>
                              )}
                            </td>
                            <td>
                              {b.items.reduce((s, i) => s + i.quantity, 0)}{" "}
                              <small>bundles</small>
                            </td>
                            <td className="amount">
                              {money(b.total)} <small>SAR</small>
                            </td>
                            <td
                              className={`remaining-amount ${remaining(b) === 0 ? "is-paid" : ""}`}
                            >
                              {money(remaining(b))}
                            </td>
                            <td>
                              <span
                                className={`badge ${remaining(b) === 0 ? "paid" : "unpaid"}`}
                              >
                                <i />
                                {paymentStatus(b)}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  title={
                                    remaining(b) > 0
                                      ? "Receive payment"
                                      : "Payment history"
                                  }
                                  onClick={() => setPaymentTarget(b)}
                                >
                                  {remaining(b) > 0
                                    ? "Receive payment"
                                    : "Payment history"}
                                </button>
                                <button
                                  title="Edit bill"
                                  onClick={() => openSale(b)}
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  title="Print bill"
                                  onClick={() => print(b)}
                                >
                                  <Printer size={16} />
                                </button>
                                {configured && (
                                  <button
                                    disabled={busy}
                                    title="Delete bill"
                                    onClick={() => void deleteBill(b)}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {loading ? (
                      <div className="empty">Loading your sales…</div>
                    ) : (
                      !visible.length && (
                        <div className="empty">
                          <Package />
                          <h3>No sales here yet</h3>
                          <p>Add a sale or select another date.</p>
                        </div>
                      )
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      {tab === "balances" ? "Total remaining" : "Daily total"} ·{" "}
                      {visible.length} bills
                    </span>
                    <strong>
                      SAR{" "}
                      {money(
                        tab === "balances"
                          ? sumMoney(visible.map(remaining))
                          : total,
                      )}
                    </strong>
                  </div>
                </section>
                <div className="collection-summary">
                  <span>
                    Collected on {date}
                    <strong>
                      SAR {money(sumMoney(collections.map((p) => p.amount)))}
                    </strong>
                    <small>
                      Includes receipts retained for deleted bills and older
                      bills; excludes imported payments with unknown dates.
                    </small>
                  </span>
                  <span>
                    Remaining on selected day’s sales
                    <strong>
                      SAR {money(sumMoney(dayBills.map(remaining)))}
                    </strong>
                    <small>
                      Current unpaid balances for the selected sale date.
                    </small>
                  </span>
                </div>
                <div className="bottom-note">
                  <Check size={16} />
                  {configured
                    ? "Bills are stored securely in your database."
                    : "Sample records are for preview only. Real sales require a database connection."}
                  <span>Made for your everyday business.</span>
                </div>
              </>
            )}
            {tab === "customers" && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    Your customers <small>({customers.length})</small>
                  </h2>
                  <div className="search">
                    <Search size={17} />
                    <input
                      placeholder="Find a customer…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="customer-grid">
                  {customers
                    .filter((c) =>
                      c.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((c) => (
                      <div className="customer-card" key={c.id}>
                        <div className="customer-card-heading">
                          <span className="customer-avatar">{c.name[0]}</span>
                          <button
                            className="delete-size"
                            aria-label={`Delete customer ${c.name}`}
                            title="Delete customer"
                            disabled={!configured || busy}
                            onClick={() => void deleteCustomer(c)}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                        <h3>{c.name}</h3>
                        <p>{c.phone || "No phone added"}</p>
                        <button
                          className="secondary"
                          onClick={() => {
                            openSale();
                            setCustomer(c.id);
                          }}
                        >
                          New sale <Plus size={16} />
                        </button>
                      </div>
                    ))}
                </div>
                {!customers.length && (
                  <div className="empty">
                    Add your first customer to get started.
                  </div>
                )}
              </section>
            )}
            {tab === "products" && catalogReady && !catalog.length && (
              <div className="panel empty">
                <Package />
                <h3>No bag sizes yet</h3>
                <p>Click Add bag size to create your catalog.</p>
              </div>
            )}
            {tab === "products" && (
              <div className="product-grid">
                {catalog.map((product, index) => (
                  <article className="product-card" key={product.id}>
                    <div className="bag-illustration">
                      <Package size={42} strokeWidth={1.2} />
                    </div>
                    <small>
                      LENO MESH BAG · {String(index + 1).padStart(2, "0")}
                    </small>
                    <h2>{product.name.replace("x", " × ")}</h2>
                    <p>
                      {product.stock_initialized
                        ? `${product.stock} bundles in stock`
                        : "Opening stock not set"}
                    </p>
                    <button
                      className="text-button"
                      disabled={!catalogReady}
                      onClick={() => setStockTarget(product)}
                    >
                      {product.stock_initialized
                        ? "Add / correct stock"
                        : "Set opening stock"}
                    </button>
                    <div className="product-actions">
                      <button
                        className="text-button"
                        onClick={() => {
                          openSale();
                          setItems([
                            {
                              size: product.name,
                              quantity: 1,
                              rate: 0,
                              bag_size_id: product.id,
                            },
                          ]);
                        }}
                      >
                        New sale <Plus size={17} />
                      </button>
                      <button
                        className="secondary"
                        disabled={!catalogReady || busy}
                        onClick={() => openSize(product)}
                        aria-label={`Edit size ${product.name}`}
                      >
                        <Pencil size={15} />
                        Edit
                      </button>
                      <button
                        className="delete-size"
                        disabled={!configured || !catalogReady || busy}
                        onClick={() => void deleteSize(product)}
                        aria-label={`Delete size ${product.name}`}
                        title="Delete bag size"
                      >
                        <Trash2 size={16} />
                        Delete
                      </button>
                    </div>
                    <span>Sold by bundle</span>
                  </article>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <div className="eyebrow">
                  {modal === "sale"
                    ? "A FEW TAPS. ALL DONE."
                    : modal === "size"
                      ? "YOUR BAG SIZE CATALOG"
                      : "GROW YOUR CUSTOMER LIST"}
                </div>
                <h2 id="modal-title">
                  {modal === "customer"
                    ? "Add a customer"
                    : modal === "size"
                      ? sizeEditing
                        ? "Edit bag size"
                        : "Add bag size"
                      : editing
                        ? `Edit bill #${editing.bill_number}`
                        : "Record a new sale"}
                </h2>
              </div>
              <button
                aria-label="Close"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {!configured && (
              <p className="preview-banner">
                Sample preview — saving is enabled after database setup.
              </p>
            )}
            {modal === "sale" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveSale();
                }}
              >
                <div className="form-grid">
                  <label>
                    Customer
                    <select
                      required
                      value={customer}
                      onChange={(e) => setCustomer(e.target.value)}
                    >
                      <option value="">Select a customer</option>
                      {editing &&
                        !customers.some(
                          (c) => c.id === editing.customer_id,
                        ) && (
                          <option value={editing.customer_id}>
                            {editing.customer_name} (deleted customer)
                          </option>
                        )}
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Sale date
                    <input
                      type="date"
                      required
                      value={saleDate}
                      onChange={(e) => setSaleDate(e.target.value)}
                    />
                  </label>
                </div>
                <div className="items-heading">
                  <strong>Bag sizes & quantities</strong>
                  <small>Price per bundle in SAR</small>
                </div>
                {items.map((item, index) => (
                  <div className="item-form" key={index}>
                    <label>
                      Bag size
                      <select
                        required
                        value={item.size}
                        onChange={(e) =>
                          changeItem(index, { size: e.target.value })
                        }
                      >
                        <option value="">Select size</option>
                        {Array.from(
                          new Set([
                            ...availableSizes,
                            ...(editing?.items.map((i) => i.size) ?? []),
                          ]),
                        ).map((s) => (
                          <option key={s} value={s}>
                            {s}
                            {catalog.find((p) => p.name === s)
                              ?.stock_initialized
                              ? ` · ${catalog.find((p) => p.name === s)?.stock} available`
                              : " · set opening stock"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Bundles
                      <input
                        type="number"
                        min="1"
                        max="1000000"
                        step="1"
                        required
                        value={item.quantity || ""}
                        onChange={(e) =>
                          changeItem(index, {
                            quantity: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Price / bundle
                      <input
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        required
                        value={item.rate || ""}
                        placeholder="0.00"
                        onChange={(e) =>
                          changeItem(index, { rate: Number(e.target.value) })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="remove"
                      disabled={items.length === 1}
                      aria-label="Remove item"
                      onClick={() =>
                        setItems((v) => v.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setItems((v) => [...v, { size: "", quantity: 1, rate: 0 }])
                  }
                >
                  <Plus size={17} />
                  Add another size
                </button>
                {editing ? (
                  <div className="payment-summary">
                    <span>
                      Received<strong>SAR {money(received(editing))}</strong>
                    </span>
                    <span>
                      Remaining after changes
                      <strong>
                        SAR{" "}
                        {money(
                          Math.max(0, billTotal(items) - received(editing)),
                        )}
                      </strong>
                    </span>
                    <p className="form-help">
                      To record more money, close this form and click Receive
                      payment on the bill.{" "}
                      {!editing.stock_tracked &&
                        "This historical bill does not change opening stock."}
                    </p>
                  </div>
                ) : (
                  <>
                    <label className="status-label">
                      Payment received on {saleDate}
                    </label>
                    <div className="status-toggle">
                      <button
                        type="button"
                        className={paymentMode === "full" ? "selected" : ""}
                        onClick={() => setPaymentMode("full")}
                      >
                        Paid in full
                      </button>
                      <button
                        type="button"
                        className={paymentMode === "unpaid" ? "selected" : ""}
                        onClick={() => setPaymentMode("unpaid")}
                      >
                        Unpaid
                      </button>
                      <button
                        type="button"
                        className={paymentMode === "partial" ? "selected" : ""}
                        onClick={() => setPaymentMode("partial")}
                      >
                        Partial payment
                      </button>
                    </div>
                    {paymentMode === "partial" && (
                      <label>
                        Amount received (SAR)
                        <input
                          type="number"
                          min="0.01"
                          max={billTotal(items)}
                          step="0.01"
                          required
                          value={initialPayment}
                          onChange={(e) => setInitialPayment(e.target.value)}
                        />
                      </label>
                    )}
                    <p className="form-help">
                      Remaining: SAR{" "}
                      {money(
                        Math.max(
                          0,
                          billTotal(items) -
                            (paymentMode === "full"
                              ? billTotal(items)
                              : paymentMode === "partial"
                                ? Number(initialPayment)
                                : 0),
                        ),
                      )}
                    </p>
                  </>
                )}
                <div className="bill-total">
                  <span>Bill total</span>
                  <strong>
                    <small>SAR</small> {money(billTotal(items))}
                  </strong>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={busy || !configured || !operationsReady}
                  >
                    {busy ? "Saving…" : editing ? "Save changes" : "Save bill"}
                    <Check size={17} />
                  </button>
                </div>
              </form>
            ) : modal === "size" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveSize();
                }}
              >
                <label>
                  Bag size
                  <input
                    autoFocus
                    required
                    maxLength={20}
                    value={sizeName}
                    onChange={(e) => setSizeName(e.target.value)}
                    placeholder="e.g. 40x80"
                  />
                </label>
                <p className="form-help">
                  Enter the two dimensions separated by x.{" "}
                  {sizeEditing
                    ? "Existing bills will keep the original size."
                    : "This size will appear in the sale form."}
                </p>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !configured || !catalogReady}
                  >
                    {busy ? "Saving…" : "Save bag size"}
                  </button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addCustomer();
                }}
              >
                <label>
                  Customer name
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Al Noor Farms"
                  />
                </label>
                <label>
                  Phone number <small>(optional)</small>
                  <input
                    type="tel"
                    maxLength={40}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +966 50 123 4567"
                  />
                </label>
                <div className="modal-footer">
                  <button className="primary" disabled={busy || !configured}>
                    {busy ? "Saving…" : "Save customer"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
      {stockTarget && (
        <StockDialog
          product={stockTarget}
          onClose={() => setStockTarget(null)}
          onSaved={operationSaved}
        />
      )}
      {paymentTarget && (
        <PaymentDialog
          bill={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={operationSaved}
        />
      )}
      <div className="print-view">
        <h1>Tawakkalna Polymers</h1>
        <p>
          {configured ? "" : "SAMPLE — "}
          {printBill ? `Bill #${printBill.bill_number}` : "Daily sales report"}
        </p>
        <p>Date: {printBill?.sale_date ?? date}</p>
        {printBill && (
          <p>
            Customer: {printBill.customer_name} · {paymentStatus(printBill)} ·
            Received SAR {money(received(printBill))} · Remaining SAR{" "}
            {money(remaining(printBill))}
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Bill</th>
              <th>Customer</th>
              <th>Size</th>
              <th>Bundles</th>
              <th>Rate (SAR)</th>
              <th>Amount (SAR)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(printBill ? [printBill] : dayBills).flatMap((b) =>
              b.items.map((i, index) => (
                <tr key={`${b.id}-${index}`}>
                  <td>{b.bill_number}</td>
                  <td>{b.customer_name}</td>
                  <td>{i.size}</td>
                  <td>{i.quantity}</td>
                  <td>{money(i.rate)}</td>
                  <td>{money(billTotal([i]))}</td>
                  <td>{paymentStatus(b)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <h2>Total: SAR {money(printBill?.total ?? total)}</h2>
        {!printBill && (
          <p>
            {dayBills.length} bills · {bundles} bundles · Received against these
            bills SAR {money(sumMoney(dayBills.map(received)))} · Remaining SAR{" "}
            {money(sumMoney(dayBills.map(remaining)))}
            <br />
            Money collected on {date}: SAR{" "}
            {money(sumMoney(collections.map((p) => p.amount)))}
          </p>
        )}
        <p>Sales record. This document is not a Saudi tax invoice.</p>
      </div>
    </>
  );
}
