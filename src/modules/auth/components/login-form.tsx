"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, LogIn, Mail } from "lucide-react";
import { login } from "@/modules/auth/actions";

const field =
  "flex h-12 overflow-hidden rounded-xl border border-slate-300 bg-surface shadow-xs transition-colors focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15";
const prefix = "flex w-12 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50 text-slate-400";
const input = "min-w-0 flex-1 bg-transparent px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);

  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="login-email" className="mb-1.5 block text-sm font-semibold text-slate-800">
          Correo electrónico
        </label>
        <div className={field}>
          <span className={prefix}>
            <Mail className="h-[18px] w-[18px]" />
          </span>
          <input id="login-email" name="email" type="email" autoComplete="email" required autoFocus placeholder="nombre@empresa.com" className={input} />
        </div>
      </div>

      <div>
        <label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold text-slate-800">
          Contraseña
        </label>
        <div className={field}>
          <span className={prefix}>
            <Lock className="h-[18px] w-[18px]" />
          </span>
          <input id="login-password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required placeholder="Su contraseña" className={input} />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={show}
            className="flex w-12 shrink-0 cursor-pointer items-center justify-center border-l border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
          >
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <div className="mt-2 text-right">
          <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className="cursor-pointer text-sm font-semibold text-link hover:underline">
            ¿Olvidó su contraseña?
          </button>
        </div>
        {help && (
          <p className="mt-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600">
            Pídale a un administrador que la restablezca desde <strong className="font-semibold text-slate-800">Configuración → Usuarios</strong>. Por seguridad, las contraseñas no se envían
            por correo.
          </p>
        )}
      </div>

      {state?.error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex h-13 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-gradient-to-b from-brand-500 to-brand-700 text-base font-bold text-white shadow-lg shadow-brand-600/30 transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
        {pending ? "Ingresando…" : "Ingresar"}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </button>
    </form>
  );
}
