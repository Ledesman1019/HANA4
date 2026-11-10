import type { ReactNode } from "react";
import { Store } from "lucide-react";

export function AuthCard({ title, description, children, wide }: { title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink bg-[radial-gradient(ellipse_at_top,rgba(37,84,235,0.28),transparent_60%)] px-4 py-10">
      <div className={`w-full ${wide ? "max-w-xl" : "max-w-sm"}`}>
        <div className="mb-6 flex items-center justify-center gap-2.5 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600">
            <Store className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">ERP HANA4</span>
        </div>
        <div className="rounded-2xl bg-surface p-6 shadow-2xl sm:p-8">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
