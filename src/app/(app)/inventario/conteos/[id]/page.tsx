import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExportMenu } from "@/components/export-menu";
import { Badge, Card, CardHeader, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { cn, formatDateTime, formatMoney, formatQty } from "@/lib/utils";
import { ApplyCountButton } from "@/modules/inventario/components/mobile-count";

export const metadata: Metadata = { title: "Inventario desde RLS Tools" };

type Line = { product_id: string; counted: number; system_qty: number | null; unit_cost: number | null; product: { name: string; sku: string; unit: string } | null; location: { code: string } | null };

/** Detalle de un inventario del celular: contado vs. ERP, valorizado, y aplicación al stock. */
export default async function MobileCountPage({ params }: PageProps<"/inventario/conteos/[id]">) {
  const { id } = await params;
  const { supabase, settings, can } = await requireAccess("inventario", "view");
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const [sessionRes, linesRes, unknownRes] = await Promise.all([
    supabase
      .from("count_sessions")
      .select("id, number, name, zone, blind, status, note, created_at, closed_at, applied_at, void_reason, creator:profiles!count_sessions_created_by_fkey(full_name), applier:profiles!count_sessions_applied_by_fkey(full_name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("count_lines").select("product_id, counted, system_qty, unit_cost, product:products(name, sku, unit), location:warehouse_locations(code)").eq("session_id", id),
    supabase.from("count_unknown_codes").select("code, quantity").eq("session_id", id),
  ]);
  const s = sessionRes.data as unknown as
    | { id: string; number: string; name: string; zone: string; blind: boolean; status: string; note: string; created_at: string; closed_at: string | null; applied_at: string | null; void_reason: string | null; creator: { full_name: string } | null; applier: { full_name: string } | null }
    | null;
  if (!s) notFound();

  const byProduct = new Map<string, { name: string; sku: string; unit: string; counted: number; system: number | null; cost: number; locations: Set<string> }>();
  for (const l of (linesRes.data ?? []) as unknown as Line[]) {
    const r = byProduct.get(l.product_id) ?? { name: l.product?.name ?? "—", sku: l.product?.sku ?? "", unit: l.product?.unit ?? "", counted: 0, system: l.system_qty === null ? null : Number(l.system_qty), cost: Number(l.unit_cost ?? 0), locations: new Set<string>() };
    r.counted += Number(l.counted);
    if (l.location?.code) r.locations.add(l.location.code);
    byProduct.set(l.product_id, r);
  }
  const rows = [...byProduct.values()]
    .map((r) => ({ ...r, diff: r.system === null ? null : r.counted - r.system, value: r.system === null ? null : (r.counted - r.system) * r.cost }))
    .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
  const closed = s.status === "cerrada" || s.status === "aplicada";
  const value = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const adjustments = rows.filter((r) => (r.diff ?? 0) !== 0).length;
  const unknown = (unknownRes.data ?? []) as { code: string; quantity: number }[];

  return (
    <>
      <PageHeader title={`Inventario ${s.number}`} description={`${s.name} · ${s.zone || "Toda la sucursal"} · contó ${s.creator?.full_name ?? "—"} el ${formatDateTime(s.created_at, settings.timezone)}`}>
        <ExportMenu
          title={`Inventario ${s.number}`}
          subtitle={s.name}
          filename={`inventario_${s.number}`}
          columns={[
            { key: "sku", header: "SKU" },
            { key: "producto", header: "Producto", width: 34 },
            { key: "ubicacion", header: "Ubicación" },
            { key: "contado", header: "Contado", type: "number", total: true },
            { key: "erp", header: "Stock ERP", type: "number", total: true },
            { key: "diferencia", header: "Diferencia", type: "number", total: true },
            { key: "valor", header: "Diferencia valorizada", type: "money", total: true },
          ]}
          rows={rows.map((r) => ({ sku: r.sku, producto: r.name, ubicacion: [...r.locations].join(", "), contado: r.counted, erp: r.system, diferencia: r.diff, valor: r.value }))}
        />
        {s.status === "cerrada" && can("inventario", "edit") && <ApplyCountButton sessionId={s.id} number={s.number} adjustments={adjustments} />}
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Productos contados" value={String(rows.length)} />
        <StatCard label="Faltantes" value={closed ? String(rows.filter((r) => (r.diff ?? 0) < 0).length) : "—"} tone="red" />
        <StatCard label="Sobrantes" value={closed ? String(rows.filter((r) => (r.diff ?? 0) > 0).length) : "—"} tone="amber" />
        <StatCard label="Diferencia valorizada" value={closed ? money(value) : "—"} tone={value < 0 ? "red" : "green"} hint={s.status === "aplicada" ? `Aplicado por ${s.applier?.full_name ?? "—"}` : undefined} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Contado vs. ERP"
          description={!closed ? "El inventario sigue abierto en el celular: el stock del ERP se compara al cerrarlo." : s.status === "aplicada" ? "Ajustes ya registrados en el kardex." : "Al aplicar, cada diferencia se registra como ajuste."}
          action={<Badge tone={s.status === "aplicada" ? "green" : s.status === "cerrada" ? "amber" : "blue"}>{s.status}</Badge>}
        />
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th>Ubicación</Th>
              <Th className="text-right">Contado</Th>
              <Th className="text-right">ERP</Th>
              <Th className="text-right">Diferencia</Th>
              <Th className="text-right">Valorizado</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku + r.name}>
                <Td>
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="tabular text-xs text-slate-500">{r.sku}</p>
                </Td>
                <Td className="text-slate-500">{[...r.locations].join(", ") || "—"}</Td>
                <Td className="tabular text-right">
                  {formatQty(r.counted)} <span className="text-xs text-slate-400">{r.unit}</span>
                </Td>
                <Td className="tabular text-right">{r.system === null ? "—" : formatQty(r.system)}</Td>
                <Td className={cn("tabular text-right font-semibold", (r.diff ?? 0) < 0 ? "text-red-600" : (r.diff ?? 0) > 0 ? "text-amber-700" : "text-emerald-700")}>
                  {r.diff === null ? "—" : r.diff === 0 ? "Cuadra" : `${r.diff > 0 ? "+" : ""}${formatQty(r.diff)}`}
                </Td>
                <Td className="tabular text-right">{r.value === null ? "—" : money(r.value)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {unknown.length > 0 && (
        <Card>
          <CardHeader title="Códigos escaneados que no existen en el ERP" description="Dalos de alta como producto y vuelve a contarlos." />
          <Table>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th className="text-right">Cantidad</Th>
              </tr>
            </thead>
            <tbody>
              {unknown.map((u) => (
                <tr key={u.code}>
                  <Td className="font-mono">{u.code}</Td>
                  <Td className="tabular text-right">{formatQty(u.quantity)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
