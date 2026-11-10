import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------- Botón ---------- */
const buttonVariants = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-surface text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-danger text-white hover:bg-danger-hover shadow-sm",
  success: "bg-ok text-white hover:bg-ok-hover shadow-sm",
};
const buttonSizes = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
  icon: "h-8 w-8",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  loading?: boolean;
};

export function buttonClass(variant: keyof typeof buttonVariants = "primary", size: keyof typeof buttonSizes = "md") {
  return cn(
    "inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
    "disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
    buttonVariants[variant],
    buttonSizes[size],
  );
}

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonClass(variant, size), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Formularios ---------- */
const controlClass =
  "block w-full rounded-lg border border-slate-300 bg-surface px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 " +
  "focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClass, "h-9", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(controlClass, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "py-2", className)} rows={3} {...props} />;
}

export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

/* ---------- Superficies ---------- */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-slate-200 bg-surface shadow-xs", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* ---------- Badge ---------- */
const badgeTones = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-brand-50 text-link ring-brand-200",
};
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", badgeTones[tone])}>
      {children}
    </span>
  );
}

/* ---------- Tabla ---------- */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap", className)}
      {...props}
    />
  );
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-slate-100 px-4 py-2.5 text-slate-700", className)} {...props} />;
}

/* ---------- Estados ---------- */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon}</div>}
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200/70", className)} />;
}

export function StatCard({ label, value, hint, icon, tone = "blue" }: { label: string; value: string; hint?: ReactNode; icon?: ReactNode; tone?: "blue" | "green" | "amber" | "red" | "slate" }) {
  const tones = {
    blue: "bg-brand-50 text-link",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="tabular mt-1.5 truncate text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        {icon && <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tones[tone])}>{icon}</div>}
      </div>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}
