"use client";

import { useMemo, useState, useTransition } from "react";
import { CreditCard, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { ExportMenu } from "@/components/export-menu";
import { Badge, Button, Card, EmptyState, Field, FormError, Input, Select, Table, Td, Th } from "@/components/ui";
import { setCustomerCredit } from "@/modules/cuentas-cobrar/actions";

export type CreditLine = {
  id: string;
  name: string;
  doc_type: string;
  doc_number: string;
  credit_limit: number;
  credit_days: number;
  debt: number;
  overdue: boolean;
};

/** Control de crédito: línea y plazo de cada cliente, con su deuda actual. */
export function CreditLines({ rows, canEdit, initialQuery }: { rows: CreditLine[]; canEdit: boolean; initialQuery?: string }) {
  const { money } = useApp();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [state, setState] = useState("");
  const [editing, setEditing] = useState<CreditLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.doc_number}`.toLowerCase().includes(q)) return false;
      if (state === "con") return r.credit_limit > 0;
      if (state === "sin") return r.credit_limit <= 0;
      if (state === "vencidos") return r.overdue;
      if (state === "excedidos") return r.credit_limit > 0 && r.debt >= r.credit_limit;
      return true;
    });
  }, [rows, query, state]);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cliente o documento…" aria-label="Buscar" className="pl-9" />
        </div>
        <Select value={state} onChange={(e) => setState(e.target.value)} aria-label="Filtro" className="w-auto min-w-44">
          <option value="">Todos los clientes</option>
          <option value="con">Con línea de crédito</option>
          <option value="sin">Solo contado</option>
          <option value="vencidos">Con deuda vencida</option>
          <option value="excedidos">Línea agotada</option>
        </Select>
        <div className="ml-auto">
          <ExportMenu
            title="Líneas de crédito"
            filename="lineas-de-credito"
            columns={[
              { key: "cliente", header: "Cliente", width: 32 },
              { key: "documento", header: "Documento" },
              { key: "linea", header: "Línea", type: "money", total: true },
              { key: "plazo", header: "Plazo (días)", type: "number" },
              { key: "deuda", header: "Deuda", type: "money", total: true },
              { key: "disponible", header: "Disponible", type: "money", total: true },
              { key: "estado", header: "Estado" },
            ]}
            rows={shown.map((r) => ({
              cliente: r.name,
              documento: `${r.doc_type} ${r.doc_number}`,
              linea: r.credit_limit,
              plazo: r.credit_days,
              deuda: r.debt,
              disponible: Math.max(0, r.credit_limit - r.debt),
              estado: r.credit_limit <= 0 ? "Contado" : r.overdue ? "Deuda vencida" : "Al día",
            }))}
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<CreditCard className="h-5 w-5" />} title="Sin clientes en esta vista" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th className="text-right">Línea</Th>
              <Th className="text-right">Plazo</Th>
              <Th className="text-right">Deuda</Th>
              <Th className="text-right">Disponible</Th>
              <Th>Estado</Th>
              {canEdit && <Th className="w-px" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <Td>
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="tabular text-xs text-slate-500">
                    {r.doc_type} {r.doc_number}
                  </p>
                </Td>
                <Td className="tabular text-right">{r.credit_limit > 0 ? money(r.credit_limit) : <span className="text-slate-400">—</span>}</Td>
                <Td className="tabular text-right">{r.credit_limit > 0 ? `${r.credit_days} días` : "—"}</Td>
                <Td className="tabular text-right">{money(r.debt)}</Td>
                <Td className="tabular text-right font-medium">{r.credit_limit > 0 ? money(Math.max(0, r.credit_limit - r.debt)) : "—"}</Td>
                <Td>{r.credit_limit <= 0 ? <Badge>Contado</Badge> : r.overdue ? <Badge tone="red">Deuda vencida</Badge> : <Badge tone="green">Al día</Badge>}</Td>
                {canEdit && (
                  <Td>
                    <Button variant="ghost" size="icon" aria-label={`Asignar línea a ${r.name}`} title="Asignar línea de crédito" onClick={() => setEditing(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Línea de crédito" description={editing?.name} size="sm">
        <form
          key={editing?.id}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const res = await setCustomerCredit(editing.id, Number(form.get("limit")), Number(form.get("days")));
              if (!res.ok) return setError(res.error);
              toast.success("Línea de crédito actualizada");
              setEditing(null);
            });
          }}
        >
          <Field label="Línea de crédito" hint="Deuda máxima permitida. 0 = solo vende al contado.">
            <Input name="limit" type="number" min={0} step="0.01" required defaultValue={editing?.credit_limit ?? 0} />
          </Field>
          <Field label="Plazo de pago (días)" hint="Días para pagar cada venta al crédito.">
            <Input name="days" type="number" min={0} max={365} step={1} required defaultValue={editing?.credit_days || 30} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </Card>
  );
}
