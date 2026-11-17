export const EXPENSE_CATEGORIES = [
  'Production & Manufacturing', 'Blanks & Materials', 'Samples & Development', 'Packaging & Shipping',
  'Marketing & Ads', 'Photography & Content', 'Software & Subscriptions', 'Studio & Rent', 'Events & Pop-ups',
  'Professional Fees', 'Bank & Payment Fees', 'Equipment', 'Travel & Transport', 'Miscellaneous',
];
export const INCOME_CATEGORIES = ['Online Sales', 'Wholesale', 'Events & Pop-ups', 'Custom Orders', 'Collaborations', 'Refunds', 'Other Income'];
export const LINES = ['Shared', 'RVS', 'Reveillerstudios'];
export const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];
export const RUN_STATUSES = ['Open', 'In progress', 'On hold', 'Closed'];

export const DEFAULT_SETTINGS = {
  businessName: 'Reveiller Studios',
  businessEmail: '',
  businessAddress: 'Toronto, ON',
  invoicePrefix: 'RVS-',
  nextInvoiceNumber: 1001,
  paymentTermsDays: 30,
  chargeTax: false,
  invoiceFooter: 'Thank you for supporting Reveiller Studios.',
};
