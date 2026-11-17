// Shopify orders for the fulfilment queue, read live (cached briefly) so customer
// details never land in this app's database.
import { shopifyConfigured, shopifyGraphql } from './shopify.js';

const CUSTOMER_FIELDS = `email shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 phone }`;
const orderQuery = (withCustomer) => `
  query Orders($q: String!, $n: Int!) {
    orders(first: $n, sortKey: CREATED_AT, reverse: true, query: $q) {
      nodes {
        id legacyResourceId name createdAt displayFinancialStatus displayFulfillmentStatus note tags
        subtotalLineItemsQuantity
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingLine { title }
        lineItems(first: 50) { nodes { id title variantTitle quantity unfulfilledQuantity sku image { url(transform: {maxWidth: 120}) } } }
        fulfillments(first: 5) { createdAt trackingInfo(first: 3) { number company url } }
        ${withCustomer ? CUSTOMER_FIELDS : ''}
      }
    }
  }`;

const VIEWS = {
  open: { q: 'status:open AND (fulfillment_status:unshipped OR fulfillment_status:partial)', n: 100 },
  recent: { q: 'fulfillment_status:shipped', n: 25 },
};

const cents = (a) => Math.round(Number(a || 0) * 100);
function shape(o, withCustomer) {
  const a = withCustomer ? o.shippingAddress : null;
  return {
    id: o.legacyResourceId,
    name: o.name,
    createdAt: o.createdAt,
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
    note: o.note || '',
    tags: o.tags || [],
    itemCount: o.subtotalLineItemsQuantity,
    totalCents: cents(o.totalPriceSet?.shopMoney?.amount),
    currency: o.totalPriceSet?.shopMoney?.currencyCode || 'CAD',
    shipping: o.shippingLine?.title || null,
    items: o.lineItems.nodes.map((l) => ({
      id: l.id, title: l.title, variant: l.variantTitle || '', sku: l.sku || '', quantity: l.quantity,
      unfulfilled: l.unfulfilledQuantity, image: l.image?.url || null,
    })),
    tracking: (o.fulfillments || []).flatMap((f) => (f.trackingInfo || []).map((t) => ({ ...t, at: f.createdAt }))),
    customer: withCustomer ? {
      email: o.email || '',
      name: a?.name || '',
      address: a ? [a.address1, a.address2, [a.city, a.provinceCode, a.zip].filter(Boolean).join(' '), a.countryCodeV2].filter(Boolean) : [],
      phone: a?.phone || '',
    } : null,
  };
}

const cache = new Map(); // view -> { at, data }
const TTL = 60_000;

export async function fetchOrders(view = 'open', { fresh = false } = {}) {
  if (!shopifyConfigured()) return { configured: false, orders: [], customerHidden: false, at: null };
  const v = VIEWS[view] || VIEWS.open;
  const hit = cache.get(view);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.data;
  let withCustomer = true;
  let res;
  try {
    res = await shopifyGraphql(orderQuery(true), { q: v.q, n: v.n });
  } catch (e) {
    // The app may not have access to customer names/addresses (protected customer data).
    // Fall back to the order without them rather than showing nothing.
    withCustomer = false;
    res = await shopifyGraphql(orderQuery(false), { q: v.q, n: v.n }).catch(() => { throw e; });
  }
  const data = { configured: true, orders: res.orders.nodes.map((o) => shape(o, withCustomer)), customerHidden: !withCustomer, at: new Date().toISOString() };
  cache.set(view, { at: Date.now(), data });
  return data;
}

export const clearOrderCache = () => cache.clear();
