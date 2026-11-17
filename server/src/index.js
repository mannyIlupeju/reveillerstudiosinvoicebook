import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool, migrate } from './db.js';
import { HttpError } from './util.js';
import { loadUser, requireAuth, csrfGuard } from './auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import txnRoutes, { receipts, importer } from './routes/txns.js';
import { runs, budgets, recurring, settings, activity } from './routes/misc.js';
import invoiceRoutes, { publicInvoices, shopifyWebhook } from './routes/invoices.js';
import inventoryRoutes from './routes/inventory.js';
import supplierRoutes, { fxRoutes } from './routes/suppliers.js';
import orderRoutes from './routes/orders.js';
import { runJobs } from './jobs.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'blob:', 'https://cdn.shopify.com'],
      'frame-src': ["'self'"],
      'object-src': ["'self'"],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://use.typekit.net'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://use.typekit.net', 'https://p.typekit.net'],
      'connect-src': ["'self'", 'https://p.typekit.net'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Shopify webhooks need the raw body for signature checks, so mount before express.json.
app.post('/api/webhooks/shopify', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => shopifyWebhook(req, res));

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});
app.use('/api/public/invoices', publicInvoices);

app.use('/api', csrfGuard, loadUser);
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/users', userRoutes);
app.use('/api/txns', txnRoutes);
app.use('/api/receipts', receipts);
app.use('/api/import', importer);
app.use('/api/runs', runs);
app.use('/api/budgets', budgets);
app.use('/api/recurring', recurring);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/fx', fxRoutes);
app.use('/api/settings', settings);
app.use('/api/activity', activity);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That file is too large. Receipts can be up to 6 MB.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong on the server.' : err.message, details: err.details });
});

await migrate();
app.listen(PORT, () => {
  console.log(`Reveillerstudios CRM listening on :${PORT}`);
  // Log due recurring charges and check Shopify for payments now and every 15 minutes.
  setTimeout(runJobs, 5_000);
  setInterval(runJobs, 15 * 60 * 1000);
});
