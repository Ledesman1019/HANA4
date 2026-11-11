import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, Input, Select, Table, Td, Th, type BadgeTone } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { addDays, formatDateTime, isIsoDate, todayIn, zonedDayStart } from "@/lib/utils";

export const metadata: Metadata = { title: "Auditoría" };

const PAGE_SIZE = 40;

/** Familias de eventos: el prefijo de `action` */
const AREAS: Record<string, { label: string; tone: BadgeTone }> = {
  rol: { label: "Permisos", tone: "blue" },
  usuario: { label: "Usuarios", tone: "blue" },
  venta: { label: "Ventas", tone: "red" },
  stock: { label: "Inventario", tone: "amber" },
  compra: { label: "Compras", tone: "neutral" },
  pago: { label: "Pagos", tone: "amber" },
  caja: { label: "Caja", tone: "amber" },
  personal: { label: "Personal", tone: "neutral" },
  empresa: { label: "Empresa", tone: "neutral" },
};

type Row = { id: number; created_at: string; actor_name: string; action: string; summary: string };

export default async function AuditPage({ searchParams }: PageProps<"/configuracion/auditoria">) {
  const { supabase, settings } = await requireAccess("configuracion", "view");
  const sp = await searchParams;
  const tz = settings.timezone;

  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : todayIn(tz, -29);
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : todayIn(tz);
  const area = Object.hasOwn(AREAS, param(sp.area)) ? param(sp.area) : "";
  const q = param(sp.q).trim().slice(0, 40).replace(/[%_\\,()]/g, "");
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);

  let query = supabase
    .from("audit_log")
    .select("id, created_at, actor_name, action, summary", { count: "exact" })
    .gte("created_at", zonedDayStart(from, tz))
    .lt("created_at", zonedDayStart(addDays(to, 1), tz))
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (area) query = query.like("action", `${area}.%`);
  if (q) query = query.or(`summary.ilike.%${q}%,actor_name.ilike.%${q}%`);

  const { data, count } = await query;
  const rows = (data ?? []) as Row[];
  const areaOf = (action: string) => AREAS[action.split(".")[0]] ?? { label: "Sistema", tone: "neutral" as BadgeTone };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Quién cambió qué y cuándo: permisos, usuarios, anulaciones, ajustes de stock, diferencias de caja y sueldos. El registro lo escribe la base de datos y{" "}
          <strong className="font-medium text-slate-700">nadie puede editarlo ni borrarlo</strong>, tampoco un administrador.
        </p>
        <ExportMenu
          title="Registro de auditoría"
          subtitle={`Página ${page} · filtros actuales`}
          filename={`auditoria_${from}_${to}`}
          columns={[
            { key: "fecha", header: "Fecha", width: 18 },
            { key: "usuario", header: "Usuario", width: 24 },
            { key: "area", header: "Área", width: 12 },
            { key: "evento", header: "Qué hizo", width: 90 },
          ]}
          rows={rows.map((r) => ({ fecha: formatDateTime(r.created_at, tz), usuario: r.actor_name, area: areaOf(r.action).label, evento: r.summary }))}
        />
      </div>

      <Card>
        <FilterBar action="/configuracion/auditoria">
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} />
          </Field>
          <Field label="Área">
            <Select name="area" defaultValue={area}>
              <option value="">Todas</option>
              {Object.entries(AREAS).map(([value, a]) => (
                <option key={value} value={value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Buscar">
            <Input type="search" name="q" defaultValue={q} placeholder="Usuario o texto del evento" />
          </Field>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-5 w-5" />} title="Sin eventos en este periodo" description="Aquí aparecerá cada cambio sensible que se haga en el sistema." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha y hora</Th>
                <Th>Usuario</Th>
                <Th>Área</Th>
                <Th>Qué hizo</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top transition-colors hover:bg-slate-50/70">
                  <Td className="tabular whitespace-nowrap">{formatDateTime(r.created_at, tz)}</Td>
                  <Td className="whitespace-nowrap font-medium text-slate-900">{r.actor_name}</Td>
                  <Td>
                    <Badge tone={areaOf(r.action).tone}>{areaOf(r.action).label}</Badge>
                  </Td>
                  <Td className="text-slate-700">{r.summary}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={count ?? 0}
          hrefFor={(p) => `/configuracion/auditoria${buildQuery({ desde: from, hasta: to, area, q, pagina: p })}`}
        />
      </Card>
    </>
  );
}
