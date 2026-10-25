// Runs the actual PostgreSQL migration and RPCs in an isolated embedded database.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite,
  customer: string,
  size: string,
  oldBill: string,
  paidBill: string,
  bill: string;
const uuid = () => crypto.randomUUID();
async function query<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
) {
  return (await db.query<T>(sql, args)).rows;
}
async function login(id = owner) {
  await query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function stock() {
  return Number(
    (await query("select stock from public.bag_sizes where id=$1", [size]))[0]
      .stock,
  );
}
async function state(id = bill) {
  return (await query("select * from public.bills where id=$1", [id]))[0];
}
async function save(
  id: string | null,
  quantity: number,
  payment = 0,
  request = uuid(),
  rate = 10,
) {
  return (
    await query("select public.save_bill_v2($1,$2,$3,$4::jsonb,$5,$6) as id", [
      id,
      customer,
      "2026-10-25",
      JSON.stringify([{ size: "17x32", bag_size_id: size, quantity, rate }]),
      payment,
      request,
    ])
  )[0].id as string;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`,
  );
  const schema = readFileSync("supabase/schema.sql", "utf8").split(
    "-- Stock and payment upgrade",
  )[0];
  await db.exec(schema);
  await query("insert into auth.users(id) values($1),($2)", [owner, other]);
  await login();
  await query("select public.initialize_bag_sizes()");
  size = (await query("select id from public.bag_sizes where name='17x32'"))[0]
    .id as string;
  customer = (
    await query(
      "insert into public.customers(owner_id,name) values($1,'Test farm') returning id",
      [owner],
    )
  )[0].id as string;
  for (const paid of [false, true]) {
    const id = (
      await query(
        "select public.save_bill(null,$1,'2026-10-01',$2,$3::jsonb) as id",
        [
          customer,
          paid,
          JSON.stringify([{ size: "17x32", quantity: 3, rate: 12.5 }]),
        ],
      )
    )[0].id as string;
    if (paid) paidBill = id;
    else oldBill = id;
  }
  await db.exec("reset role");
  await db.exec(
    readFileSync("supabase/migrations/004_stock_and_payments.sql", "utf8"),
  );
  await login();
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("Warehouse and payment transactions", () => {
  it("preserves old bill totals/status without inventing collection dates or deducting opening stock", async () => {
    expect(await stock()).toBe(0);
    expect((await state(oldBill)).stock_tracked).toBe(false);
    expect(Number((await state(paidBill)).amount_received)).toBe(37.5);
    const imported = await query(
      "select * from public.payments where bill_id=$1",
      [paidBill],
    );
    expect(imported[0].payment_date).toBe(null);
    expect(imported[0].is_opening).toBe(true);
  });
  it("requires opening stock and prevents unauthorized direct stock writes", async () => {
    await expect(save(null, 1)).rejects.toThrow(/opening stock/);
    await expect(
      query("update public.bag_sizes set stock=100 where id=$1", [size]),
    ).rejects.toThrow(/permission denied/);
    await query(
      "select public.adjust_stock($1,100,'opening','2026-10-25','Counted warehouse',$2)",
      [size, uuid()],
    );
    expect(await stock()).toBe(100);
  });
  it("deducts stock and records a partial payment atomically; retries do not duplicate either", async () => {
    const request = uuid();
    bill = await save(null, 10, 40, request);
    expect(await stock()).toBe(90);
    expect(Number((await state()).amount_received)).toBe(40);
    expect(Number((await state()).balance)).toBe(60);
    expect((await state()).paid).toBe(false);
    expect(await save(null, 10, 40, request)).toBe(bill);
    expect(await stock()).toBe(90);
    expect(Number((await state()).amount_received)).toBe(40);
  });
  it("rolls back failed sales and refuses overpayment or excess decimals", async () => {
    const count = (await query("select * from public.bills")).length;
    await expect(save(null, 91)).rejects.toThrow(/Not enough stock/);
    await expect(save(null, 1, 11)).rejects.toThrow(/Initial payment/);
    await expect(
      query("select public.record_payment($1,60.001,'2026-10-25','',$2)", [
        bill,
        uuid(),
      ]),
    ).rejects.toThrow();
    expect(await stock()).toBe(90);
    expect((await query("select * from public.bills")).length).toBe(count);
  });
  it("adjusts only the quantity difference on bill edits; legacy edits never deduct stock", async () => {
    await save(bill, 12);
    expect(await stock()).toBe(88);
    expect(Number((await state()).balance)).toBe(80);
    await save(bill, 8);
    expect(await stock()).toBe(92);
    await save(oldBill, 5);
    expect(await stock()).toBe(92);
    await expect(save(bill, 3)).rejects.toThrow(/less than payments/);
    expect(await stock()).toBe(92);
  });
  it("sums repeated sizes and rolls back an aggregated stock shortage", async () => {
    await expect(
      query("select public.save_bill_v2(null,$1,$2,$3::jsonb,0,$4)", [
        customer,
        "2026-10-25",
        JSON.stringify([
          { size: "17x32", bag_size_id: size, quantity: 50, rate: 1 },
          { size: "17x32", bag_size_id: size, quantity: 50, rate: 1 },
        ]),
        uuid(),
      ]),
    ).rejects.toThrow(/Not enough stock/);
    expect(await stock()).toBe(92);
  });
  it("records later payments against older bills and prevents duplicate/overpayments", async () => {
    const request = uuid();
    await query(
      "select public.record_payment($1,20,'2026-10-26','Later payment',$2)",
      [bill, request],
    );
    await query(
      "select public.record_payment($1,20,'2026-10-26','Later payment',$2)",
      [bill, request],
    );
    expect(Number((await state()).balance)).toBe(20);
    await expect(
      query("select public.record_payment($1,21,'2026-10-26','',$2)", [
        bill,
        uuid(),
      ]),
    ).rejects.toThrow();
    expect(Number((await state()).amount_received)).toBe(60);
    expect(
      Number(
        (
          await query(
            "select sum(amount) as total from public.payments where payment_date='2026-10-26' and not voided and not is_opening",
          )
        )[0].total,
      ),
    ).toBe(20);
  });
  it("moves a bill to Paid, retains history when voiding, and restores stock once on deletion", async () => {
    await query("select public.record_payment($1,20,'2026-10-26','Final',$2)", [
      bill,
      uuid(),
    ]);
    expect((await state()).paid).toBe(true);
    await expect(
      query("select public.delete_bill_v2($1)", [bill]),
    ).rejects.toThrow(/Void/);
    for (const p of await query(
      "select id from public.payments where bill_id=$1",
      [bill],
    ))
      await query("select public.void_payment($1)", [p.id]);
    expect(Number((await state()).balance)).toBe(80);
    await query("select public.delete_bill_v2($1)", [bill]);
    expect(await stock()).toBe(100);
    await query("select public.delete_bill_v2($1)", [bill]);
    expect(await stock()).toBe(100);
    expect((await state()).is_deleted).toBe(true);
    expect(
      (
        await query(
          "select * from public.payments where bill_id=$1 and voided",
          [bill],
        )
      ).length,
    ).toBe(3);
  });
  it("protects deliveries/corrections and prevents retiring stock that remains in the warehouse", async () => {
    const req = uuid();
    await query(
      "select public.adjust_stock($1,10,'delivery','2026-10-26','Arrived',$2)",
      [size, req],
    );
    await query(
      "select public.adjust_stock($1,10,'delivery','2026-10-26','Arrived',$2)",
      [size, req],
    );
    expect(await stock()).toBe(110);
    await expect(
      query(
        "select public.adjust_stock($1,-111,'correction','2026-10-26','Count correction',$2)",
        [size, uuid()],
      ),
    ).rejects.toThrow(/negative/);
    await expect(
      query("select public.archive_bag_size($1)", [size]),
    ).rejects.toThrow(/still has stock/);
    await expect(
      query(
        "select public.adjust_stock($1,-1,'correction','2026-10-26','',$2)",
        [size, uuid()],
      ),
    ).rejects.toThrow(/reason/);
    expect(await stock()).toBe(110);
  });
  it("uses stable IDs through renames, preserves printed sizes and restores edited/deleted sale stock", async () => {
    const active = await save(null, 2);
    await query("select public.save_bag_size($1,'18x33')", [size]);
    await save(active, 3);
    expect(await stock()).toBe(107);
    expect(
      (
        await query("select size from public.sale_items where bill_id=$1", [
          active,
        ])
      )[0].size,
    ).toBe("17x32");
    await query("select public.delete_bill_v2($1)", [active]);
    expect(await stock()).toBe(110);
    await query("select public.save_bag_size($1,'17x32')", [size]);
  });
  it("isolates owners for stock, payments and RPC writes", async () => {
    await login(other);
    expect((await query("select * from public.payments")).length).toBe(0);
    expect((await query("select * from public.stock_movements")).length).toBe(
      0,
    );
    await expect(
      query("select public.adjust_stock($1,5,'delivery','2026-10-26','',$2)", [
        size,
        uuid(),
      ]),
    ).rejects.toThrow(/not found/);
    await expect(
      query("select public.record_payment($1,1,'2026-10-26','',$2)", [
        oldBill,
        uuid(),
      ]),
    ).rejects.toThrow(/not found/);
    await expect(
      query("select public.delete_bill_v2($1)", [oldBill]),
    ).rejects.toThrow(/not found/);
    await login();
    expect(await stock()).toBe(110);
  });
  it("rolls back all product adjustments if one size in a multi-size bill is unavailable", async () => {
    const otherSize = (
      await query("select id,name from public.bag_sizes where name='19x39'")
    )[0];
    await query(
      "select public.adjust_stock($1,1,'opening','2026-10-26','',$2)",
      [otherSize.id, uuid()],
    );
    const before = await stock();
    await expect(
      query("select public.save_bill_v2(null,$1,$2,$3::jsonb,0,$4)", [
        customer,
        "2026-10-26",
        JSON.stringify([
          { size: "17x32", bag_size_id: size, quantity: 5, rate: 10 },
          { size: "19x39", bag_size_id: otherSize.id, quantity: 2, rate: 10 },
        ]),
        uuid(),
      ]),
    ).rejects.toThrow(/Not enough stock/);
    expect(await stock()).toBe(before);
    expect(
      Number(
        (
          await query("select stock from public.bag_sizes where id=$1", [
            otherSize.id,
          ])
        )[0].stock,
      ),
    ).toBe(1);
  });
  it("reactivates a deleted size if a later bill deletion returns its bundles", async () => {
    const id = await save(null, 110);
    await query("select public.archive_bag_size($1)", [size]);
    expect(
      (
        await query("select archived from public.bag_sizes where id=$1", [size])
      )[0].archived,
    ).toBe(true);
    await query("select public.delete_bill_v2($1)", [id]);
    expect(await stock()).toBe(110);
    expect(
      (
        await query("select archived from public.bag_sizes where id=$1", [size])
      )[0].archived,
    ).toBe(false);
  });
  it("records zero opening stock once and safely retries it", async () => {
    const p = (
      await query("select id from public.bag_sizes where name='19x44'")
    )[0];
    const request = uuid();
    for (let attempt = 0; attempt < 2; attempt++)
      await query(
        "select public.adjust_stock($1,0,'opening','2026-10-26','Empty',$2)",
        [p.id, request],
      );
    expect(
      (
        await query(
          "select stock_initialized from public.bag_sizes where id=$1",
          [p.id],
        )
      )[0].stock_initialized,
    ).toBe(true);
    expect(
      (
        await query(
          "select * from public.stock_movements where request_id=$1",
          [request],
        )
      ).length,
    ).toBe(1);
  });
  it("saves paid-in-full sales with an exact receipt total", async () => {
    const before = await stock();
    const id = await save(null, 1, 10);
    expect((await state(id)).paid).toBe(true);
    expect(Number((await state(id)).balance)).toBe(0);
    const payment = (
      await query("select id from public.payments where bill_id=$1", [id])
    )[0];
    await query("select public.void_payment($1)", [payment.id]);
    await query("select public.delete_bill_v2($1)", [id]);
    expect(await stock()).toBe(before);
  });
  it("archives without erasing stock history and can re-add the same size without losing its identity", async () => {
    await query(
      "select public.adjust_stock($1,-110,'correction','2026-10-26','Removed damaged stock',$2)",
      [size, uuid()],
    );
    await query("select public.archive_bag_size($1)", [size]);
    await query("select public.initialize_bag_sizes()");
    expect(
      (
        await query("select archived from public.bag_sizes where id=$1", [size])
      )[0].archived,
    ).toBe(true);
    expect(
      (await query("select * from public.save_bag_size(null,'17x32')"))[0].id,
    ).toBe(size);
    expect(
      (
        await query(
          "select * from public.stock_movements where bag_size_id=$1",
          [size],
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});

it("installs the complete schema on a fresh project", async () => {
  const fresh = new PGlite();
  try {
    await fresh.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`,
    );
    await fresh.exec(readFileSync("supabase/schema.sql", "utf8"));
    expect(
      (
        await fresh.query(
          "select count(*)::int as count from information_schema.columns where table_name='bills' and column_name='balance'",
        )
      ).rows[0],
    ).toEqual({ count: 1 });
  } finally {
    await fresh.close();
  }
}, 30000);
