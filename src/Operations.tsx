import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import { fetchAll } from "./pagination";
import { db, configured } from "./database";
import {
  money,
  today,
  received,
  remaining,
  type BagSize,
  type Bill,
  type Payment,
  type Movement,
} from "./domain";
export function StockPanel({
  catalog,
  movements,
  onAdjust,
  onClear,
  busy,
}: {
  catalog: BagSize[];
  movements: Movement[];
  onAdjust: (p: BagSize) => void;
  onClear: (p: BagSize) => void;
  busy: boolean;
}) {
  return (
    <>
      <section className="panel stock-panel">
        <div className="panel-heading">
          <div>
            <h2>Warehouse stock</h2>
            <p>
              Set today's physical count once. New sales deduct bundles
              automatically.
            </p>
          </div>
          <div>
            <strong>
              {catalog.reduce((s, p) => s + (p.stock ?? 0), 0)} bundles recorded
            </strong>
            {catalog.some((p) => !p.stock_initialized) && (
              <p>
                {catalog.filter((p) => !p.stock_initialized).length} sizes still
                need an opening count.
              </p>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SIZE</th>
                <th>AVAILABLE BUNDLES</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((p) => (
                <tr key={p.id}>
                  <td>{p.name.replace("x", " × ")}</td>
                  <td>{p.stock_initialized ? p.stock : "Not set"}</td>
                  <td>
                    <div className="stock-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => onAdjust(p)}
                      >
                        <Plus size={15} />
                        {p.stock_initialized
                          ? "Add / correct stock"
                          : "Set opening stock"}
                      </button>
                      <button
                        className="delete-size"
                        disabled={
                          busy || !configured || !(p.stock && p.stock > 0)
                        }
                        aria-label={`Delete stock for ${p.name}`}
                        onClick={() => onClear(p)}
                      >
                        Delete stock
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!catalog.length && (
            <div className="empty">Add a bag size first.</div>
          )}
        </div>
      </section>
      <section className="panel history-panel">
        <div className="panel-heading">
          <div>
            <h2>Stock history</h2>
            <p>
              Latest 100 deliveries, corrections, and sale adjustments. Dates
              are shown as recorded.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DATE</th>
                <th>SIZE</th>
                <th>CHANGE</th>
                <th>REASON</th>
                <th>NOTE</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{m.movement_date}</td>
                  <td>{m.size_name}</td>
                  <td className={m.delta > 0 ? "green" : ""}>
                    {m.delta > 0 ? "+" : ""}
                    {m.delta}
                  </td>
                  <td>{m.kind.replaceAll("_", " ")}</td>
                  <td>{m.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!movements.length && (
            <div className="empty">No stock movements yet.</div>
          )}
        </div>
      </section>
    </>
  );
}
export function StockDialog({
  product,
  onClose,
  onSaved,
}: {
  product: BagSize;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState(
      product.stock_initialized ? "delivery" : "opening",
    ),
    [quantity, setQuantity] = useState(""),
    [date, setDate] = useState(today()),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!db) return;
    setBusy(true);
    setError("");
    try {
      const n = Number(quantity);
      if (!quantity || !Number.isSafeInteger(n) || Math.abs(n) > 1000000)
        throw Error("Enter a whole number of bundles, up to 1,000,000.");
      const { error } = await db.rpc("adjust_stock", {
        p_size_id: product.id,
        p_quantity: n,
        p_kind: kind,
        p_date: date,
        p_note: note,
        p_request_id: requestId,
      });
      if (error) throw error;
      onSaved("Warehouse stock updated.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-title"
      >
        <div className="modal-heading">
          <h2 id="stock-title">Stock · {product.name}</h2>
          <button aria-label="Close stock" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="form-help">
          Current stock:{" "}
          {product.stock_initialized ? `${product.stock} bundles` : "not set"}.
          Opening stock should be your current physical warehouse count, after
          existing sales.
        </p>
        <form onSubmit={(e) => void save(e)}>
          <label>
            Operation
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {!product.stock_initialized ? (
                <option value="opening">Opening stock</option>
              ) : (
                <>
                  <option value="delivery">New delivery</option>
                  <option value="correction">Stock correction</option>
                </>
              )}
            </select>
          </label>
          <div className="form-grid">
            <label>
              {kind === "opening"
                ? "Current bundle count"
                : kind === "correction"
                  ? "Change (+ or − bundles)"
                  : "Bundles received"}
              <input
                type="number"
                required
                step="1"
                min={
                  kind === "correction" ? -1000000 : kind === "opening" ? 0 : 1
                }
                max="1000000"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <label>
            Note (optional)
            <input
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy || !configured}>
              {busy ? "Saving…" : "Save stock"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
export function PaymentDialog({
  bill,
  onClose,
  onSaved,
}: {
  bill: Bill;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]),
    [loaded, setLoaded] = useState(!configured),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(today()),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    if (!db) return;
    fetchAll<Payment>((from, to) =>
      db!
        .from("payments")
        .select("*")
        .eq("bill_id", bill.id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    )
      .then(({ data }) => {
        if (!active) return;
        setPayments(data);
        setLoaded(true);
      })
      .catch((e) => {
        if (active) {
          setError((e as Error).message);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [bill.id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!db || busy) return;
    setBusy(true);
    setError("");
    try {
      const n = Number(amount);
      if (
        !amount ||
        !Number.isFinite(n) ||
        n <= 0 ||
        n > remaining(bill) ||
        Math.abs(n * 100 - Math.round(n * 100)) > 0.00001
      )
        throw Error(
          "Enter a valid amount, no more than the remaining balance, with at most two decimals.",
        );
      const { error } = await db.rpc("record_payment", {
        p_bill_id: bill.id,
        p_amount: n,
        p_date: date,
        p_note: note,
        p_request_id: requestId,
      });
      if (error) throw error;
      onSaved("Payment recorded. Remaining balance updated.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function voidPayment(payment: Payment) {
    if (
      !db ||
      busy ||
      !window.confirm(
        `Void this SAR ${money(payment.amount)} payment? The bill's unpaid balance will increase. The original record will remain in history.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { error } = await db.rpc("void_payment", {
        p_payment_id: payment.id,
      });
      if (error) throw error;
      onSaved("Payment voided. Remaining balance updated.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="payment-title">
              {remaining(bill) > 0 ? "Receive payment" : "Payment history"} · #
              {bill.bill_number}
            </h2>
            <p className="form-help">{bill.customer_name}</p>
          </div>
          <button aria-label="Close payments" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="payment-summary">
          <span>
            Bill total<strong>SAR {money(bill.total)}</strong>
          </span>
          <span>
            Received<strong>SAR {money(received(bill))}</strong>
          </span>
          <span>
            Remaining<strong>SAR {money(remaining(bill))}</strong>
          </span>
        </div>
        {remaining(bill) > 0 && (
          <form onSubmit={(e) => void save(e)}>
            <p className="form-help">
              If the customer paid the rest, select Full remaining amount, then
              Save payment. For a smaller payment, enter only what you received.
            </p>
            <button
              className="secondary settle-payment"
              type="button"
              disabled={busy}
              onClick={() => setAmount(String(remaining(bill)))}
            >
              Full remaining amount · SAR {money(remaining(bill))}
            </button>
            <div className="form-grid">
              <label>
                Amount received (SAR)
                <input
                  type="number"
                  required
                  min="0.01"
                  max={remaining(bill)}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Payment date
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            <label>
              Note (optional)
              <input
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !configured || !loaded}
            >
              {busy ? "Saving…" : "Save payment"}
            </button>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <h3 className="history-title">Payment history</h3>
        {!loaded ? (
          <p>Loading payments…</p>
        ) : !payments.length ? (
          <p className="form-help">No payments recorded.</p>
        ) : (
          <ul className="payment-history">
            {payments.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>
                    SAR {money(p.amount)} {p.voided && "· Voided"}
                  </strong>
                  <small>
                    {p.is_opening
                      ? "Paid before tracking; date unknown"
                      : p.payment_date}
                  </small>
                  <small>{p.note}</small>
                </div>
                {!p.voided && (
                  <button
                    type="button"
                    className="delete-size"
                    disabled={busy}
                    onClick={() => void voidPayment(p)}
                  >
                    Void
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
