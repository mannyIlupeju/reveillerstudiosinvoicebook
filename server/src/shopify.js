// Shopify Admin GraphQL client for invoice payments via draft orders.
// Auth: either a static Admin API token (SHOPIFY_ADMIN_TOKEN) or a Dev Dashboard app's
// client credentials (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET), exchanged for a 24h token.
import crypto from 'node:crypto';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

function shopDomain() {
  const s = (process.env.SHOPIFY_STORE_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s) return '';
  return s.includes('.') ? s : `${s}.myshopify.com`;
}

export function shopifyConfigured() {
  return Boolean(shopDomain() && (process.env.SHOPIFY_ADMIN_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)));
}

let cached = { token: null, expiresAt: 0 };
async function accessToken() {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const code = body.match(/Oauth error (\w+)/i)?.[1] || '';
    const hints = {
      app_not_installed: 'The Reveiller Books app isn’t installed on your store yet. Install it from the Shopify Dev Dashboard, then try again.',
      shop_not_permitted: 'This store isn’t in the same Shopify organization as the app. Create the app from the Dev Dashboard of the account that owns the store.',
      invalid_client: 'Shopify didn’t accept the client ID or secret. Check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET on the server.',
    };
    throw new Error(hints[code] || `Shopify sign-in failed (${res.status}${code ? `: ${code}` : ''}).`);
  }
  const { access_token, expires_in } = await res.json();
  cached = { token: access_token, expiresAt: Date.now() + (expires_in || 86399) * 1000 };
  return access_token;
}

export async function shopifyGraphql(query, variables = {}) {
  if (!shopifyConfigured()) throw new Error('Shopify is not connected. Add the Shopify settings to the server environment.');
  const res = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`Shopify error: ${body.errors.map((e) => e.message).join('; ')}`);
  return body.data;
}

function userErrors(errs) {
  if (errs?.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join('; ')}`);
}

// Create a draft order mirroring the invoice's line items. Returns { id, invoiceUrl }.
export async function createDraftOrder(inv, { chargeTax = false } = {}) {
  const items = Array.isArray(inv.items) && inv.items.length ? inv.items : [{ description: `Invoice ${inv.number}`, quantity: 1, unitPriceCents: inv.amountCents }];
  const input = {
    note: `Reveiller Books invoice ${inv.number}${inv.notes ? `\n${inv.notes}` : ''}`,
    tags: ['reveiller-books', `invoice-${inv.number}`.slice(0, 40)],
    taxExempt: !chargeTax,
    lineItems: items.map((it) => ({
      title: String(it.description).slice(0, 255) || 'Item',
      originalUnitPrice: (it.unitPriceCents / 100).toFixed(2),
      quantity: Math.max(1, Math.round(it.quantity)),
      requiresShipping: false,
      taxable: chargeTax,
    })),
    customAttributes: [{ key: 'reveiller_books_invoice', value: inv.id }],
  };
  if (inv.clientEmail) input.email = inv.clientEmail;
  const data = await shopifyGraphql(
    `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } } }`,
    { input },
  );
  userErrors(data.draftOrderCreate.userErrors);
  return data.draftOrderCreate.draftOrder;
}

export async function sendDraftOrderInvoice(draftOrderId, { to, subject, message }) {
  const email = { to, subject, customMessage: message };
  const data = await shopifyGraphql(
    `mutation($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id invoiceSentAt } userErrors { field message } } }`,
    { id: draftOrderId, email },
  );
  userErrors(data.draftOrderInvoiceSend.userErrors);
  return data.draftOrderInvoiceSend.draftOrder;
}

export async function deleteDraftOrder(draftOrderId) {
  const data = await shopifyGraphql(
    `mutation($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { field message } } }`,
    { input: { id: draftOrderId } },
  );
  userErrors(data.draftOrderDelete.userErrors);
}

// Returns { status, paid, orderId, orderName, paidAt }.
export async function draftOrderPaymentStatus(draftOrderId) {
  const data = await shopifyGraphql(
    `query($id: ID!) { draftOrder(id: $id) { id status completedAt order { id name displayFinancialStatus processedAt } } }`,
    { id: draftOrderId },
  );
  const d = data.draftOrder;
  if (!d) return { status: 'MISSING', paid: false };
  const fin = d.order?.displayFinancialStatus;
  return {
    status: d.status,
    paid: d.status === 'COMPLETED' && fin === 'PAID',
    orderId: d.order?.id || null,
    orderName: d.order?.name || null,
    paidAt: d.order?.processedAt || d.completedAt || null,
  };
}

// Verify a Shopify webhook's HMAC signature against the raw request body.
export function verifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret || !hmacHeader || !rawBody) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
