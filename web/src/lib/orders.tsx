import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { OrderStage, OrderSummary } from './types';

export const STAGES: [OrderStage, string][] = [['TODO', 'To pack'], ['PACKING', 'Packing'], ['PACKED', 'Packed']];
export const STAGE_LABEL = Object.fromEntries(STAGES) as Record<OrderStage, string>;
export const STAGE_PILL: Record<OrderStage, string> = { TODO: 'warn', PACKING: 'accent', PACKED: 'good' };

/** "3h ago", "2 days ago" */
export function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
export const isLate = (iso: string) => Date.now() - Date.parse(iso) > 3 * 864e5;

const Ctx = createContext<{ summary: OrderSummary | null; refresh: () => Promise<void> }>({ summary: null, refresh: async () => {} });
export const useOrderSummary = () => useContext(Ctx);

// Orders waiting to be fulfilled, for the sidebar badge and the dashboard. Checks every two minutes.
export function OrderSummaryProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const refresh = useCallback(async () => {
    try { setSummary(await api<OrderSummary>('/orders/summary')); } catch { /* badge is optional */ }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 120_000);
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh]);
  return <Ctx.Provider value={{ summary, refresh }}>{children}</Ctx.Provider>;
}
