"use client";

import { useSyncExternalStore } from "react";
import type { MenuContext } from "./menu";

/**
 * Recuerda en la pestaña del navegador desde qué módulo y área se abrió la
 * pantalla actual, para que «Atrás» y la barra vuelvan a esa misma área.
 */
const KEY = "hana4:menu-context";
const EVENT = "hana4:menu-context";

export function setMenuContext(module: string, area: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ module, area }));
  } catch {
    // Sin almacenamiento: se usa la ubicación por defecto del menú
  }
  window.dispatchEvent(new Event(EVENT));
}

function read() {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useMenuContext(): MenuContext {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { module?: unknown; area?: unknown };
    return typeof v.module === "string" && typeof v.area === "string" ? { module: v.module, area: v.area } : null;
  } catch {
    return null;
  }
}
