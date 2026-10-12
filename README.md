# Mesh & Co. sales

A mobile-friendly English sales application for leno mesh bags sold by bundle. Includes all sixteen sizes, customers, manually entered prices in SAR, multiple items per bill, Paid/Unpaid status, dated sales, corrections, deletion confirmation, Excel daily exports, and individual/daily printing.

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
5. Restart `npm run dev`. Sign in, add a customer, and save a small test bill. Reload to confirm persistence, edit its status, export the day's Excel file, and print a bill. Delete the test bill afterward if appropriate.

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

Sales records only: no partial payments, balances, inventory, VAT calculations, or ZATCA compliance. Printed documents are not Saudi tax invoices. Sample preview is for interface review only. Customer phone numbers are optional. Currency is SAR, quantities are whole bundles, prices have at most two decimals.

Live integration and authorization tests require an actual Supabase project; unit tests/build alone do not validate the deployed database. Before production verify that a signed-out request cannot read records and that a second test user cannot read or change the owner's bills. Do not share credentials in chat.
