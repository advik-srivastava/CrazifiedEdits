"use client";
import { useCallback, useState } from "react";
import { useFormStatus } from "react-dom";

export type ButtonVariant = "primary" | "secondary" | "subtle" | "danger";
/** Submit button that shows a pending label and disables itself while its form's server action runs. */
export function SubmitButton({ children, variant = "primary", pendingLabel = "Saving…", className = "" }: { children: React.ReactNode; variant?: ButtonVariant; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={`button ${variant} ${className}`.trim()} type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingLabel : children}</button>;
}
/** onSubmit handler that asks for confirmation first. */
export const confirmSubmit = (message: string) => (e: React.FormEvent<HTMLFormElement>) => { if (!confirm(message)) e.preventDefault(); };
/**
 * Track which collapsible rows are open, so their (heavy) edit forms are only rendered when needed.
 * Keeps the admin page light even with hundreds of reels, payments and invoices.
 */
export function useOpenRows() {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = e.currentTarget.open;
    setOpen(prev => { if (prev.has(id) === isOpen) return prev; const next = new Set(prev); if (isOpen) next.add(id); else next.delete(id); return next; });
  }, []);
  return { isOpen: (id: string) => open.has(id), toggle };
}
