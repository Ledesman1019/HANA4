import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { cn, formatDateTime, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Transferencias entre tiendas" };

const STATUS: Record<string, { label: string; tone: "amber" | "green" | "red" }> = {
  en_transito: { label: "En tránsito", tone: "amber" },
  recibida: { label: "Recibida", tone: "green" },
  recibida_con_diferencias: { label: "Con diferencias", tone: "red" },
};

type Row = {
  id: string;
  number: string;
  status: string;
  note: string;
  receive_note: string;
  created_at: string;
  received_at: string | null;
  from_branch: string;
  to_branch: string;
  origin: { name: string } | null;
  destination: { name: string } | null;
  sender: { full_name: string } | null;
  receiver: { full_name: string } | null;
  items: { quantity_sent: number; quantity_received: number | null; unit_cost: number }[];
};

/** Transferencias enviadas y recibidas por la sucursal activa (desde RLS Tools), con lo que sigue en tránsito. */
export default async function TransfersPage({ searchParams }: PageProps<"/inventario/transferencias">) {
  const { supabase, branch, settings } = await requireAccess("inventario", "view");
  const sp = await searchParams;
  const status = Object.hasOwn(STATUS, param(sp.estado)) ? param(sp.estado) : "";
  const dir = ["enviadas", "recibidas"].includes(param(sp.dir)) ? param(sp.dir) : "";
  const q = param(sp.q).trim().toLowerCase().slice(0, 40);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  let query = supabase
    .from("transfer_orders")
    .select(
      "id, number, status, note, receive_note, created_at, received_at, from_branch, to_branch, origin:branches!transfer_orders_from_branch_fkey(name), destination:branches!transfer_orders_to_branch_fkey(name), sender:profiles!transfer_orders_created_by_fkey(full_name), receiver:profiles!transfer_orders_received_by_fkey(full_name), items:transfer_order_items(quantity_sent, quantity_received, unit_cost)",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  query = dir === "enviadas" ? query.eq("from_branch", branch.id) : dir === "recibidas" ? query.eq("to_branch", branch.id) : query.or(`from_branch.eq.${branch.id},to_branch.eq.${branch.id}`);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !q || `${r.number} ${r.origin?.name} ${r.destination?.name} ${r.note}`.toLowerCase().includes(q));
  const totals = (r: Row) => {
    const sent = r.items.reduce((s, i) => s + Number(i.quantity_sent), 0);
    const received = r.status === "en_transito" ? null : r.items.reduce((s, i) => s + Number(i.quantity_received ?? 0), 0);
    const value = r.items.reduce((s, i) => s + Number(i.quantity_sent) * Number(i.unit_cost), 0);
    const diff = r.status === "en_transito" ? null : r.items.reduce((s, i) => s + (Number(i.quantity_received ?? 0) - Number(i.quantity_sent)) * Number(i.unit_cost), 0);
    return { sent, received, value, diff };
  };
  const inTransit = rows.filter((r) => r.status === "en_transito" && r.to_branch === branch.id).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-700">
        <span className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-link" />
          Se envían y reciben con RLS Tools. Mientras están en tránsito no suman stock en ninguna tienda; un faltante al recibir se registra como merma.
          {inTransit > 0 && <strong className="ml-1">{inTransit} por recibir en {branch.name}.</strong>}
        </span>
        <ExportMenu
          title="Transferencias entre tiendas"
          subtitle={branch.name}
          filename="transferencias"
          columns={[
            { key: "numero", header: "Transferencia" },
            { key: "origen", header: "Origen" },
            { key: "destino", header: "Destino" },
            { key: "fecha", header: "Enviada" },
            { key: "recibida", header: "Recibida" },
            { key: "estado", header: "Estado" },
            { key: "enviado", header: "Unid. enviadas", type: "number", total: true },
            { key: "recibido", header: "Unid. recibidas", type: "number", total: true },
            { key: "valor", header: "Valor al costo", type: "money", total: true },
            { key: "diferencia", header: "Diferencia", type: "money", total: true },
          ]}
          rows={rows.map((r) => {
            const t = totals(r);
            return {
              numero: r.number,
              origen: r.origin?.name ?? "",
              destino: r.destination?.name ?? "",
              fecha: formatDateTime(r.created_at, settings.timezone),
              recibida: r.received_at ? formatDateTime(r.received_at, settings.timezone) : "",
              estado: STATUS[r.status]?.label ?? r.status,
              enviado: t.sent,
              recibido: t.received,
              valor: t.value,
              diferencia: t.diff,
            };
          })}
        />
      </div>
      <Card>
        <FilterBar action="/inventario/transferencias">
          <Field label="Dirección">
            <Select name="dir" defaultValue={dir}>
              <option value="">Enviadas y recibidas</option>
              <option value="enviadas">Enviadas</option>
              <option value="recibidas">Recibidas</option>
            </Select>
          </Field>
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
            <Input type="search" name="q" defaultValue={q} placeholder="Número, tienda o nota" />
          </Field>
        </FilterBar>
        {error ? (
          <EmptyState title="Falta actualizar la base" description="Ejecuta la migración 0011_transferencias_retornos.sql en Supabase para ver las transferencias." />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ArrowLeftRight className="h-5 w-5" />} title="Sin transferencias" description="Se crean en RLS Tools → Transferencias → Nueva Transferencia." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Transferencia</Th>
                <Th>Origen → Destino</Th>
                <Th>Envió</Th>
                <Th>Recibió</Th>
                <Th className="text-right">Unidades</Th>
                <Th className="text-right">Valor</Th>
                <Th className="text-right">Diferencia</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = totals(r);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <Td>
                      <span className="font-medium text-slate-900">{r.number}</span>
                      {r.note && <p className="text-xs text-slate-500">{r.note}</p>}
                    </Td>
                    <Td>
                      <span className={cn(r.from_branch === branch.id && "font-semibold")}>{r.origin?.name}</span> →{" "}
                      <span className={cn(r.to_branch === branch.id && "font-semibold")}>{r.destination?.name}</span>
                    </Td>
                    <Td>
                      {r.sender?.full_name ?? "—"}
                      <p className="tabular text-xs text-slate-500">{formatDateTime(r.created_at, settings.timezone)}</p>
                    </Td>
                    <Td>
                      {r.receiver?.full_name ?? "—"}
                      {r.received_at && <p className="tabular text-xs text-slate-500">{formatDateTime(r.received_at, settings.timezone)}</p>}
                    </Td>
                    <Td className="tabular text-right">
                      {formatQty(t.sent)}
                      {t.received !== null && t.received !== t.sent && <p className="text-xs text-red-600">recibió {formatQty(t.received)}</p>}
                    </Td>
                    <Td className="tabular text-right">{money(t.value)}</Td>
                    <Td className={cn("tabular text-right font-medium", (t.diff ?? 0) < 0 ? "text-red-600" : "text-slate-900")}>{t.diff === null ? "—" : money(t.diff)}</Td>
                    <Td>
                      <Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>
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
