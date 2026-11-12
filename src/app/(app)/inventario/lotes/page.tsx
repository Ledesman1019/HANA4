import type { Metadata } from "next";
import { CalendarClock, CalendarX2, Layers, PackageCheck } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, Select, StatCard, Table, Td, Th, type BadgeTone } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { addDays, formatDate, formatMoney, formatQty, todayIn } from "@/lib/utils";
import { LotEditor } from "@/modules/inventario/components/lot-editor";

export const metadata: Metadata = { title: "Lotes y vencimientos" };

type Lot = { id: string; lot_number: string; expiry_date: string | null; quantity: number; product: { name: string; sku: string; unit: string; cost: number } | null };

const FILTERS: Record<string, string> = { proximos: "Vencidos y por vencer (60 días)", vencidos: "Vencidos", todos: "Todos con stock" };

export default async function LotsPage({ searchParams }: PageProps<"/inventario/lotes">) {
  const { supabase, settings, branch, can } = await requireAccess("inventario", "view");
  const sp = await searchParams;
  const filter = Object.hasOwn(FILTERS, param(sp.estado)) ? param(sp.estado) : "proximos";
  const today = todayIn(settings.timezone);
  const soon = addDays(today, 30);
  const showCosts = can("inventario", "edit") || can("compras", "view") || can("finanzas", "view");

  const lots = await fetchAll<Lot>((a, b) =>
    supabase
      .from("lots")
      .select("id, lot_number, expiry_date, quantity, product:products(name, sku, unit, cost)")
      .eq("branch_id", branch.id)
      .gt("quantity", 0)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .order("id")
      .range(a, b),
  );

  const status = (l: Lot): { label: string; tone: BadgeTone; days: number | null } => {
    if (!l.expiry_date) return { label: "Sin fecha", tone: "neutral", days: null };
    const days = Math.round((Date.parse(l.expiry_date) - Date.parse(today)) / 86_400_000);
    if (days < 0) return { label: "Vencido", tone: "red", days };
    if (days <= 30) return { label: "Por vencer", tone: "amber", days };
    return { label: "Vigente", tone: "green", days };
  };

  const expired = lots.filter((l) => l.expiry_date && l.expiry_date < today);
  const expiring = lots.filter((l) => l.expiry_date && l.expiry_date >= today && l.expiry_date <= soon);
  const value = (rows: Lot[]) => rows.reduce((s, l) => s + Number(l.quantity) * Number(l.product?.cost ?? 0), 0);
  const rows = filter === "vencidos" ? expired : filter === "proximos" ? lots.filter((l) => l.expiry_date && l.expiry_date <= addDays(today, 60)) : lots;
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Lotes con stock" value={String(lots.length)} icon={<Layers className="h-4 w-4" />} />
        <StatCard
          label="Vencidos"
          value={String(expired.length)}
          icon={<CalendarX2 className="h-4 w-4" />}
          tone="red"
          hint={expired.length ? (showCosts ? `${money(value(expired))} al costo: retíralos con un ajuste` : "Retíralos con un ajuste de stock") : "Ninguno"}
        />
        <StatCard label="Vencen en 30 días" value={String(expiring.length)} icon={<CalendarClock className="h-4 w-4" />} tone="amber" hint={showCosts && expiring.length ? `${money(value(expiring))} al costo` : undefined} />
        <StatCard label="Salida" value="FEFO" icon={<PackageCheck className="h-4 w-4" />} tone="slate" hint="Se vende primero lo que vence antes" />
      </div>

      <div className="mb-3 flex justify-end">
        <ExportMenu
          title="Lotes y vencimientos"
          subtitle={`${branch.name} · ${FILTERS[filter]} · al ${formatDate(today)}`}
          filename={`lotes_${today}`}
          columns={[
            { key: "sku", header: "SKU" },
            { key: "producto", header: "Producto", width: 32 },
            { key: "lote", header: "Lote" },
            { key: "vence", header: "Vencimiento", type: "date" },
            { key: "estado", header: "Estado" },
            { key: "cantidad", header: "Cantidad", type: "number", total: true },
          ]}
          rows={rows.map((l) => ({ sku: l.product?.sku, producto: l.product?.name, lote: l.lot_number, vence: l.expiry_date, estado: status(l).label, cantidad: Number(l.quantity) }))}
        />
      </div>

      <Card>
        <FilterBar action="/inventario/lotes">
          <Field label="Mostrar">
            <Select name="estado" defaultValue={filter}>
              {Object.entries(FILTERS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title={lots.length === 0 ? "Ningún producto controla lotes todavía" : "Nada que mostrar con este filtro"}
            description={
              lots.length === 0
                ? "En Inventario, edita un producto perecible y elige «Controla lote y fecha de vencimiento». Desde entonces, cada recepción pide el lote y las ventas salen por FEFO."
                : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Lote</Th>
                <Th>Vencimiento</Th>
                <Th className="text-right">Cantidad</Th>
                <Th>Estado</Th>
                {can("inventario", "edit") && <Th className="w-px" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const s = status(l);
                return (
                  <tr key={l.id} className="transition-colors hover:bg-slate-50/70">
                    <Td>
                      <p className="font-medium text-slate-900">{l.product?.name}</p>
                      <p className="tabular text-xs text-slate-500">{l.product?.sku}</p>
                    </Td>
                    <Td className="tabular font-mono text-sm">{l.lot_number}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {formatDate(l.expiry_date)}
                      {s.days !== null && (
                        <p className={`text-xs ${s.days < 0 ? "font-medium text-red-600" : s.days <= 30 ? "text-amber-700" : "text-slate-500"}`}>
                          {s.days < 0 ? `venció hace ${-s.days} días` : s.days === 0 ? "vence hoy" : `en ${s.days} días`}
                        </p>
                      )}
                    </Td>
                    <Td className="tabular text-right font-medium text-slate-900">
                      {formatQty(l.quantity)} <span className="text-xs font-normal text-slate-500">{l.product?.unit}</span>
                    </Td>
                    <Td>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </Td>
                    {can("inventario", "edit") && (
                      <Td className="text-right">
                        <LotEditor lotId={l.id} lotNumber={l.lot_number} expiry={l.expiry_date} product={l.product?.name ?? ""} />
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
