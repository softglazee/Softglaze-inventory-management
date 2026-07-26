/**
 * Shared UI primitives — SoftGlaze design system (docs/06-UI-DESIGN-SYSTEM.md).
 * Toasts, Modal, ConfirmDialog, EmptyState, PageHeader, Badge, SearchBox,
 * TableSkeleton, Pagination. Amber stays reserved for money-critical actions.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, X, Search, PackageOpen, ChevronLeft, ChevronRight, House } from "lucide-react";

/* ───────────────────────── Toasts ───────────────────────── */

type Toast = { id: number; tone: "success" | "error"; message: string };
const ToastContext = createContext<{ toast: (message: string, tone?: Toast["tone"]) => void }>({
  toast: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = ++idRef.current;
    setToasts((list) => [...list, { id, tone, message }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] space-y-2.5 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="card p-3.5 flex items-start gap-3 !shadow-[var(--shadow-md)] animate-[slideIn_.22s_cubic-bezier(.2,.8,.2,1)]"
          >
            <span className={`shrink-0 grid place-items-center w-7 h-7 rounded-lg ${t.tone === "success" ? "bg-success/12 text-success" : "bg-danger/12 text-danger"}`}>
              {t.tone === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            </span>
            <p className="text-sm flex-1 leading-snug pt-0.5">{t.message}</p>
            <button
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              className="text-faint hover:text-ink transition-colors"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ───────────────────────── Modal ───────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm animate-[popIn_.12s_ease]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`card w-full ${wide ? "max-w-2xl" : "max-w-md"} !rounded-[10px] !shadow-[var(--shadow-lg)] max-h-[90vh] flex flex-col animate-[popIn_.16s_cubic-bezier(.2,.8,.2,1)]`}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-edge shrink-0">
          <h2 className="font-bold display text-base">{title}</h2>
          <button onClick={onClose} className="btn btn-ghost !p-1.5 -mr-1.5" aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── ConfirmDialog ───────────────────────── */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────────────── Page & list furniture ───────────────────────── */

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6 pb-4 border-b border-edge">
      <div className="min-w-0">
        <nav className="flex items-center gap-1.5 text-xs text-faint mb-1.5">
          <Link to="/" className="inline-flex items-center gap-1 hover:text-accent"><House size={12} /> Dashboard</Link>
          <ChevronRight size={12} />
          <span className="text-muted font-semibold">{title}</span>
        </nav>
        <h1 className="text-[22px] font-extrabold display tracking-tight">{title}</h1>
        {sub && <p className="text-muted text-sm mt-1 max-w-2xl">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/** Titled section panel for add/edit forms. */
export function FormSection({ title, icon: Icon, color = "var(--accent)", children }: { title: string; icon: any; color?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-surface-2 border-b border-edge">
        <span className="w-6 h-6 rounded-md grid place-items-center" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}><Icon size={13} /></span>
        <h3 className="font-bold text-[13px]">{title}</h3>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        className="input !pl-9 w-64 max-w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-16 px-4">
      <div className="mx-auto w-16 h-16 rounded-[10px] tile-grad text-white flex items-center justify-center mb-4">
        <PackageOpen size={26} />
      </div>
      <p className="font-semibold text-[15px]">{title}</p>
      {hint && <p className="text-muted text-sm mt-1 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-3 space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-8 rounded bg-surface-2 animate-pulse" style={{ flex: c === 1 ? 2 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "success" | "warn" | "danger" | "muted"; children: ReactNode }) {
  const styles = {
    success: "text-success border-success/30 bg-success/10",
    warn: "text-warn border-warn/30 bg-warn/10",
    danger: "text-danger border-danger/30 bg-danger/10",
    muted: "text-muted border-edge bg-surface-2",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${styles}`}>
      {children}
    </span>
  );
}

export function Pagination({
  page,
  pages,
  onPage,
  total,
  perPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
  /** Optional — when both are given, a "Showing X–Y of N" summary is shown on the left. */
  total?: number;
  perPage?: number;
}) {
  const hasRange = total != null && perPage != null;
  // Nothing useful to show: single page and no range summary requested.
  if (pages <= 1 && !hasRange) return null;
  const from = hasRange ? (total! === 0 ? 0 : (page - 1) * perPage! + 1) : 0;
  const to = hasRange ? Math.min(page * perPage!, total!) : 0;
  return (
    <div className="flex items-center justify-between gap-2 p-3 border-t border-edge text-sm">
      <span className="text-muted tabular-nums text-xs">
        {hasRange ? (
          <>Showing <span className="text-ink font-semibold">{from}–{to}</span> of {total}</>
        ) : (
          <>&nbsp;</>
        )}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost !p-1.5"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-muted tabular-nums">
            Page <span className="text-ink font-semibold">{page}</span> of {pages}
          </span>
          <button
            className="btn btn-ghost !p-1.5"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Client-side pagination for full-list tables (endpoints that return every row).
 * Returns the current page's slice plus the props to feed <Pagination/>.
 * Auto-clamps the page when the underlying list shrinks (e.g. after a filter).
 */
export function useClientPagination<T>(rows: T[], perPage = 12) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const pageRows = rows.slice((page - 1) * perPage, page * perPage);
  return { page, pages, setPage, pageRows, total: rows.length, perPage };
}
