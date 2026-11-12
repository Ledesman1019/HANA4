import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardPen, Plus } from "lucide-react";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { ExportMenu } from "@/components/export-menu";
import { Badge, buttonClass, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { REQUISITION_STATUS } from "@/modules/compras/types";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Solicitudes de pedido" };

const PAGE_SIZE = 25;

type Row = {
  id: string;
  number: string;
  status: string;
  justification: string;
  created_at: string;
  requester: { full_name: string } | null;
  items: { id: string }[];
  purchase: { id: string; number: string } | null;
};

export default async function RequisitionsPage({ searchParams }: PageProps<"/compras/solicitudes">) {
  const { supabase, settings, branch, can } = await requireAccess("compras", "access");
  const sp = await searchParams;
  const status = Object.hasOwn(REQUISITION_STATUS, param(sp.estado)) ? param(sp.estado) : "";
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);
  const q = param(sp.q).trim().slice(0, 30).replace(/[%_\,()]/g, "");

  let query = supabase
    .from("purchase_requisitions")
    .select(
      "id, number, status, justification, created_at, requester:profiles!purchase_requisitions_requested_by_fkey(full_name), items:purchase_requisition_items(id), purchase:purchases!purchase_requisitions_purchase_id_fkey(id, number)",
      { count: "exact" },
    )
    .eq("branch_id", branch.id)
    .ilike("number", `%${q}%`)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Solicitudes de pedido" description="Pedidos de mercadería por aprobar. Compras los revisa, aprueba y emite la orden al proveedor.">
        <ExportMenu
          title="Solicitudes de pedido"
          subtitle={branch.name}
          filename="solicitudes-de-pedido"
          source={`/api/export/solicitudes${buildQuery({ estado: status, q })}`}
          columns={[
            { key: "numero", header: "Solicitud" },
            { key: "fecha", header: "Fecha" },
            { key: "solicitante", header: "Solicitante" },
            { key: "centro", header: "Centro de costo" },
            { key: "justificacion", header: "Justificación" },
            { key: "productos", header: "Productos", type: "number" },
            { key: "estado", header: "Estado" },
          ]}
        />
        {can("compras", "create") && (
          <Link href="/compras/solicitudes/nueva" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" />
            Nueva solicitud
          </Link>
        )}
      </PageHeader>

      <Card>
        <FilterBar action="/compras/solicitudes">
          <Field label="Estado">
            <Select name="estado" defaultValue={status}>
              <option value="">Todas</option>
              {Object.entries(REQUISITION_STATUS).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="N.º de solicitud">
            <Input type="search" name="q" defaultValue={q} placeholder="SP001-00000004" />
          </Field>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardPen className="h-5 w-5" />}
            title="No hay solicitudes de pedido"
            description="Crea una cuando falte mercadería. El sistema te sugiere los productos en o bajo su stock mínimo."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Solicitud</Th>
                <Th>Solicitante</Th>
                <Th>Fecha</Th>
                <Th>Justificación</Th>
                <Th className="text-right">Productos</Th>
                <Th>Estado</Th>
                <Th>Orden de compra</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50/70">
                  <Td>
                    <Link href={`/compras/solicitudes/${r.id}`} className="font-medium text-link hover:underline">
                      {r.number}
                    </Link>
                  </Td>
                  <Td>{r.requester?.full_name ?? "—"}</Td>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(r.created_at, settings.timezone)}</Td>
                  <Td className="max-w-64 truncate text-slate-500" title={r.justification}>
                    {r.justification || "—"}
                  </Td>
                  <Td className="tabular text-right">{r.items.length}</Td>
                  <Td>
                    <Badge tone={REQUISITION_STATUS[r.status]?.tone}>{REQUISITION_STATUS[r.status]?.label ?? r.status}</Badge>
                  </Td>
                  <Td>
                    {r.purchase ? (
                      <Link href={`/compras/${r.purchase.id}`} className="tabular font-medium text-link hover:underline">
                        {r.purchase.number}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/compras/solicitudes${buildQuery({ estado: status, q, pagina: p })}`} />
      </Card>
    </>
  );
}
