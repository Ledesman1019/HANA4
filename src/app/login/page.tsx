import type { Metadata } from "next";
import { BarChart3, Boxes, ShieldCheck, ShoppingCart } from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { LoginForm } from "@/modules/auth/components/login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

const FEATURES = [
  { icon: ShoppingCart, title: "Ventas y caja", text: "Punto de venta, comprobantes y arqueo de cada turno." },
  { icon: Boxes, title: "Inventario y compras", text: "Stock por sucursal, kardex y reposición a tiempo." },
  { icon: BarChart3, title: "Finanzas y reportes", text: "Resultados, comisiones e indicadores del negocio." },
];

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Panel de marca */}
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:block">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(59,110,246,0.55),transparent_60%),radial-gradient(90%_70%_at_100%_100%,rgba(29,65,216,0.5),transparent_55%)]"
        />
        {/* Trama de puntos */}
        <div aria-hidden className="absolute inset-0 opacity-[0.18] [background-image:radial-gradient(circle,#fff_1px,transparent_1.2px)] [background-size:22px_22px]" />
        {/* Borde diagonal hacia el formulario */}
        <div aria-hidden className="absolute inset-y-0 -right-px w-28 bg-app [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
        <div aria-hidden className="absolute inset-y-0 right-0 w-28 [clip-path:polygon(100%_0,calc(100%-6px)_0,0_100%,6px_100%)] bg-brand-500" />

        <div className="relative flex h-full flex-col px-14 py-12 xl:px-20">
          <div className="flex items-center gap-3.5">
            <BrandMark className="h-14 w-14 rounded-2xl p-1.5" />
            <div>
              <p className="text-2xl font-extrabold leading-tight tracking-tight">
                HANA<span className="text-brand-500">4</span>
              </p>
              <p className="text-sm text-white/70">ERP Empresarial</p>
            </div>
          </div>

          <div className="my-auto max-w-lg py-10 pr-16">
            <h2 className="text-[2.6rem] font-extrabold leading-[1.1] tracking-tight">
              Todo tu negocio,
              <br />
              <span className="text-brand-500">en un solo lugar</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/75">Conectando procesos, impulsando tu negocio: cada venta actualiza inventario, caja, finanzas y comisiones al instante.</p>

            <ul className="mt-10 space-y-5">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-bold">{f.title}</span>
                    <span className="block text-sm text-white/65">{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/45">© HANA4 · ERP Empresarial</p>
        </div>
      </aside>

      {/* Formulario */}
      <main className="flex min-h-dvh flex-col bg-app px-5 py-6 sm:px-10">
        <div className="flex items-center justify-end gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            Acceso seguro al sistema
          </span>
          <ThemeToggle className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/70 hover:text-slate-900" />
        </div>

        <div className="m-auto w-full max-w-[30rem] py-8">
          {/* En pantallas pequeñas el logo va aquí (el panel de marca se oculta) */}
          <div className="mb-6 flex justify-center lg:hidden">
            <span className="rounded-2xl bg-white px-5 py-3 shadow-xs ring-1 ring-black/5">
              <BrandLogo className="w-52" />
            </span>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-surface p-7 shadow-pop sm:p-11">
            <span aria-hidden className="block h-1 w-12 rounded-full bg-brand-600" />
            <h1 className="mt-7 text-3xl font-extrabold tracking-tight text-slate-900">Iniciar sesión</h1>
            <p className="mb-8 mt-2.5 text-[15px] leading-relaxed text-slate-500">Ingrese sus credenciales para acceder al sistema de gestión de la empresa.</p>
            <LoginForm />
            <p className="mt-7 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">¿No tiene cuenta? Solicítela al administrador del sistema.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
