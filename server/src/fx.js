// Foreign exchange to CAD using the Bank of Canada's daily rates (Valet API, no key needed).
// Rates are published for business days, so a weekend or holiday uses the latest earlier rate.
import { q, one } from './db.js';
import { HttpError, DATE_RE, today } from './util.js';

export const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'CNY'];

const shift = (d, days) => {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + days));
  return t.toISOString().slice(0, 10);
};

/** Returns { rate, date } where 1 unit of `currency` = rate CAD on (or just before) `date`. */
export async function rateFor(currency, date) {
  currency = String(currency || '').toUpperCase();
  if (currency === 'CAD') return { rate: 1, date };
  if (!CURRENCIES.includes(currency)) throw new HttpError(400, `${currency} isn’t supported. Use ${CURRENCIES.join(', ')}.`);
  let d = DATE_RE.test(date || '') ? date : today();
  if (d > today()) d = today();

  const cached = await one('SELECT rate, date FROM fx_rates WHERE currency = $1 AND date <= $2 AND date >= $3 ORDER BY date DESC LIMIT 1', [currency, d, shift(d, -7)]);
  // Use the cache when it has this date, or when only weekend days sit between it and this date.
  if (cached && (await hasGapCovered(currency, cached.date, d))) return { rate: Number(cached.rate), date: cached.date };

  const series = `FX${currency}CAD`;
  const url = `https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${shift(d, -10)}&end_date=${d}`;
  let body;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    body = await res.json();
  } catch (e) {
    if (cached) return { rate: Number(cached.rate), date: cached.date };
    throw new HttpError(502, `Couldn’t get the ${currency} exchange rate from the Bank of Canada (${e.message}). Enter the CAD amount yourself.`);
  }
  const obs = (body.observations || []).map((o) => ({ date: o.d, rate: Number(o[series]?.v) })).filter((o) => o.rate > 0);
  for (const o of obs) {
    await q('INSERT INTO fx_rates (currency, date, rate) VALUES ($1,$2,$3) ON CONFLICT (currency, date) DO NOTHING', [currency, o.date, o.rate]);
  }
  const best = obs.filter((o) => o.date <= d).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!best) throw new HttpError(502, `The Bank of Canada has no ${currency} rate near ${d}. Enter the CAD amount yourself.`);
  return { rate: best.rate, date: best.date };
}

// True when every day after `from` up to `to` is a weekend (no rate is ever published then).
async function hasGapCovered(_currency, from, to) {
  if (from === to) return true;
  // Weekends never have rates; if every day between is a weekend, the cached rate is the right one.
  let d = shift(from, 1);
  while (d <= to) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) return false;
    d = shift(d, 1);
  }
  return true;
}

/** Converts a foreign amount in cents to CAD cents. */
export async function toCad(amountCents, currency, date) {
  const { rate, date: rateDate } = await rateFor(currency, date);
  return { cadCents: Math.round(amountCents * rate), rate, rateDate };
}
