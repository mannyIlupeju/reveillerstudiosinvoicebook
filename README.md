# Reveillerstudios CRM

Bookkeeping for Reveiller Studios: expenses and income, production runs with unit costs and margins, monthly budgets, recurring charges, receipts, bank CSV import, and client invoices that clients pay through Shopify.

- **Frontend:** React + TypeScript (Vite), plain CSS (`web/`)
- **Backend:** Node + Express, Postgres via `pg` (`server/`)
- **Hosting:** one Render web service (serves the API and the built React app) plus Render Postgres, defined in `render.yaml`

## How it works

| Feature | Where it lives |
|---|---|
| Logins and roles (owner, editor, viewer) | `server/src/routes/auth.js`, `users.js`. Session cookies, bcrypt passwords, invite links that expire after 7 days. |
| Transactions, receipts, CSV export, CSV import | `server/src/routes/txns.js`. Receipts are stored in Postgres (up to 6 MB each, 5 per entry). Imports skip duplicates by content hash. |
| Production runs, budgets, recurring rules, settings, activity log | `server/src/routes/misc.js` |
| Invoices, client invoice page, Shopify payments | `server/src/routes/invoices.js`, `server/src/shopify.js` |
| Inventory | `server/src/inventory.js`, `routes/inventory.js`. Mirrors Shopify product variants and stock. Unit cost, linked production run and low-stock level are set in the app and survive every sync. |
| Suppliers and currencies | `server/src/routes/suppliers.js`, `server/src/fx.js`. Suppliers can be set on production-type expenses, bills and runs. Amounts in USD, EUR, GBP or CNY are converted to CAD with the Bank of Canada daily rate (cached in `fx_rates`); the original amount is kept. A foreign bill is converted again at its payment date. Supplier order sheets can be imported. |
| Scheduled jobs | `server/src/jobs.js`. Every 15 minutes the server logs any recurring charges that have come due, asks Shopify whether open invoices have been paid, and refreshes inventory. All are safe to run repeatedly. |
| Database schema | `server/migrations/*.sql`, applied automatically on startup |

Every change is recorded in the activity log (Settings page).

## Run it locally

Needs Node 20+ and Postgres.

```bash
createdb reveiller_books
cp server/.env.example server/.env      # set DATABASE_URL; SETUP_TOKEN can stay as-is locally
npm install --prefix server && npm install --prefix web
npm run dev:server                      # API on :3000
npm run dev:web                         # app on http://localhost:5173
```

The first visit asks you to create the owner account using the `SETUP_TOKEN`.

## Deploy on Render

1. Push this repo to GitHub.
2. In Render: **New > Blueprint**, pick the repo, and apply. This creates the `reveiller-books` web service (Starter) and the `reveiller-books-db` Postgres database (Basic-256mb).
3. Open the web service's **Environment** tab and copy the generated `SETUP_TOKEN`.
4. Visit the service URL, enter the setup code, and create your owner account.
5. Invite the team from the **Team** page and send them their invite links.

Optional: add a custom domain such as `books.reveillerstudios.com` under the service's Settings.

## Connect Shopify (for invoice payments)

The app creates a Shopify **draft order** for each client invoice. Shopify hosts the secure checkout and can email the invoice. When the client pays, the draft order completes and the app marks the invoice paid and logs the income.

1. Go to the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard) with the account that owns the store, and **create an app** (for example "Reveillerstudios CRM").
2. On the app's version, grant the Admin API scopes `write_draft_orders`, `read_draft_orders`, `read_orders`, `read_products` and `read_inventory`, then release the version. (The last two power the Inventory page.)
3. Install the app on your store.
4. Copy the app's **Client ID** and **Client secret**.
5. In Render, set these environment variables on the web service, then save (it redeploys):
   - `SHOPIFY_STORE_DOMAIN` = `your-store.myshopify.com`
   - `SHOPIFY_CLIENT_ID`
   - `SHOPIFY_CLIENT_SECRET`
6. In the app, the Invoices page shows **Shopify payments: Connected**.

If you already have a legacy custom app with an Admin API access token (`shpat_…`), you can set `SHOPIFY_ADMIN_TOKEN` instead of the client ID and secret.

Optional, for near-instant updates: in the app's configuration add a webhook for `draft_orders/update` pointing to `https://<your-app-url>/api/webhooks/shopify`. Without it, payments are still picked up within 15 minutes.

**Tax:** invoices are created tax-exempt by default. Once you register for HST, turn on "Let Shopify add sales tax" in Settings.

**Fees:** the income entry is the invoice total. Shopify's processing fee comes out of your payout, so log payout fees under *Bank & Payment Fees* if you want net figures.

## Backups

Render takes daily backups of paid Postgres databases. You can also download a full CSV of all transactions from the Transactions page at any time.
