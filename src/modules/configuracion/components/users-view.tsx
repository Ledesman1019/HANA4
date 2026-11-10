"use client";

import { useState, useTransition } from "react";
import { Pencil, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Select, Table, Td, Th } from "@/components/ui";
import type { Profile, RoleRow } from "@/lib/types";
import { createUser, updateUser } from "@/modules/configuracion/actions";

type Option = { value: string; label: string };

export function UsersView({ rows, roles, currentUserId, isAdmin, branches }: { rows: Profile[]; roles: RoleRow[]; currentUserId: string; isAdmin: boolean; branches: Option[] }) {
  const { can } = useApp();
  const canEdit = can("configuracion", "edit");
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const [role, setRole] = useState("cajero");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const roleOf = (id: string) => roles.find((r) => r.id === id);
  const branchName = (id: string | null) => branches.find((b) => b.value === id)?.label ?? "—";
  const isNew = editing === "new";
  const user = editing && editing !== "new" ? editing : null;
  const activeAdmins = rows.filter((u) => u.role === "admin" && u.active).length;
  // Solo un administrador concede el rol de administrador
  const assignable = roles.filter((r) => r.id !== "admin" || isAdmin);

  function open(target: Profile | "new") {
    setRole(target === "new" ? "cajero" : target.role);
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
          })
        : await createUser({ ...Object.fromEntries(form), role });
      if (!res.ok) return setError(res.error);
      toast.success(user ? "Usuario actualizado" : "Usuario creado. Ya puede iniciar sesión");
      setEditing(null);
    });
  }

  return (
    <>
      {activeAdmins < 2 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong className="font-semibold">Hay un solo administrador.</strong> Si esa persona pierde su acceso, nadie más podrá gestionar usuarios ni permisos. Asigna el rol
            Administrador a una segunda persona de confianza.
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          title="Usuarios del sistema"
          description="No existe auto-registro: las cuentas se crean aquí y cada una hereda los permisos de su rol."
          action={
            canEdit ? (
              <Button onClick={() => open("new")}>
                <UserPlus className="h-4 w-4" />
                Nuevo usuario
              </Button>
            ) : undefined
          }
        />
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
            {rows.map((u) => (
              <tr key={u.id} className={u.active ? "transition-colors hover:bg-slate-50/70" : "opacity-55"}>
                <Td>
                  <p className="font-medium text-slate-900">
                    {u.full_name} {u.id === currentUserId && <span className="text-xs font-normal text-slate-500">(tú)</span>}
                  </p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </Td>
                <Td>
                  <Badge tone={u.role === "admin" ? "blue" : "neutral"}>{roleOf(u.role)?.name ?? u.role}</Badge>
                </Td>
                <Td>{branchName(u.branch_id)}</Td>
                <Td>
                  <Badge tone={u.active ? "green" : "red"}>{u.active ? "Activo" : "Sin acceso"}</Badge>
                </Td>
                {canEdit && (
                  <Td className="text-right">
                    {/* Un administrador solo puede ser editado por otro administrador */}
                    {(u.role !== "admin" || isAdmin) && (
                      <Button variant="ghost" size="icon" aria-label={`Editar ${u.full_name}`} title="Editar" onClick={() => open(u)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
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
              <Select value={role} onChange={(e) => setRole(e.target.value)} disabled={user?.id === currentUserId}>
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
          {user && user.id !== currentUserId && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="active" defaultChecked={user.active} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
              Cuenta activa (puede iniciar sesión y operar)
            </label>
          )}
          {user?.id === currentUserId && <input type="hidden" name="active" value="on" />}
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
    </>
  );
}
