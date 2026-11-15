import { useBooks } from '../lib/store';
import { dayLabel, fmt } from '../lib/format';
import type { Txn } from '../lib/types';

const SOURCE: Record<string, string> = { RECURRING: 'Auto', INVOICE: 'Invoice', SHOPIFY: 'Shopify', IMPORT: 'Import' };

export default function TxnTable({ rows, onPick, compact }: { rows: Txn[]; onPick?: (t: Txn) => void; compact?: boolean }) {
  const { runs } = useBooks();
  const runName = (id: string | null) => (id ? runs.find((r) => r.id === id)?.name : '');
  return (
    <div className="tablewrap">
      <table>
        {!compact && <thead><tr><th>Date</th><th>Vendor / customer</th><th className="hide-sm">Category</th><th className="amt">Amount</th><th className="hide-sm">Source</th></tr></thead>}
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={onPick ? 'click' : ''} onClick={onPick ? () => onPick(t) : undefined}
              tabIndex={onPick ? 0 : undefined} onKeyDown={onPick ? (e) => e.key === 'Enter' && onPick(t) : undefined}>
              <td style={{ whiteSpace: 'nowrap' }}>{dayLabel(t.date)}</td>
              <td>
                {t.party || 'Untitled'}
                {t.receipts.length > 0 && <span className="chip">{t.receipts.length === 1 ? 'Receipt' : `${t.receipts.length} receipts`}</span>}
                <span className="sub">{[t.description, runName(t.runId) && `Run: ${runName(t.runId)}`].filter(Boolean).join(' · ')}</span>
                <span className="sub show-sm">{t.category}</span>
              </td>
              <td className="hide-sm">{t.category}{t.line !== 'Shared' && <span className="chip">{t.line}</span>}</td>
              <td className={`amt ${t.type === 'INCOME' ? 'pos' : ''}`}>{t.type === 'INCOME' ? '+' : '−'}{fmt(t.amountCents)}</td>
              <td className="sub hide-sm">{SOURCE[t.source] || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
