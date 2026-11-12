"use client";

import { useActionState, useState } from "react";
import { Check, Database, KeyRound, Loader2, UserRound, X } from "lucide-react";
import { login } from "@/modules/auth/actions";

const label = "mb-1 block text-[12px] font-medium text-slate-700";
const box =
  "flex h-9 items-center overflow-hidden rounded-[3px] border border-slate-400/80 bg-white shadow-[inset_0_1px_2px_rgb(0_0_0/0.08)] focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25 dark:bg-slate-50";
const icon = "ml-2 h-4 w-4 shrink-0 text-slate-500";
const input = "h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none";
const classicButton =
  "flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border border-slate-400/80 bg-gradient-to-b from-white to-slate-200 text-[13px] font-medium text-slate-800 shadow-sm transition hover:from-slate-50 hover:to-slate-300 focus-visible:outline-2 focus-visible:outline-brand-500 active:translate-y-px disabled:cursor-wait disabled:opacity-70";

/** Ventana «Información de usuario» al estilo de los ERP de escritorio. */
export function LoginForm({ database }: { database: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  const [help, setHelp] = useState(false);

  return (
    <form action={action} className="space-y-3" onReset={() => setHelp(false)}>
      <div>
        <label htmlFor="login-email" className={label}>
          Usuario:
        </label>
        <div className={box}>
          <UserRound className={icon} />
          <input id="login-email" name="email" type="email" autoComplete="username" required autoFocus placeholder="correo@empresa.com" className={input} />
        </div>
      </div>

      <div>
        <label htmlFor="login-password" className={label}>
          Clave:
        </label>
        <div className={box}>
          <KeyRound className={icon} />
          <input id="login-password" name="password" type="password" autoComplete="current-password" required className={input} />
        </div>
      </div>

      <div>
        <label htmlFor="login-db" className={label}>
          Base de Datos:
        </label>
        <div className={box}>
          <Database className={icon} />
          <select id="login-db" disabled className="h-full min-w-0 flex-1 cursor-default appearance-none bg-transparent px-2 font-mono text-[11.5px] text-slate-700 opacity-100">
            <option>{database}</option>
          </select>
        </div>
      </div>

      {state?.error && (
        <p role="alert" className="rounded-[3px] border border-red-300 bg-red-50 px-2.5 py-2 text-[12px] font-medium text-red-700">
          {state.error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className={classicButton}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : <Check className="h-4 w-4 text-emerald-600" strokeWidth={3} />}
          {pending ? "Conectando…" : "Conectar"}
        </button>
        <button type="reset" className={classicButton}>
          <X className="h-4 w-4 text-red-600" strokeWidth={3} />
          Salir
        </button>
      </div>

      <div className="border-t border-slate-200 pt-2 text-center">
        <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className="cursor-pointer text-[11.5px] font-medium text-link hover:underline">
          ¿Olvidó su clave?
        </button>
        {help && (
          <p className="mt-1.5 text-left text-[11.5px] leading-relaxed text-slate-600">
            Un administrador puede restablecerla desde <strong className="font-semibold">General → Configuración → Usuarios</strong>. Por seguridad, las claves no se envían por correo.
          </p>
        )}
      </div>
    </form>
  );
}
