import type { Metadata } from "next";
import { BadgePercent, Boxes, ChartNoAxesCombined, CreditCard, LayoutGrid, Settings, ShoppingBag, Store, UsersRound, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { CENTRAL_NAME } from "@/lib/supabase/env";
import { LoginForm } from "@/modules/auth/components/login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

/** Módulos alrededor del monitor central: ángulo en grados (0 = derecha, 90 = abajo). */
const HUB: { icon: LucideIcon; angle: number; label: string }[] = [
  { icon: UsersRound, angle: 270, label: "Clientes" },
  { icon: BadgePercent, angle: 315, label: "Ventas" },
  { icon: Store, angle: 0, label: "Sucursales" },
  { icon: CreditCard, angle: 45, label: "Caja" },
  { icon: ShoppingBag, angle: 90, label: "Compras" },
  { icon: Settings, angle: 135, label: "Configuración" },
  { icon: ChartNoAxesCombined, angle: 180, label: "Reportes" },
  { icon: Boxes, angle: 225, label: "Inventario" },
];
const R = 40; // radio en % del diagrama

export default function LoginPage() {
  return (
    <div className="desk-bg relative flex min-h-dvh flex-col overflow-hidden text-white">
      {/* Ventana de acceso, arriba a la izquierda como en los ERP de escritorio */}
      <section
        aria-labelledby="login-title"
        className="force-light relative z-20 mx-4 mt-4 w-auto rounded-[4px] border border-white/70 bg-[#f3f5f8] text-slate-900 shadow-[0_18px_50px_-12px_rgb(0_0_0/0.55)] sm:absolute sm:left-6 sm:top-6 sm:mx-0 sm:mt-0 sm:w-80"
      >
        <h1 id="login-title" className="border-b border-slate-300 bg-gradient-to-b from-white to-slate-100 px-3 py-2 text-center text-[13px] font-semibold text-slate-800">
          Información de Usuario
        </h1>
        <div className="p-4">
          <LoginForm central={CENTRAL_NAME} />
        </div>
      </section>

      {/* Título y diagrama de módulos */}
      <div className="relative z-10 flex flex-1 flex-col items-center px-4 pb-24 pt-10 sm:pt-12">
        <p className="text-center text-2xl font-extrabold tracking-tight drop-shadow-sm [text-wrap:balance] sm:text-5xl">
          ERP HANA<span className="text-red-400">4</span> <span className="font-bold text-white/90">Empresarial</span>
        </p>

        <div aria-hidden className="relative mt-6 aspect-square w-[min(88vw,32rem)] sm:mt-10">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
            {HUB.map(({ angle }) => {
              const rad = (angle * Math.PI) / 180;
              return (
                <line
                  key={angle}
                  x1={50 + Math.cos(rad) * 15}
                  y1={50 + Math.sin(rad) * 15}
                  x2={50 + Math.cos(rad) * (R - 7)}
                  y2={50 + Math.sin(rad) * (R - 7)}
                  stroke="rgb(255 255 255 / 0.55)"
                  strokeWidth="0.35"
                  strokeDasharray="1.6 1.2"
                />
              );
            })}
          </svg>

          {HUB.map(({ icon: Icon, angle, label }) => {
            const rad = (angle * Math.PI) / 180;
            return (
              <span
                key={label}
                title={label}
                style={{ left: `${50 + Math.cos(rad) * R}%`, top: `${50 + Math.sin(rad) * R}%` }}
                className="absolute flex h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-dashed border-white/40 p-[1.5%]"
              >
                <span className="flex h-full w-full items-center justify-center rounded-lg bg-white/15 shadow-inner">
                  <Icon className="h-1/2 w-1/2" strokeWidth={1.75} />
                </span>
              </span>
            );
          })}

          {/* Monitor central */}
          <div className="absolute left-1/2 top-1/2 flex w-[30%] -translate-x-1/2 -translate-y-[58%] flex-col items-center">
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border-[3px] border-white bg-white/10">
              <LayoutGrid className="h-3/5 w-3/5" strokeWidth={1.4} />
            </div>
            <div className="h-[6%] w-[8%] min-h-2 bg-white" />
            <div className="h-1 w-1/3 rounded-full bg-white" />
            <p className="mt-2 text-[clamp(1.25rem,5vw,2.4rem)] font-extrabold leading-none tracking-tight">HANA4</p>
          </div>
        </div>
      </div>

      {/* Marca de agua */}
      <div aria-hidden className="pointer-events-none absolute bottom-5 right-6 hidden items-center gap-3 sm:flex">
        <BrandMark className="h-14 w-14 rounded-2xl p-1" />
        <div className="leading-none">
          <p className="text-4xl font-extrabold tracking-tight">
            hana<span className="text-sky-300">4</span>
          </p>
          <p className="mt-1 text-sm font-semibold text-white/80">erp empresarial</p>
        </div>
      </div>
      <p className="absolute bottom-2 left-3 text-[11px] text-white/60">Conexión segura · ERP HANA4 v1.0</p>
    </div>
  );
}
