"use client";

import { useMemo, useState, useTransition } from "react";
import { KeyRound, Pencil, Search, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { ExportMenu } from "@/components/export-menu";
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Select, Table, Td, Th } from "@/components/ui";
import type { Profile, RoleRow } from "@/lib/types";
import { createUser, resetUserPassword, updateUser } from "@/modules/configuracion/actions";

type Option = { value: string; label: string };

export function UsersView({ rows, roles, currentUserId, isSuper, branches }: { rows: Profile[]; roles: RoleRow[]; currentUserId: string; isSuper: boolean; branches: Option[] }) {
  const { can } = useApp();
  const canEdit = can("configuracion", "edit");
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const [resetting, setResetting] = useState<Profile | null>(null);
  const [role, setRole] = useState("empleado");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const roleOf = (id: string) => roles.find((r) => r.id === id);
  const branchName = (id: string | null) => branches.find((b) => b.value === id)?.label ?? "—";
  const isNew = editing === "new";
  const user = editing && editing !== "new" ? editing : null;
  const isSelf = user?.id === currentUserId;
  const activeSupers = rows.filter((u) => u.is_super && u.active).length;
  // Solo un Super Administrador nombra administradores
  const assignable = roles.filter((r) => r.id !== "admin" || isSuper);
  // Un administrador solo puede ser gestionado por un Super Administrador
  const manageable = (u: Profile) => canEdit && (u.role !== "admin" || isSuper);
  const roleLabel = (u: Profile) => (u.is_super ? "Superadministrador" : (roleOf(u.role)?.name ?? u.role));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!statusFilter || (statusFilter === "activos") === u.active) &&
        (!q || `${u.full_name} ${u.email}`.toLowerCase().includes(q)),
    );
  }, [rows, query, roleFilter, statusFilter]);

  function open(target: Profile | "new") {
    setRole(target === "new" ? "empleado" : target.role);
    setError(null);
    setEditing(target);
  }

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const res = user
        ? await updateUser({
            id: user.id,
            full_name: String(form.get("full_name") ?? ""),
            role,
            branch_id: String(form.get("branch_id") ?? ""),
            active: form.get("active") === "on",
            is_super: isSuper ? form.get("is_super") === "on" : undefined,
          })
        : await createUser({ ...Object.fromEntries(form), role });
      if (!res.ok) return setError(res.error);
      toast.success(user ? "Usuario actualizado" : "Usuario creado. Ya puede iniciar sesión");
      setEditing(null);
    });
  }

  function submitReset(form: FormData) {
    if (!resetting) return;
    const id = resetting.id;
    setError(null);
    startTransition(async () => {
      const res = await resetUserPassword(id, String(form.get("password") ?? ""));
      if (!res.ok) return setError(res.error);
      toast.success("Contraseña restablecida. Compártela por un canal seguro");
      setResetting(null);
    });
  }

  return (
    <>
      {activeSupers < 2 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong className="font-semibold">Hay un solo Super Administrador.</strong> Es el único que puede nombrar o retirar administradores. Si pierde su acceso, nadie podrá hacerlo:
            concede ese nivel a una segunda persona de máxima confianza (el dueño o el responsable de TI).
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          title="Usuarios del sistema"
          description="No existe auto-registro: las cuentas se crean aquí y cada una hereda los permisos de su rol. Dale a cada persona solo el rol que su trabajo necesita."
          action={
            canEdit ? (
              <Button onClick={() => open("new")}>
                <UserPlus className="h-4 w-4" />
                Nuevo usuario
              </Button>
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o correo…" aria-label="Buscar" className="pl-9" />
          </div>
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Rol" className="w-auto min-w-40">
            <option value="">Rol: todos</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Estado" className="w-auto min-w-36">
            <option value="">Estado: todos</option>
            <option value="activos">Con acceso</option>
            <option value="inactivos">Sin acceso</option>
          </Select>
          <div className="ml-auto">
            <ExportMenu
              title="Usuarios del sistema"
              filename="usuarios"
              columns={[
                { key: "nombre", header: "Nombre" },
                { key: "correo", header: "Correo" },
                { key: "rol", header: "Rol" },
                { key: "sucursal", header: "Sucursal" },
                { key: "estado", header: "Estado" },
              ]}
              rows={shown.map((u) => ({ nombre: u.full_name, correo: u.email, rol: roleLabel(u), sucursal: branchName(u.branch_id), estado: u.active ? "Con acceso" : "Sin acceso" }))}
            />
          </div>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Usuario</Th>
              <Th>Rol</Th>
              <Th>Sucursal</Th>
              <Th>Estado</Th>
              {canEdit && <Th className="w-px text-right">Acciones</Th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.active ? "transition-colors hover:bg-slate-50/70" : "opacity-55"}>
                <Td>
                  <p className="font-medium text-slate-900">
                    {u.full_name} {u.id === currentUserId && <span className="text-xs font-normal text-slate-500">(tú)</span>}
                  </p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </Td>
                <Td>
                  {u.is_super ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Superadministrador
                    </span>
                  ) : (
                    <Badge tone={u.role === "admin" ? "blue" : "neutral"}>{roleOf(u.role)?.name ?? u.role}</Badge>
                  )}
                </Td>
                <Td>{branchName(u.branch_id)}</Td>
                <Td>
                  <Badge tone={u.active ? "green" : "red"}>{u.active ? "Activo" : "Sin acceso"}</Badge>
                </Td>
                {canEdit && (
                  <Td className="text-right">
                    {manageable(u) && (
                      <div className="flex justify-end gap-1">
                        {u.id !== currentUserId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Restablecer contraseña de ${u.full_name}`}
                            title="Restablecer contraseña"
                            onClick={() => {
                              setError(null);
                              setResetting(u);
                            }}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" aria-label={`Editar ${u.full_name}`} title="Editar" onClick={() => open(u)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={isNew ? "Nuevo usuario" : "Editar usuario"} description={user?.email} size="md">
        <form
          key={user?.id ?? "new"}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
        >
          <Field label="Nombre completo *">
            <Input name="full_name" defaultValue={user?.full_name} required minLength={3} maxLength={120} autoFocus />
          </Field>
          {isNew && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Correo *">
                <Input name="email" type="email" required autoComplete="off" />
              </Field>
              <Field label="Contraseña inicial *" hint="Mínimo 8 caracteres. El usuario puede cambiarla luego.">
                <Input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rol *">
              <Select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}>
                {assignable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sucursal *">
              <Select name="branch_id" defaultValue={user?.branch_id ?? branches[0]?.value} required>
                {branches.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {roleOf(role)?.description || "Los permisos de este rol se definen en la pestaña «Roles y permisos»."}
          </p>

          {user && !isSelf && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="active" defaultChecked={user.active} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
              Cuenta activa (puede iniciar sesión y operar)
            </label>
          )}
          {isSelf && <input type="hidden" name="active" value="on" />}

          {/* Nivel Super: solo lo concede otro Super Administrador, y solo a administradores */}
          {user && isSuper && role === "admin" && !isSelf && (
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
              <input type="checkbox" name="is_super" defaultChecked={user.is_super} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600" />
              <span>
                <span className="font-medium text-slate-900">Super Administrador</span>
                <span className="block text-xs text-slate-500">Puede nombrar, modificar y retirar a otros administradores. Resérvalo para el dueño o el responsable de TI.</span>
              </span>
            </label>
          )}
          {isSelf && user?.is_super && <input type="hidden" name="is_super" value="on" />}

          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Crear usuario" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title="Restablecer contraseña"
        description={resetting ? `${resetting.full_name} · ${resetting.email}` : undefined}
        size="sm"
      >
        <form
          key={resetting?.id ?? "none"}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitReset(new FormData(e.currentTarget));
          }}
        >
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres. El cambio queda registrado en la auditoría.">
            <Input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" autoFocus />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResetting(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Restablecer
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
