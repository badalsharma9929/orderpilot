import React from 'react';
import type { OrderStatus } from '@/core/status';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 h-8 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand/90',
        variant === 'ghost' && 'border border-line bg-surface hover:bg-raised text-ink',
        variant === 'danger' && 'border border-bad/40 text-bad hover:bg-bad/10',
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cx('rounded-xl border border-line bg-surface', className)}>{children}</section>;
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {aside}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-muted">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls = 'w-full h-9 rounded-lg border border-line bg-raised px-2.5 text-[13px] text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none';

const STATUS_TONE: Record<OrderStatus, string> = {
  Ordered: 'text-muted bg-line/60',
  Packed: 'text-muted bg-line/60',
  Shipped: 'text-brand bg-brand/10',
  'In transit': 'text-brand bg-brand/10',
  'Out for delivery': 'text-info bg-info/12',
  Delivered: 'text-good bg-good/12',
  Cancelled: 'text-bad bg-bad/10',
  Returned: 'text-warn bg-warn/15',
  Delayed: 'text-warn bg-warn/15',
  Unknown: 'text-muted bg-line/60',
};

export function StatusChip({ status }: { status: OrderStatus }) {
  return <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', STATUS_TONE[status])}>{status}</span>;
}

export function PlatformTag({ platform }: { platform: string }) {
  const label = { amazon: 'Amazon', flipkart: 'Flipkart', jiomart: 'JioMart' }[platform] ?? platform;
  return <span className="text-[11px] font-medium text-muted">{label}</span>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div role="status" className="px-6 py-10 text-center">
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="mt-1 text-[12px] text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Shows ISO timestamps from the sites as "4 Oct, 12:57 pm"; leaves human text ("Tuesday") as is. */
export const pretty = (s?: string) => {
  if (!s) return '—';
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export { cx };
