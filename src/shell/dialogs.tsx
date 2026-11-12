"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Building2, KeyRound, Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { changePassword, setBranch } from "@/modules/auth/actions";
import { playSound, setSoundEnabled, soundEnabled, subscribeSound } from "@/lib/sound";
import { CENTRAL_NAME } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { InstallAppButton } from "@/components/pwa";
import { toggleTheme, useIsDark } from "@/components/theme";
import { Button, Field, FormError, Input } from "@/components/ui";
import { BrandMark } from "@/components/brand";
import type { SapModule } from "./menu";

const row = "flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-0";
const choice = (on: boolean) =>
  cn(
    "flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
    on ? "border-brand-500 bg-brand-50 text-link" : "border-slate-300 bg-surface text-slate-600 hover:bg-slate-50",
  );

export function PreferencesDialog({ open, onClose, onPassword }: { open: boolean; onClose: () => void; onPassword: () => void }) {
  const { branch, branches, canSwitchBranch } = useApp();
  const dark = useIsDark();
  const soundOn = useSyncExternalStore(subscribeSound, soundEnabled, () => true);
  const [switching, startSwitch] = useTransition();

  return (
    <Dialog open={open} onClose={onClose} title="Preferencias de estación de trabajo" size="md">
      <div>
        <div className={row}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Apariencia</p>
            <p className="text-xs text-slate-500">Se guarda en este equipo.</p>
          </div>
          <div className="flex gap-1.5">
            <button type="button" className={choice(!dark)} onClick={() => dark && toggleTheme()} aria-pressed={!dark}>
              <Sun className="h-4 w-4" /> Claro
            </button>
            <button type="button" className={choice(dark)} onClick={() => !dark && toggleTheme()} aria-pressed={dark}>
              <Moon className="h-4 w-4" /> Oscuro
            </button>
          </div>
        </div>

        <div className={row}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Sonido de avisos</p>
            <p className="text-xs text-slate-500">Suena cuando aparece un aviso nuevo.</p>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              className={choice(soundOn)}
              aria-pressed={soundOn}
              onClick={() => {
                setSoundEnabled(true);
                playSound("notify", { force: true });
              }}
            >
              <Volume2 className="h-4 w-4" /> Activo
            </button>
            <button type="button" className={choice(!soundOn)} aria-pressed={!soundOn} onClick={() => setSoundEnabled(false)}>
              <VolumeX className="h-4 w-4" /> Silencio
            </button>
          </div>
        </div>

        <div className={row}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Sucursal de trabajo</p>
            <p className="text-xs text-slate-500">Ventas, caja y stock se registran aquí.</p>
          </div>
          {canSwitchBranch && branches.length > 1 ? (
            <label className={cn("relative", switching && "opacity-60")}>
              <span className="sr-only">Sucursal</span>
              <Building2 className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={branch.id}
                disabled={switching}
                onChange={(e) => {
                  const id = e.target.value;
                  startSwitch(() => setBranch(id));
                }}
                className="h-9 max-w-52 cursor-pointer rounded-md border border-slate-300 bg-surface pl-8 pr-2 text-sm text-slate-800"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-sm font-medium text-slate-700">{branch.name}</span>
          )}
        </div>

        <div className={row}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Seguridad</p>
            <p className="text-xs text-slate-500">Cambia tu clave de acceso.</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              onPassword();
            }}
          >
            <KeyRound className="h-4 w-4" />
            Cambiar clave
          </Button>
        </div>

        <div className={row}>
          <div>
            <p className="text-sm font-semibold text-slate-900">Aplicación</p>
            <p className="text-xs text-slate-500">Instálala para abrirla como programa de escritorio.</p>
          </div>
          <InstallAppButton className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Aceptar</Button>
      </DialogFooter>
    </Dialog>
  );
}

export function AboutDialog({ open, onClose, menu }: { open: boolean; onClose: () => void; menu: SapModule[] }) {
  const { profile, roleName, branch, settings } = useApp();
  const facts: [string, string][] = [
    ["Empresa", settings.name + (settings.tax_id ? ` · RUC ${settings.tax_id}` : "")],
    ["Usuario", `${profile.full_name} (${roleName})`],
    ["Sucursal", `${branch.code} · ${branch.name}`],
    ["Central", CENTRAL_NAME],
    ["Versión", "ERP HANA4 1.0"],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Acerca de ERP HANA4" size="md">
      <div className="flex items-center gap-4">
        <BrandMark className="h-16 w-16 rounded-2xl p-1.5" />
        <div>
          <p className="text-xl font-extrabold tracking-tight text-slate-900">
            ERP HANA<span className="text-brand-600">4</span>
          </p>
          <p className="text-sm text-slate-500">Sistema de gestión empresarial para retail, organizado según los módulos de SAP.</p>
        </div>
      </div>
      <dl className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {facts.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-3.5 py-2 text-sm">
            <dt className="text-slate-500">{k}</dt>
            <dd className="truncate font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">Módulos habilitados para tu rol</p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {menu.map((m) => (
          <li key={m.key} className="flex items-center gap-2.5 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span className="w-12 font-mono text-xs font-bold text-link">{m.code}</span>
            <span className="text-slate-700">{m.name}</span>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button onClick={onClose}>Cerrar</Button>
      </DialogFooter>
    </Dialog>
  );
}

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onClose={onClose} title="Cambiar clave" size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const next = String(form.get("next") ?? "");
          if (next !== String(form.get("repeat") ?? "")) return setError("Las claves nuevas no coinciden");
          setError(null);
          startTransition(async () => {
            const res = await changePassword(String(form.get("current") ?? ""), next);
            if (!res.ok) return setError(res.error ?? "No se pudo cambiar la clave");
            toast.success("Clave actualizada");
            onClose();
          });
        }}
      >
        <Field label="Clave actual">
          <Input name="current" type="password" required autoComplete="current-password" autoFocus />
        </Field>
        <Field label="Nueva clave" hint="Mínimo 8 caracteres.">
          <Input name="next" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
        </Field>
        <Field label="Repite la nueva clave">
          <Input name="repeat" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
        </Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending}>
            Guardar
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
