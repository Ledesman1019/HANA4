import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { buildQuery, Pagination, param } from "@/components/filters";
import { Badge, buttonClass, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { PURCHASE_STATUS } from "@/lib/types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Compras" };

const PAGE_SIZE = 25;

type Row = {
  id: string;
  number: string;
  status: string;
  total: number;
  expected_date: string | null;
  created_at: string;
  supplier: { name: string } | null;
};

export default async function PurchasesPage({ searchParams }: PageProps<"/compras">) {
  const { supabase, settings, branch, can } = await requireAccess("compras", "view");
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);

  const { data, count } = await supabase
    .from("purchases")
    .select("id, number, status, total, expected_date, created_at, supplier:suppliers(name)", { count: "exact" })
    .eq("branch_id", branch.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];
  const canCreate = can("compras", "create");

  return (
    <>
      <PageHeader title="Compras" description={`Órdenes de compra de ${branch.name}. Al recibirlas, el stock ingresa y el costo promedio se actualiza.`}>
        {canCreate && (
          <Link href="/compras/nueva" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" />
            Nueva orden
          </Link>
        )}
      </PageHeader>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="Aún no hay órdenes de compra"
            description="Registra una orden para reponer mercadería. El stock se actualiza cuando la marcas como recibida."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Orden</Th>
                <Th>Proveedor</Th>
                <Th>Creada</Th>
                <Th>Entrega estimada</Th>
                <Th className="text-right">Total</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <Td>
                    <Link href={`/compras/${p.id}`} className="font-medium text-link hover:underline">
                      {p.number}
                    </Link>
                  </Td>
                  <Td>{p.supplier?.name ?? "—"}</Td>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(p.created_at, settings.timezone)}</Td>
                  <Td className="tabular">{formatDate(p.expected_date)}</Td>
                  <Td className="tabular text-right font-medium text-slate-900">{formatMoney(p.total, settings.currency_symbol)}</Td>
                  <Td>
                    <Badge tone={PURCHASE_STATUS[p.status]?.tone}>{PURCHASE_STATUS[p.status]?.label ?? p.status}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/compras${buildQuery({ pagina: p })}`} />
      </Card>
    </>
  );
}
