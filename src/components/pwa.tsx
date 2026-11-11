"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Download, WifiOff } from "lucide-react";
import { primeSound } from "@/lib/sound";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// El navegador entrega el evento de instalación una sola vez: se guarda aquí.
let installEvent: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribeInstall(onChange: () => void) {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Registra el service worker, prepara el audio y captura la oferta de instalación. */
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installEvent = e as InstallEvent;
      notify();
    };
    const onInstalled = () => {
      installEvent = null;
      notify();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const releaseSound = primeSound();
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      releaseSound();
    };
  }, []);

  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;

  return (
    <div role="status" className="no-print fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center gap-2 bg-amber-600 px-4 py-2 text-sm font-medium text-white dark:text-slate-50">
      <WifiOff className="h-4 w-4" />
      Sin conexión. Los cambios no se guardarán hasta que vuelva internet.
    </div>
  );
}

/** Opción "Instalar aplicación": solo aparece cuando el navegador lo permite. */
export function InstallAppButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const available = useSyncExternalStore(
    subscribeInstall,
    () => installEvent !== null,
    () => false,
  );
  if (!available) return null;

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const event = installEvent;
        if (!event) return;
        await event.prompt();
        await event.userChoice.catch(() => null);
        installEvent = null;
        notify();
        onDone?.();
      }}
    >
      <Download className="h-4 w-4 text-slate-400" />
      Instalar aplicación
    </button>
  );
}
