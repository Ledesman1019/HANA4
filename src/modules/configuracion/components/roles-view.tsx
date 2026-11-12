"use client";

import { useState, useTransition } from "react";
import { Check, Lock, Minus, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogFooter } from "@/components/dialog";
import { ExportMenu } from "@/components/export-menu";
import { Badge, Button, Card, Field, FormError, Input } from "@/components/ui";
import { ACTIONS, MODULES, type Action, type ModuleKey, type Permissions } from "@/lib/modules";
import type { RoleRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deleteRole, saveRole } from "@/modules/configuracion/actions";

export type RoleWithPermissions = RoleRow & { users: number; permissions: Permissions };

const NEW_ID = "__nuevo__";
const AREAS = [...new Set(MODULES.map((m) => m.area))];

const allOn = (): Permissions => Object.fromEntries(MODULES.map((m) => [m.key, Object.fromEntries(Object.keys(m.actions).map((a) => [a, true]))])) as Permissions;

export function RolesView({ roles, ownRole, canEdit }: { roles: RoleWithPermissions[]; ownRole: string; canEdit: boolean }) {
  const [selectedId, setSelectedId] = useState(roles.find((r) => r.id !== "admin")?.id ?? roles[0]?.id ?? NEW_ID);
  // Borrador por rol: se conserva al cambiar de rol hasta guardar o descartar
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string; permissions: Permissions }>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const saved = roles.find((r) => r.id === selectedId);
  const isNew = selectedId === NEW_ID;
  const isAdmin = selectedId === "admin";
  const isOwn = selectedId === ownRole;
  const locked = !canEdit || isAdmin || isOwn;

  const base = saved ? { name: saved.name, description: saved.description, permissions: saved.permissions } : { name: "", description: "", permissions: {} };
  const draft = drafts[selectedId] ?? base;
  const dirty = Boolean(drafts[selectedId]);
  const effective = isAdmin ? allOn() : draft.permissions;

  const update = (patch: Partial<typeof draft>) => setDrafts((d) => ({ ...d, [selectedId]: { ...draft, ...patch } }));

  function setFlag(module: ModuleKey, action: Action, value: boolean) {
    const current = { ...(draft.permissions[module] ?? {}) };
    current[action] = value;
    // Sin "Ver" no tiene sentido editar o eliminar; y al concederlos se concede "Ver".
    const def = MODULES.find((m) => m.key === module)!;
    if (def.actions.view && def.key !== "ventas" && def.key !== "caja") {
      if (action === "view" && !value) for (const a of ["create", "edit", "delete"] as Action[]) current[a] = false;
      if (action !== "view" && value) current.view = true;
    }
    update({ permissions: { ...draft.permissions, [module]: current } });
  }

  function setRow(module: ModuleKey, value: boolean) {
    const def = MODULES.find((m) => m.key === module)!;
    update({ permissions: { ...draft.permissions, [module]: Object.fromEntries(Object.keys(def.actions).map((a) => [a, value])) } });
  }

  function discard() {
    setDrafts(({ [selectedId]: _removed, ...rest }) => {
      void _removed;
      return rest;
    });
    setError(null);
    if (isNew) setSelectedId(roles.find((r) => r.id !== "admin")?.id ?? "admin");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveRole({ id: isNew ? null : selectedId, name: draft.name, description: draft.description, permissions: draft.permissions as Record<string, Record<string, boolean>> });
      if (!res.ok) return setError(res.error);
      toast.success(isNew ? "Rol creado" : "Permisos actualizados. Aplican de inmediato");
      setDrafts(({ [selectedId]: _removed, ...rest }) => {
        void _removed;
        return rest;
      });
      setSelectedId(res.data.id);
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteRole(selectedId);
      setConfirmDelete(false);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Rol eliminado");
      setSelectedId(roles.find((r) => r.id !== "admin" && r.id !== selectedId)?.id ?? "admin");
    });
  }

  const granted = (p: Permissions) => MODULES.reduce((n, m) => n + Object.keys(m.actions).filter((a) => p[m.key]?.[a as Action]).length, 0);
  const total = MODULES.reduce((n, m) => n + Object.keys(m.actions).length, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* Lista de roles */}
      <div className="space-y-2">
        <ExportMenu
          title="Matriz de roles y permisos"
          filename="roles-y-permisos"
          label="Exportar matriz"
          align="left"
          columns={[
            { key: "rol", header: "Rol" },
            { key: "modulo", header: "Módulo" },
            ...ACTIONS.map((a) => ({ key: a.key, header: a.label })),
          ]}
          rows={roles.flatMap((r) =>
            MODULES.map((m) => ({
              rol: r.name,
              modulo: m.label,
              ...Object.fromEntries(ACTIONS.map((a) => [a.key, m.actions[a.key] ? (r.id === "admin" || r.permissions[m.key]?.[a.key] ? "Sí" : "—") : ""])),
            })),
          )}
        />
        <ul className="space-y-1.5">
          {roles.map((r) => {
            const count = r.id === "admin" ? total : granted(drafts[r.id]?.permissions ?? r.permissions);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(r.id);
                    setError(null);
                  }}
                  aria-pressed={selectedId === r.id}
                  className={cn(
                    "w-full cursor-pointer rounded-xl border px-3.5 py-3 text-left transition-colors",
                    selectedId === r.id ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-surface hover:bg-slate-50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900">
                      {r.id === "admin" && <ShieldCheck className="h-4 w-4 shrink-0 text-link" />}
                      <span className="truncate">{r.name}</span>
                      {drafts[r.id] && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" title="Cambios sin guardar" />}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {r.users}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-200">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(count / total) * 100}%` }} />
                  </span>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {count} de {total} permisos
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {canEdit && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setSelectedId(NEW_ID);
              setError(null);
              setDrafts((d) => ({ ...d, [NEW_ID]: d[NEW_ID] ?? { name: "", description: "", permissions: {} } }));
            }}
          >
            <Plus className="h-4 w-4" />
            Nuevo rol
          </Button>
        )}
      </div>

      {/* Matriz de permisos */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre del rol">
              <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} disabled={locked} maxLength={60} placeholder="Supervisor de Ventas" />
            </Field>
            <Field label="Descripción">
              <Input value={draft.description} onChange={(e) => update({ description: e.target.value })} disabled={locked} maxLength={200} placeholder="Para qué sirve este rol" />
            </Field>
          </div>
          {saved && !saved.is_system && canEdit && !isOwn && (
            <Button variant="ghost" size="icon" title="Eliminar rol" aria-label="Eliminar rol" className="mt-5" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>

        {(isAdmin || isOwn || !canEdit) && (
          <p className="flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-600">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {isAdmin
              ? "El Administrador siempre tiene acceso total: así nunca se queda el sistema sin alguien que pueda corregir permisos."
              : isOwn
                ? "Este es tu propio rol. Por seguridad, otra persona con acceso a configuración debe modificarlo."
                : "Tu rol puede consultar esta pantalla pero no modificarla."}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-5 py-3 text-left">
                  Módulo
                </th>
                {ACTIONS.map((a) => (
                  <th key={a.key} scope="col" className="w-20 px-2 py-3 text-center">
                    {a.label}
                  </th>
                ))}
                <th scope="col" className="w-24 px-3 py-3 text-right">
                  <span className="sr-only">Todo</span>
                </th>
              </tr>
            </thead>
            {AREAS.map((area) => (
              <tbody key={area}>
                <tr>
                  <th scope="colgroup" colSpan={6} className="border-y border-slate-100 bg-slate-50/70 px-5 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {area}
                  </th>
                </tr>
                {MODULES.filter((m) => m.area === area).map((m) => {
                  const p = effective[m.key] ?? {};
                  const keys = Object.keys(m.actions) as Action[];
                  const every = keys.every((k) => p[k]);
                  return (
                    <tr key={m.key} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="px-5 py-3 text-left font-medium text-slate-900">
                        {m.label}
                      </th>
                      {ACTIONS.map((a) => {
                        const meaning = m.actions[a.key];
                        if (!meaning) {
                          return (
                            <td key={a.key} className="px-2 py-3 text-center text-slate-300" title="No aplica en este módulo">
                              <Minus className="mx-auto h-4 w-4" aria-label="No aplica" />
                            </td>
                          );
                        }
                        const on = Boolean(p[a.key]);
                        return (
                          <td key={a.key} className="px-2 py-3 text-center">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              aria-label={`${m.label}: ${a.label}. ${meaning}`}
                              title={meaning}
                              disabled={locked}
                              onClick={() => setFlag(m.key, a.key, !on)}
                              className={cn(
                                "mx-auto flex h-6 w-6 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                                on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-surface text-transparent hover:border-brand-500",
                                locked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                              )}
                            >
                              <Check className="h-4 w-4" strokeWidth={3} />
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right">
                        {!locked && (
                          <button type="button" onClick={() => setRow(m.key, !every)} className="cursor-pointer text-xs font-medium text-link hover:underline">
                            {every ? "Quitar todo" : "Marcar todo"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>

        <details className="border-t border-slate-100 px-5 py-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">¿Qué significa cada casilla?</summary>
          <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {MODULES.map((m) => (
              <div key={m.key}>
                <dt className="text-xs font-semibold text-slate-900">{m.label}</dt>
                <dd className="mt-0.5 space-y-0.5 text-xs text-slate-600">
                  {ACTIONS.filter((a) => m.actions[a.key]).map((a) => (
                    <p key={a.key}>
                      <Badge>{a.label}</Badge> {m.actions[a.key]}
                    </p>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </details>

        {!locked && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-slate-200 bg-surface/95 px-5 py-3 backdrop-blur">
            <div className="min-w-0 flex-1">
              <FormError message={error} />
              {!error && <p className="text-xs text-slate-500">{dirty ? "Tienes cambios sin guardar." : "Los cambios aplican a todos los usuarios con este rol."}</p>}
            </div>
            <div className="flex gap-2">
              {(dirty || isNew) && (
                <Button variant="secondary" onClick={discard}>
                  Descartar
                </Button>
              )}
              <Button loading={pending} disabled={!dirty} onClick={save}>
                {isNew ? "Crear rol" : "Guardar permisos"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`¿Eliminar el rol «${saved?.name}»?`}
        description={saved?.users ? `Hay ${saved.users} usuario(s) con este rol: primero asígnales otro.` : "Esta acción no se puede deshacer."}
        size="sm"
      >
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={pending} disabled={Boolean(saved?.users)} onClick={remove}>
            Eliminar rol
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
