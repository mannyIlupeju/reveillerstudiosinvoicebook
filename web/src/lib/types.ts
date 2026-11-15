export type Role = 'OWNER' | 'EDITOR' | 'VIEWER';
export type User = { id: string; email: string; name: string; role: Role; active: boolean; createdAt: string };

export type Receipt = { id: string; filename: string; mimeType: string; size: number; createdAt: string };
export type Txn = {
  id: string;
  type: 'EXPENSE' | 'INCOME';
  amountCents: number;
  date: string;
  party: string;
  category: string;
  description: string;
  line: string;
  runId: string | null;
  source: 'APP' | 'RECURRING' | 'INVOICE' | 'SHOPIFY' | 'IMPORT';
  invoiceId: string | null;
  createdById: string | null;
  createdAt: string;
  receipts: Receipt[];
};

export type HistoryCost = { id: string; date: string | null; amountCents: number; party: string; description: string; category: string };
export type Run = {
  id: string;
  name: string;
  line: string;
  status: string;
  units: number;
  date: string;
  retailPriceCents: number | null;
  wholesalePriceCents: number | null;
  notes: string;
  source: 'APP' | 'IMPORT';
  historyCosts: HistoryCost[];
};

export type Rule = {
  id: string;
  party: string;
  amountCents: number;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  nextDue: string;
  category: string;
  line: string;
  description: string;
  active: boolean;
};

export type Item = { description: string; quantity: number; unitPriceCents: number };
export type Invoice = {
  id: string;
  kind: 'RECEIVABLE' | 'PAYABLE';
  number: string;
  party: string;
  clientEmail: string;
  items: Item[];
  amountCents: number;
  category: string;
  line: string;
  issueDate: string;
  dueDate: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  paidDate: string | null;
  notes: string;
  publicToken: string | null;
  shopifyInvoiceUrl: string | null;
  payLinkReady: boolean;
  sentAt: string | null;
};

export type Settings = {
  businessName: string;
  businessEmail: string;
  businessAddress: string;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  paymentTermsDays: number;
  chargeTax: boolean;
  invoiceFooter: string;
};

export type InventoryItem = {
  shopifyVariantId: string;
  shopifyProductId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  productType: string;
  productStatus: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | string;
  imageUrl: string | null;
  priceCents: number;
  quantity: number;
  tracked: boolean;
  shopifyUnitCostCents: number | null;
  unitCostCents: number | null;
  runId: string | null;
  lowStockAt: number | null;
  syncedAt: string;
};
export type SyncStatus = { at: string | null; ok: boolean | null; error: string | null; count: number };
