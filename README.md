# Tawakkalna Polymers sales

A mobile-friendly English sales application for leno mesh bags sold by bundle. Includes all sixteen sizes, customers, manually entered prices in SAR, multiple items per bill, Paid/Partially paid/Unpaid status, dated sales, corrections, deletion confirmation, Excel daily exports, and individual/daily printing.

## Publish a demo without installing anything

1. Open https://vercel.com/new and sign in with GitHub.
2. Allow Vercel access to `omer2626/demo_app` when GitHub asks. Select only this repository if you prefer.
3. Find `demo_app` in the import list and click **Import**.
4. Leave the project settings as detected: Vite, `npm run build`, output `dist`. Do not add Supabase variables yet for the sample demo.
5. Click **Deploy**, then **Visit** once the deployment completes. Copy the public website address.

The first deployment shows labelled sample data and disables real saving. For real sales, complete the database setup below and add both public Supabase variables in Vercel's project environment settings, then redeploy. Never enter a service-role key or database password there. Backups and database access checks are still required before production use.

Vercel connects to the existing GitHub repository. Future pushes to `main` trigger a new website deployment automatically. Connecting/publishing requires the repository owner's Vercel authorization and has not been completed from this workspace.

## Run locally

Requires Node.js 22.12+ (tested with 24.19).

```sh
cd /workspace/demo_app
npm ci
npm run dev
```

Without database settings the application displays clearly labelled sample data; saving is disabled. It never stores actual sales in browser storage. Supabase may store the login session in the browser; sales and customers live in PostgreSQL.

## Connect your database

1. Create a Supabase project. Keep the database password private.
2. In its SQL editor, execute `supabase/schema.sql` once on a new database. It creates the tables, validation, atomic bill-saving function, and owner access policies.
3. In Authentication settings disable new user signups. Under Users create your owner user with an email and password. Use that account to sign into the app.
4. Copy `.env.example` to `.env`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the project URL and public publishable key from Supabase. The legacy public anon key also works. These are public client settings. NEVER use a service-role key, database password, or secret API key in a VITE variable.
5. Restart `npm run dev`. Sign in, add a clearly labelled test customer, and set the current physical count for one size under Stock. Save a small unpaid test bill, reload to confirm persistence, export Excel, and print the bill. Delete the unpaid test bill afterward; its stock is restored.

Each owner's records are isolated by PostgreSQL row-level security. Bills and line items save in one transaction; the database calculates the authoritative total. Bills retain the customer's name as a snapshot. Automatic bill numbers may have gaps after deletions or rolled-back transactions. Dates default to Saudi Arabia time.

## Check an upgrade

```sh
npm ci
npm test
npm run build
```

Deploy the generated `dist` folder to a static hosting provider such as Vercel or Netlify, with the two public environment variables set at build time. Rebuilding/upgrading the interface does not remove database records. Internet access is needed to log in, load records, and save bills; failed saves display an error and keep the entered form open. The schema file is an initial migration: do not rerun it over an existing database. Back up production data before future schema changes.

## Backups before using real sales

Choose a Supabase plan with daily managed backups and an appropriate retention period. Verify backup availability in the Supabase dashboard and document/test restoring into a separate project before relying on it. Also schedule independent encrypted PostgreSQL backups using a trusted backup service or `pg_dump` with credentials kept outside this application. Excel is a daily sales report, not a full database backup. Backup scheduling, retention and a restore test are not configured by this repository and remain deployment requirements.

## Current scope

Includes warehouse stock, payment history and remaining balances. VAT calculations and ZATCA compliance are not included. Printed documents are not Saudi tax invoices. Sample preview is for interface review only. Customer phone numbers are optional. Currency is SAR, quantities are whole bundles, prices have at most two decimals.

Live integration and authorization tests require an actual Supabase project; unit tests/build alone do not validate the deployed database. Before production verify that a signed-out request cannot read records and that a second test user cannot read or change the owner's bills. Do not share credentials in chat.

## Upgrade an existing database for editable bag sizes

In your existing Supabase project, open SQL Editor and run **supabase/migrations/002_editable_bag_sizes.sql** once. Do not rerun the full schema on an existing database. This adds an owner-only catalog, seeds existing sizes, and updates the bill-saving function to accept custom sizes. Existing customers, bills and line items are retained. Renaming a catalog entry does not rewrite historical sales. For an older database, apply all applicable later migrations in order before using the current app. It displays an update message if the required tables or columns are missing.

Dark mode is controlled by the moon/sun button and remembered on this device. This browser preference does not store sales data.

## Enable deletion of bag sizes

After migration 002, run `supabase/migrations/003_delete_bag_sizes.sql` once in Supabase SQL Editor. It enables owner-only catalog deletion and prevents default sizes returning when the last size is deleted. Existing bills and sale items retain their recorded sizes and can still be edited. New sales cannot use a deleted size. The Delete button asks for confirmation, and failed deletions leave the size visible.

## Upgrade for warehouse stock and partial payments

After migrations 002 and 003 have been applied, run **supabase/migrations/004_stock_and_payments.sql** once in Supabase SQL Editor. Do not rerun the full schema on an existing database. Back up the database first. Deployments and this file do not apply SQL to your live project automatically.

1. In the app open **Stock** and use **Set opening stock** for each size, entering the physical bundles available now (zero is valid). New sizes also need opening stock before their first sale.
2. Record deliveries with **Add / correct stock → New delivery**. Use **Stock correction** for signed changes with an optional note. Stock never goes below zero.
3. New sales deduct stock atomically; edits deduct/return only the difference and deleted sales return their tracked bundles. Repeated sizes on one bill are aggregated. Old bills are marked historical and never deduct from the new physical opening count, even when edited/deleted.
4. For a new sale select **Paid in full**, **Unpaid** or **Partial payment**. Open **Payments** on any bill to record later receipts or inspect history. **Unpaid bills** includes balances across all dates. Overpayments and edits below money already received are rejected.
5. Previously paid bills receive a labelled imported payment with no assumed collection date; previously unpaid bills start with zero received. Record any previously untracked partial receipts with their actual dates.
6. **Void** corrects an erroneous payment, retaining its record/timestamp and restoring the balance. It is not a refund operation. To delete a sale with payments, void those payments first. Deleted sales are retained with an `is_deleted` flag for audit; stock and payment history are preserved.
7. Excel contains **Daily sales** (bill totals, received-to-date and remaining balance, counted once per bill) and **Collections** (active receipts on the selected date, including payments for older bills). Imported payments of unknown date are excluded from daily collections. Voided payments are excluded; their original payment dates' totals change accordingly. Printing also includes received/remaining totals.

Catalog deletion now archives the size rather than removing its database row; stocked sizes cannot be deleted until stock is corrected to zero with an optional note. If a later sale correction/deletion returns bundles to an archived size, it becomes visible again. Re-adding a previously archived name reuses its stable identity. Do not directly edit `stock`, totals, payments, or `is_deleted` in Table Editor. Use the app's RPC-backed controls to preserve ledger consistency.

Success messages dismiss after four seconds; errors remain until resolved/dismissed by subsequent actions. Sales/payments/delivery requests include retry identifiers to prevent duplicate effects. Complete sales/collection reports are loaded in pages; stock history shows the latest 100 movements, with all movements retained in PostgreSQL.

Run `npm test` for calculation, pagination and embedded PostgreSQL migration/transaction tests. Tests create isolated data and never connect to production Supabase. Live deployment saving still needs verification after applying migration 004.

## Simpler stock and payment controls

After migration 004, run **supabase/migrations/005_simple_stock_and_payments.sql** once. Stock corrections no longer require a reason. In **Stock**, **Delete stock** asks for confirmation and sets available bundles to zero, retaining the size, stock history and all sales/payment records. To remove the bag size as well, use Delete on the Bag sizes page afterward.

On a bill, use **Receive payment → Full remaining amount → Save payment** when the customer pays the rest. Enter a smaller amount to record another partial payment. Fully paid bills show **Payment history** instead. The sales table has a separate **Remaining (SAR)** column; fully paid bills display **0.00**.
