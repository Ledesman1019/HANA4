import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, PackageX, Truck } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { computeAlerts } from "@/shell/alerts";

export const metadata: Metadata = { title: "Mensajes de tienda" };

const ICONS = { red: PackageX, amber: AlertTriangle, blue: Truck };
const TONES = { red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-600", blue: "bg-brand-50 text-link" };
const LABELS = { red: "Urgente", amber: "Atención", blue: "Pendiente" };

/** Avisos operativos de la sucursal (los mismos de la campana), con acceso directo a resolverlos. */
export default async function MessagesPage() {
  const ctx = await getContext();
  const items = await computeAlerts(ctx);
  const order = { red: 0, amber: 1, blue: 2 };
  items.sort((a, b) => order[a.tone] - order[b.tone]);

  return (
    <>
      <PageHeader title="Mensajes de tienda" description={`Lo que requiere atención en ${ctx.branch.name}. Se actualiza en cada visita.`} />
      {items.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="mt-3 text-base font-semibold text-slate-900">Todo en orden</p>
          <p className="mt-1 text-sm text-slate-500">No hay stock agotado, cobros vencidos ni pendientes que atender.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-slate-100">
          {items.map((a) => {
            const Icon = ICONS[a.tone];
            return (
              <Link key={a.id} href={a.href} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50">
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", TONES[a.tone])}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{a.title}</span>
                  <span className="block text-sm text-slate-500">{a.detail}</span>
                </span>
                <span className={cn("hidden rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline", TONES[a.tone])}>{LABELS[a.tone]}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            );
          })}
        </Card>
      )}
    </>
  );
}
