import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool, q, one, newId } from '../db.js';
import { ah, parse, HttpError, audit, today, money } from '../util.js';
import { requireRole } from '../auth.js';
import { toCad } from '../fx.js';

export const STOCK_CATEGORIES = ['Finished goods', 'Samples', 'Materials & trims', 'Packaging', 'Other'];
const MAX_PHOTOS = 8;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

const r = Router();
const SELECT = `SELECT s.*, sp.name AS supplier_name,
  COALESCE((SELECT json_agg(p.id ORDER BY p.created_at) FROM stock_photos p WHERE p.item_id = s.id), '[]') AS photo_ids
  FROM stock_items s LEFT JOIN suppliers sp ON sp.id = s.supplier_id`;

r.get('/', ah(async (_req, res) => {
  res.json({ items: await q(`${SELECT} ORDER BY s.updated_at DESC`), categories: STOCK_CATEGORIES });
}));

const body = z.object({
  name: z.string().trim().min(1, 'Give the item a name.').max(160),
  category: z.enum(STOCK_CATEGORIES).default('Finished goods'),
  size: z.string().trim().max(40).default(''),
  colour: z.string().trim().max(60).default(''),
  quantity: z.number().int().min(0).max(1_000_000).default(0),
  priceCents: z.number().int().nonnegative().max(1e10).nullable().default(null),
  currency: z.enum(['CAD', 'USD']).default('CAD'),
  priceKind: z.enum(['COST', 'RETAIL']).default('COST'),
  supplierId: z.string().nullable().default(null),
  sku: z.string().trim().max(60).default(''),
  notes: z.string().max(2000).default(''),
});

// USD prices are converted to CAD at the Bank of Canada rate on the day they're saved.
async function priceCols(b, prev) {
  if (b.priceCents == null) return { cad: null, rate: null };
  if (b.currency === 'CAD') return { cad: b.priceCents, rate: null };
  if (prev && prev.priceCents === b.priceCents && prev.currency === b.currency && prev.priceCadCents != null) {
    return { cad: prev.priceCadCents, rate: prev.fxRate };
  }
  const fx = await toCad(b.priceCents, b.currency, today());
  return { cad: fx.cadCents, rate: fx.rate };
}
async function checkSupplier(id) {
  if (id && !(await one('SELECT id FROM suppliers WHERE id = $1', [id]))) throw new HttpError(400, 'That supplier no longer exists.');
}
const label = (s) => [s.name, s.size, s.colour].filter(Boolean).join(' · ');

r.post('/', requireRole('EDITOR'), ah(async (req, res) => {
  const b = parse(body, req.body);
  await checkSupplier(b.supplierId);
  const p = await priceCols(b);
  const id = newId();
  await q(
    `INSERT INTO stock_items (id, name, category, size, colour, quantity, price_cents, currency, price_cad_cents, fx_rate, price_kind, supplier_id, sku, notes, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, b.name, b.category, b.size, b.colour, b.quantity, b.priceCents, b.currency, p.cad, p.rate, b.priceKind, b.supplierId, b.sku, b.notes, req.user.id],
  );
  await audit(req.user.id, 'create', 'stock', id, `Added ${b.quantity} × ${label(b)} to inventory`);
  res.status(201).json({ item: await one(`${SELECT} WHERE s.id = $1`, [id]) });
}));

r.patch('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const prev = await one('SELECT * FROM stock_items WHERE id = $1', [req.params.id]);
  if (!prev) throw new HttpError(404, 'Item not found.');
  const b = parse(body.partial(), req.body);
  const next = {
    name: b.name ?? prev.name, category: b.category ?? prev.category, size: b.size ?? prev.size, colour: b.colour ?? prev.colour,
    quantity: b.quantity ?? prev.quantity, priceCents: b.priceCents !== undefined ? b.priceCents : prev.priceCents,
    currency: b.currency ?? prev.currency, priceKind: b.priceKind ?? prev.priceKind,
    supplierId: b.supplierId !== undefined ? b.supplierId : prev.supplierId, sku: b.sku ?? prev.sku, notes: b.notes ?? prev.notes,
  };
  await checkSupplier(next.supplierId);
  const p = await priceCols(next, prev);
  await q(
    `UPDATE stock_items SET name=$2, category=$3, size=$4, colour=$5, quantity=$6, price_cents=$7, currency=$8, price_cad_cents=$9, fx_rate=$10,
       price_kind=$11, supplier_id=$12, sku=$13, notes=$14, updated_at=now() WHERE id=$1`,
    [prev.id, next.name, next.category, next.size, next.colour, next.quantity, next.priceCents, next.currency, p.cad, p.rate, next.priceKind, next.supplierId, next.sku, next.notes],
  );
  const qtyOnly = Object.keys(req.body).length === 1 && b.quantity !== undefined;
  await audit(req.user.id, 'update', 'stock', prev.id,
    qtyOnly ? `${label(next)}: quantity ${prev.quantity} → ${next.quantity}` : `Updated ${label(next)}${next.priceCents != null ? ` (${money(p.cad)})` : ''}`);
  res.json({ item: await one(`${SELECT} WHERE s.id = $1`, [prev.id]) });
}));

r.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const item = await one('DELETE FROM stock_items WHERE id = $1 RETURNING *', [req.params.id]);
  if (!item) throw new HttpError(404, 'Item not found.');
  await audit(req.user.id, 'delete', 'stock', item.id, `Removed ${label(item)} from inventory`);
  res.json({ ok: true });
}));

// Photos live in Postgres, like receipts, so there's no separate file service.
r.post('/:id/photos', requireRole('EDITOR'), upload.single('file'), ah(async (req, res) => {
  const item = await one('SELECT id, name FROM stock_items WHERE id = $1', [req.params.id]);
  if (!item) throw new HttpError(404, 'Item not found.');
  const f = req.file;
  if (!f) throw new HttpError(400, 'No photo was attached.');
  if (!PHOTO_TYPES.includes(f.mimetype)) throw new HttpError(400, 'Photos must be JPG, PNG, WebP or HEIC.');
  if ((await one('SELECT count(*)::int AS n FROM stock_photos WHERE item_id = $1', [item.id])).n >= MAX_PHOTOS) throw new HttpError(400, `An item can have at most ${MAX_PHOTOS} photos.`);
  const photo = await one(
    `INSERT INTO stock_photos (id, item_id, filename, mime_type, size, data, uploaded_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [newId(), item.id, f.originalname.slice(0, 200) || 'photo.jpg', f.mimetype, f.size, f.buffer, req.user.id],
  );
  await q('UPDATE stock_items SET updated_at = now() WHERE id = $1', [item.id]);
  res.status(201).json({ photo });
}));

export const stockPhotos = Router();
stockPhotos.get('/:id', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT mime_type, data FROM stock_photos WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Photo not found.');
  res.set('Content-Type', rows[0].mime_type);
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(rows[0].data);
}));
stockPhotos.delete('/:id', requireRole('EDITOR'), ah(async (req, res) => {
  const p = await one('DELETE FROM stock_photos WHERE id = $1 RETURNING id', [req.params.id]);
  if (!p) throw new HttpError(404, 'Photo not found.');
  res.json({ ok: true });
}));

export default r;
