import type { Metadata } from "next";
import { History } from "lucide-react";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, Input, Select, Table, Td, Th, type BadgeTone } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { MOVEMENT_LABELS } from "@/lib/types";
import { addDays, formatDateTime, formatQty, isIsoDate, todayIn, zonedDayStart } from "@/lib/utils";

export const metadata: Metadata = { title: "Kardex" };

const PAGE_SIZE = 40;
const TONES: Record<string, BadgeTone> = {
  inicial: "neutral",
  compra: "blue",
  venta: "green",
  ajuste: "amber",
  devolucion: "red",
  transferencia_entrada: "neutral",
  transferencia_salida: "neutral",
};

type Row = {
  id: number;
  type: string;
  quantity: number;
  balance_after: number;
  note: string;
  created_at: string;
  product: { name: string; sku: string } | null;
  user: { full_name: string } | null;
};

export default async function MovementsPage({ searchParams }: PageProps<"/inventario/movimientos">) {
  const { supabase, settings, branch } = await requireAccess("inventario", "view");
  const sp = await searchParams;
  const tz = settings.timezone;

  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : todayIn(tz, -29);
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : todayIn(tz);
  const type = Object.hasOwn(MOVEMENT_LABELS, param(sp.tipo)) ? param(sp.tipo) : "";
  const q = param(sp.q).trim().slice(0, 40);
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);

  let query = supabase
    .from("stock_movements")
    .select("id, type, quantity, balance_after, note, created_at, product:products!inner(name, sku), user:profiles(full_name)", { count: "exact" })
    .eq("branch_id", branch.id)
    .gte("created_at", zonedDayStart(from, tz))
    .lt("created_at", zonedDayStart(addDays(to, 1), tz))
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (type) query = query.eq("type", type);
  if (q) query = query.ilike("product.name", `%${q.replace(/[%_\\,()]/g, "")}%`);

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <Card>
      <FilterBar action="/inventario/movimientos">
        <Field label="Desde">
          <Input type="date" name="desde" defaultValue={from} />
        </Field>
        <Field label="Hasta">
          <Input type="date" name="hasta" defaultValue={to} />
        </Field>
        <Field label="Tipo">
          <Select name="tipo" defaultValue={type}>
            <option value="">Todos</option>
            {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Producto">
          <Input type="search" name="q" defaultValue={q} placeholder="Nombre del producto" />
        </Field>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState icon={<History className="h-5 w-5" />} title="Sin movimientos" description="No hay entradas ni salidas de stock con estos filtros." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Producto</Th>
              <Th>Tipo</Th>
              <Th className="text-right">Cantidad</Th>
              <Th className="text-right">Saldo</Th>
              <Th>Referencia</Th>
              <Th>Usuario</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const n = Number(m.quantity);
              return (
                <tr key={m.id} className="hover:bg-slate-50/60">
                  <Td className="tabular whitespace-nowrap">{formatDateTime(m.created_at, tz)}</Td>
                  <Td>
                    <p className="font-medium text-slate-900">{m.product?.name}</p>
                    <p className="tabular text-xs text-slate-500">{m.product?.sku}</p>
                  </Td>
                  <Td>
                    <Badge tone={TONES[m.type] ?? "neutral"}>{MOVEMENT_LABELS[m.type] ?? m.type}</Badge>
                  </Td>
                  <Td className={`tabular text-right font-medium ${n >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {n >= 0 ? "+" : "−"}
                    {formatQty(Math.abs(n))}
                  </Td>
                  <Td className="tabular text-right text-slate-900">{formatQty(m.balance_after)}</Td>
                  <Td className="max-w-56 truncate text-slate-500" title={m.note}>
                    {m.note || "—"}
                  </Td>
                  <Td>{m.user?.full_name ?? "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefFor={(p) => `/inventario/movimientos${buildQuery({ desde: from, hasta: to, tipo: type, q, pagina: p })}`}
      />
    </Card>
  );
}
