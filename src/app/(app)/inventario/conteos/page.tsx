import type { Metadata } from "next";
import Link from "next/link";
import { Smartphone } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Inventarios desde RLS Tools" };

const STATUS: Record<string, { label: string; tone: "blue" | "amber" | "green" | "neutral" }> = {
  abierta: { label: "Contando", tone: "blue" },
  cerrada: { label: "Por aplicar", tone: "amber" },
  aplicada: { label: "Aplicado", tone: "green" },
  anulada: { label: "Anulado", tone: "neutral" },
};

type Session = { id: string; number: string; name: string; zone: string; status: string; created_at: string; creator: { full_name: string } | null };
type Line = { session_id: string; product_id: string; counted: number; system_qty: number | null; unit_cost: number | null };

/** Inventarios físicos contados en el celular (RLS Tools) en la sucursal activa. */
export default async function MobileCountsPage({ searchParams }: PageProps<"/inventario/conteos">) {
  const { supabase, branch, settings } = await requireAccess("inventario", "view");
  const sp = await searchParams;
  const status = Object.hasOwn(STATUS, param(sp.estado)) ? param(sp.estado) : "";
  const q = param(sp.q).trim().toLowerCase().slice(0, 40);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  let query = supabase
    .from("count_sessions")
    .select("id, number, name, zone, status, created_at, creator:profiles!count_sessions_created_by_fkey(full_name)")
    .eq("branch_id", branch.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  const sessions = ((data ?? []) as unknown as Session[]).filter((s) => !q || `${s.number} ${s.name} ${s.zone}`.toLowerCase().includes(q));
  const lines = sessions.length
    ? await fetchAll<Line>((a, b) => supabase.from("count_lines").select("session_id, product_id, counted, system_qty, unit_cost").in("session_id", sessions.map((s) => s.id)).range(a, b))
    : [];
  const stats = new Map(
    sessions.map((s) => {
      const byProduct = new Map<string, { c: number; s: number; cost: number }>();
      for (const l of lines.filter((x) => x.session_id === s.id)) {
        const r = byProduct.get(l.product_id) ?? { c: 0, s: Number(l.system_qty ?? 0), cost: Number(l.unit_cost ?? 0) };
        r.c += Number(l.counted);
        byProduct.set(l.product_id, r);
      }
      const diffs = [...byProduct.values()];
      const closed = s.status === "cerrada" || s.status === "aplicada";
      return [
        s.id,
        {
          products: byProduct.size,
          missing: closed ? diffs.filter((d) => d.c < d.s).length : null,
          extra: closed ? diffs.filter((d) => d.c > d.s).length : null,
          value: closed ? diffs.reduce((a, d) => a + (d.c - d.s) * d.cost, 0) : null,
        },
      ];
    }),
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-700">
        <span className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-link" />
          Inventarios contados con el celular (RLS Tools). Al aplicarlos, la diferencia entra al kardex y a la contabilidad.
        </span>
        <ExportMenu
          title="Inventarios desde RLS Tools"
          subtitle={branch.name}
          filename="inventarios-rls-tools"
          columns={[
            { key: "numero", header: "Inventario" },
            { key: "nombre", header: "Nombre" },
            { key: "zona", header: "Zona" },
            { key: "estado", header: "Estado" },
            { key: "fecha", header: "Fecha" },
            { key: "productos", header: "Productos", type: "number", total: true },
            { key: "faltantes", header: "Faltantes", type: "number", total: true },
            { key: "sobrantes", header: "Sobrantes", type: "number", total: true },
            { key: "valor", header: "Diferencia valorizada", type: "money", total: true },
          ]}
          rows={sessions.map((s) => {
            const st = stats.get(s.id)!;
            return {
              numero: s.number,
              nombre: s.name,
              zona: s.zone || "Toda la sucursal",
              estado: STATUS[s.status]?.label ?? s.status,
              fecha: formatDateTime(s.created_at, settings.timezone),
              productos: st.products,
              faltantes: st.missing,
              sobrantes: st.extra,
              valor: st.value,
            };
          })}
        />
      </div>
      <Card>
        <FilterBar action="/inventario/conteos">
          <Field label="Estado">
            <Select name="estado" defaultValue={status}>
              <option value="">Todos</option>
              {Object.entries(STATUS).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Buscar">
            <Input type="search" name="q" defaultValue={q} placeholder="Número, nombre o zona" />
          </Field>
        </FilterBar>
        {error ? (
          <EmptyState title="Falta activar RLS Tools" description="Ejecuta la migración 0010_rls_tools.sql en Supabase para ver los inventarios del celular." />
        ) : sessions.length === 0 ? (
          <EmptyState icon={<Smartphone className="h-5 w-5" />} title="Aún no hay inventarios desde el celular" description="Ábrelos en RLS Tools → Inventario físico." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Inventario</Th>
                <Th>Zona</Th>
                <Th>Contó</Th>
                <Th className="text-right">Productos</Th>
                <Th className="text-right">Faltan</Th>
                <Th className="text-right">Sobran</Th>
                <Th className="text-right">Diferencia</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const st = stats.get(s.id)!;
                return (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <Td>
                      <Link href={`/inventario/conteos/${s.id}`} className="font-medium text-link hover:underline">
                        {s.number}
                      </Link>
                      <p className="text-xs text-slate-500">{s.name}</p>
                    </Td>
                    <Td>{s.zone || "Toda la sucursal"}</Td>
                    <Td>
                      {s.creator?.full_name ?? "—"}
                      <p className="tabular text-xs text-slate-500">{formatDateTime(s.created_at, settings.timezone)}</p>
                    </Td>
                    <Td className="tabular text-right">{st.products}</Td>
                    <Td className="tabular text-right">{st.missing ?? "—"}</Td>
                    <Td className="tabular text-right">{st.extra ?? "—"}</Td>
                    <Td className={cn("tabular text-right font-medium", (st.value ?? 0) < 0 ? "text-red-600" : "text-slate-900")}>{st.value === null ? "—" : money(st.value)}</Td>
                    <Td>
                      <Badge tone={STATUS[s.status]?.tone}>{STATUS[s.status]?.label ?? s.status}</Badge>
                    </Td>
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
