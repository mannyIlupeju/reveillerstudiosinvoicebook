import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

type Props = {
  title: string;
  onClose: () => void;
  onSubmit?: () => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  deleteLabel?: string;
  submitLabel?: string;
  wide?: boolean;
  children: ReactNode;
  footerExtra?: ReactNode;
};

// Native <dialog> with a form inside. Errors thrown by onSubmit/onDelete are shown inline.
export default function Modal({ title, onClose, onSubmit, onDelete, deleteLabel = 'Delete', submitLabel = 'Save', wide, children, footerExtra }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const close = () => onClose();
    d.addEventListener('close', close);
    return () => d.removeEventListener('close', close);
  }, [onClose]);

  const run = async (fn?: () => Promise<void> | void) => {
    if (!fn) return;
    setErr('');
    setBusy(true);
    try {
      await fn();
      ref.current?.close();
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); run(onSubmit); };

  return (
    <dialog ref={ref} className={wide ? 'wide' : ''}>
      <form onSubmit={submit} noValidate>
        <div className="mh">
          <h2>{title}</h2>
          <button type="button" className="btn small" onClick={() => ref.current?.close()}>Close</button>
        </div>
        <div className="mb">
          {children}
          {err && <p className="err" role="alert">{err}</p>}
        </div>
        <div className="mf">
          <span className="row">
            {onDelete && (
              <button type="button" className={`btn danger ${armed ? 'armed' : ''}`} disabled={busy}
                onClick={() => (armed ? run(onDelete) : setArmed(true))}>
                {armed ? 'Click again to confirm' : deleteLabel}
              </button>
            )}
            {footerExtra}
          </span>
          <span className="row">
            <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
            {onSubmit && <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>}
          </span>
        </div>
      </form>
    </dialog>
  );
}
