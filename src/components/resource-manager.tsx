"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Power, Search, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CrudActions } from "@/lib/crud/types";
import type { ExportColumn } from "@/lib/export";
import type { ModuleKey } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { useApp } from "./app-provider";
import { Dialog, DialogFooter } from "./dialog";
import { ExportMenu } from "./export-menu";
import { ImageField } from "./image-field";
import { Button, Card, EmptyState, Field, FormError, Input, Select, Table, Td, Textarea, Th } from "./ui";

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right" | "center";
  className?: string;
};

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "email" | "tel" | "date" | "select" | "textarea" | "image";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  step?: string;
  maxLength?: number;
  /** Ocupa las dos columnas del formulario */
  wide?: boolean;
  defaultValue?: string;
};

type Props<T> = {
  /** Acciones de servidor del módulo dueño (guardar, activar/desactivar, borrar) */
  actions: CrudActions;
  /** Módulo dueño: los botones crear/editar/eliminar siguen los permisos del rol */
  module: ModuleKey;
  /** Nombre en singular para títulos y mensajes: "cliente", "producto"… */
  singular: string;
  rows: T[];
  columns: Column<T>[];
  fields: FieldDef[];
  getId: (row: T) => string;
  searchText: (row: T) => string;
  /** Habilita activar/desactivar; devuelve el estado actual de la fila */
  isActive?: (row: T) => boolean;
  rowActions?: (row: T) => ReactNode;
  toolbar?: ReactNode;
  searchPlaceholder?: string;
  /** Texto inicial del buscador (p. ej. al llegar desde la búsqueda global) */
  initialQuery?: string;
  /** Abre el formulario de alta al entrar (mosaicos «Nuevo …» del lanzador: ?nuevo=1) */
  startNew?: boolean;
  pageSize?: number;
  /** Habilita «Exportar» (Excel, PDF, CSV, imprimir) sobre las filas filtradas */
  exportable?: { title: string; filename: string; columns: ExportField<T>[] };
  /**
   * Filtro propio de la pantalla (ej. categoría, estado del colaborador). Si no se indica y la
   * tabla maneja activos/inactivos, se ofrece ese filtro automáticamente.
   */
  filter?: RowFilter<T>;
};

export type RowFilter<T> = {
  label: string;
  options: { value: string; label: string; test: (row: T) => boolean }[];
};

export type ExportField<T> = Omit<ExportColumn, "key"> & {
  value: (row: T) => string | number | null | undefined;
};

/**
 * Listado + alta/edición en ventana modal para cualquier maestro.
 * Los módulos solo declaran columnas y campos.
 */
export function ResourceManager<T>({
  actions,
  module,
  singular,
  rows,
  columns,
  fields,
  getId,
  searchText,
  isActive,
  rowActions,
  toolbar,
  searchPlaceholder,
  initialQuery = "",
  startNew = false,
  pageSize = 20,
  exportable,
  filter,
}: Props<T>) {
  const { can } = useApp();
  // En Configuración todo cambio requiere el permiso "editar".
  const settings = module === "configuracion";
  const canCreate = can(module, settings ? "edit" : "create");
  const canEdit = can(module, "edit");
  const canRemove = can(module, settings ? "edit" : "delete");

  const [query, setQuery] = useState(initialQuery);
  const rowFilter = useMemo<RowFilter<T> | undefined>(
    () =>
      filter ??
      (isActive
        ? {
            label: "Estado",
            options: [
              { value: "activos", label: "Activos", test: (r) => isActive(r) },
              {
                value: "inactivos",
                label: "Inactivos",
                test: (r) => !isActive(r),
              },
            ],
          }
        : undefined),
    [filter, isActive],
  );
  const [filterValue, setFilterValue] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<T | "new" | null>(startNew && canCreate ? "new" : null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const option = rowFilter?.options.find((o) => o.value === filterValue);
    return rows.filter((r) => (!option || option.test(r)) && (!q || searchText(r).toLowerCase().includes(q)));
  }, [rows, query, searchText, rowFilter, filterValue]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);
  const hasActions = canEdit || canRemove || Boolean(rowActions);

  function close() {
    setEditing(null);
    setError(null);
  }

  function submit(formData: FormData) {
    const values: Record<string, unknown> = {};
    for (const f of fields) values[f.name] = String(formData.get(f.name) ?? "");
    const id = editing && editing !== "new" ? getId(editing) : null;
    setError(null);
    startTransition(async () => {
      const res = await actions.save(id, values);
      if (!res.ok) return setError(res.error);
      toast.success(id ? "Cambios guardados" : `Se registró el ${singular}`);
      close();
    });
  }

  function toggle(row: T) {
    const next = !isActive!(row);
    if (!actions.setActive) return;
    const setActive = actions.setActive;
    startTransition(async () => {
      const res = await setActive(getId(row), next);
      if (res.ok) toast.success(next ? "Activado" : "Desactivado");
      else toast.error(res.error);
    });
  }

  function confirmDelete() {
    if (!deleting || !actions.remove) return;
    const id = getId(deleting);
    const remove = actions.remove;
    startTransition(async () => {
      const res = await remove(id);
      if (res.ok) toast.success("Registro eliminado");
      else toast.error(res.error);
      setDeleting(null);
    });
  }

  const initial = editing && editing !== "new" ? (editing as Record<string, unknown>) : null;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder ?? "Buscar…"}
              aria-label="Buscar"
              className="pl-9"
            />
          </div>
          {rowFilter && (
            <Select
              value={filterValue}
              onChange={(e) => {
                setFilterValue(e.target.value);
                setPage(0);
              }}
              aria-label={rowFilter.label}
              className="w-auto min-w-40"
            >
              <option value="">{rowFilter.label}: todos</option>
              {rowFilter.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {toolbar}
            {exportable && (
              <ExportMenu
                title={exportable.title}
                subtitle={
                  [query.trim() && `Búsqueda: «${query.trim()}»`, rowFilter?.options.find((o) => o.value === filterValue)?.label].filter(Boolean).join(" · ") ||
                  undefined
                }
                filename={exportable.filename}
                columns={exportable.columns.map((c, i) => ({
                  key: `c${i}`,
                  header: c.header,
                  type: c.type,
                  width: c.width,
                  total: c.total,
                }))}
                rows={filtered.map((row) => Object.fromEntries(exportable.columns.map((c, i) => [`c${i}`, c.value(row)])))}
              />
            )}
            {canCreate && (
              <Button onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" />
                Nuevo {singular}
              </Button>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<SearchX className="h-5 w-5" />}
            title={rows.length === 0 ? "Aún no hay registros" : "Sin resultados"}
            description={
              rows.length === 0
                ? canCreate
                  ? `Crea el primer ${singular} con el botón «Nuevo ${singular}».`
                  : undefined
                : "Prueba con otro término de búsqueda."
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th key={c.header} className={cn(c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                    {c.header}
                  </Th>
                ))}
                {hasActions && <Th className="w-px text-right">Acciones</Th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const inactive = isActive ? !isActive(row) : false;
                return (
                  <tr key={getId(row)} className={cn("transition-colors hover:bg-slate-50/70", inactive && "opacity-55")}>
                    {columns.map((c) => (
                      <Td key={c.header} className={cn(c.align === "right" && "tabular text-right", c.align === "center" && "text-center", c.className)}>
                        {c.cell(row)}
                      </Td>
                    ))}
                    {hasActions && (
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {rowActions?.(row)}
                          {canEdit && (
                            <Button variant="ghost" size="icon" title="Editar" aria-label="Editar" onClick={() => setEditing(row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canRemove && isActive && actions.setActive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              title={inactive ? "Activar" : "Desactivar"}
                              aria-label={inactive ? "Activar" : "Desactivar"}
                              onClick={() => toggle(row)}
                            >
                              <Power className={cn("h-4 w-4", inactive ? "text-emerald-600" : "text-slate-400")} />
                            </Button>
                          )}
                          {canRemove && actions.remove && (
                            <Button variant="ghost" size="icon" title="Eliminar" aria-label="Eliminar" onClick={() => setDeleting(row)}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
          <span>
            {filtered.length} {filtered.length === 1 ? "registro" : "registros"}
          </span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="icon" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Página anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tabular">
                {current + 1} / {pages}
              </span>
              <Button variant="secondary" size="icon" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Página siguiente">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Dialog open={editing !== null} onClose={close} title={editing === "new" ? `Nuevo ${singular}` : `Editar ${singular}`} size="lg">
        {/* onSubmit (no action) para conservar lo escrito si el servidor rechaza los datos */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          key={editing === "new" || editing === null ? "new" : getId(editing)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f, i) => {
              const raw = initial ? initial[f.name] : f.defaultValue;
              const value = raw == null ? "" : String(raw);
              const common = {
                name: f.name,
                required: f.required,
                defaultValue: value,
                placeholder: f.placeholder,
              };
              if (f.type === "image") {
                return (
                  <div key={f.name} className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-medium text-slate-700">{f.label}</span>
                    <ImageField name={f.name} defaultValue={value} />
                  </div>
                );
              }
              return (
                <Field
                  key={f.name}
                  label={f.label + (f.required ? " *" : "")}
                  hint={f.hint}
                  className={cn((f.wide || f.type === "textarea") && "sm:col-span-2")}
                >
                  {f.type === "select" ? (
                    <Select {...common}>
                      {!f.required && <option value="">— Ninguno —</option>}
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === "textarea" ? (
                    <Textarea {...common} maxLength={f.maxLength} />
                  ) : (
                    <Input
                      {...common}
                      type={f.type ?? "text"}
                      step={f.type === "number" ? (f.step ?? "0.01") : undefined}
                      min={f.type === "number" ? 0 : undefined}
                      maxLength={f.maxLength}
                      autoFocus={i === 0}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                    />
                  )}
                </Field>
              );
            })}
          </div>
          <div className="mt-4">
            <FormError message={error} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title="¿Eliminar registro?" description="Esta acción no se puede deshacer." size="sm">
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={pending} onClick={confirmDelete}>
            Eliminar
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
