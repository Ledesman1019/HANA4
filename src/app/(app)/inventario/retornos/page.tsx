import type { Metadata } from "next";
import { Undo2 } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Card, EmptyState, Field, Input, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Retornos a proveedor" };

type Row = {
  id: string;
  number: string;
  reason: string;
  total_cost: number;
  created_at: string;
  supplier: { name: string; tax_id: string } | null;
  purchase: { number: string } | null;
  creator: { full_name: string } | null;
  items: { quantity: number; product: { name: string } | null }[];
};

/** Mercadería devuelta a proveedores (RLS Tools). Queda como reclamo (1673) hasta la nota de crédito. */
export default async function SupplierReturnsPage({ searchParams }: PageProps<"/inventario/retornos">) {
  const { supabase, branch, settings } = await requireAccess("inventario", "view");
  const sp = await searchParams;
  const q = param(sp.q).trim().toLowerCase().slice(0, 40);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  const { data, error } = await supabase
    .from("supplier_returns")
    .select(
      "id, number, reason, total_cost, created_at, supplier:suppliers(name, tax_id), purchase:purchases(number), creator:profiles!supplier_returns_created_by_fkey(full_name), items:supplier_return_items(quantity, product:products(name))",
    )
    .eq("branch_id", branch.id)
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !q || `${r.number} ${r.supplier?.name} ${r.reason} ${r.purchase?.number ?? ""}`.toLowerCase().includes(q));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-700">
        <span className="flex items-center gap-2">
          <Undo2 className="h-4 w-4 text-link" />
          Se registran en RLS Tools. Salen del stock al costo y quedan en la cuenta 1673 (reclamaciones a terceros) hasta que el proveedor emita su nota de crédito.
        </span>
        <ExportMenu
          title="Retornos a proveedor"
          subtitle={branch.name}
          filename="retornos-proveedor"
          columns={[
            { key: "numero", header: "Retorno" },
            { key: "fecha", header: "Fecha" },
            { key: "proveedor", header: "Proveedor" },
            { key: "oc", header: "O/C" },
            { key: "motivo", header: "Motivo" },
            { key: "unidades", header: "Unidades", type: "number", total: true },
            { key: "costo", header: "Costo", type: "money", total: true },
          ]}
          rows={rows.map((r) => ({
            numero: r.number,
            fecha: formatDateTime(r.created_at, settings.timezone),
            proveedor: r.supplier?.name ?? "",
            oc: r.purchase?.number ?? "",
            motivo: r.reason,
            unidades: r.items.reduce((s, i) => s + Number(i.quantity), 0),
            costo: Number(r.total_cost),
          }))}
        />
      </div>
      <Card>
        <FilterBar action="/inventario/retornos">
          <Field label="Buscar">
            <Input type="search" name="q" defaultValue={q} placeholder="Número, proveedor, O/C o motivo" />
          </Field>
        </FilterBar>
        {error ? (
          <EmptyState title="Falta actualizar la base" description="Ejecuta la migración 0011_transferencias_retornos.sql en Supabase para ver los retornos." />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Undo2 className="h-5 w-5" />} title="Sin retornos a proveedor" description="Se registran en RLS Tools → Recibos → Retorno a Proveedor." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Retorno</Th>
                <Th>Proveedor</Th>
                <Th>Productos</Th>
                <Th>Motivo</Th>
                <Th>Registró</Th>
                <Th className="text-right">Costo</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <Td>
                    <span className="font-medium text-slate-900">{r.number}</span>
                    {r.purchase && <p className="text-xs text-slate-500">O/C {r.purchase.number}</p>}
                  </Td>
                  <Td>
                    {r.supplier?.name}
                    <p className="tabular text-xs text-slate-500">{r.supplier?.tax_id}</p>
                  </Td>
                  <Td className="text-xs">
                    {r.items.map((i, k) => (
                      <p key={k}>
                        {formatQty(i.quantity)} × {i.product?.name}
                      </p>
                    ))}
                  </Td>
                  <Td>{r.reason}</Td>
                  <Td>
                    {r.creator?.full_name ?? "—"}
                    <p className="tabular text-xs text-slate-500">{formatDateTime(r.created_at, settings.timezone)}</p>
                  </Td>
                  <Td className="tabular text-right font-medium">{money(Number(r.total_cost))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
