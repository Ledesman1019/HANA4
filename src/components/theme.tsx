"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Toaster } from "sonner";

import { THEME_KEY as KEY } from "@/lib/theme-script";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useIsDark() {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

export function toggleTheme() {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(KEY, dark ? "dark" : "light");
  } catch {
    // Sin almacenamiento (modo privado): el tema dura lo que dure la pestaña.
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useIsDark();
  const label = dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  return (
    <button type="button" onClick={toggleTheme} title={label} aria-label={label} className={className}>
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

export function ThemedToaster() {
  const dark = useIsDark();
  return <Toaster position="top-right" richColors closeButton theme={dark ? "dark" : "light"} />;
}
