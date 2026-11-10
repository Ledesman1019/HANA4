"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { hasPermission, type Action, type ModuleKey, type Permissions } from "@/lib/modules";
import type { Branch, Profile, Settings } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";

type AppData = {
  profile: Profile;
  roleName: string;
  permissions: Permissions;
  canSwitchBranch: boolean;
  settings: Settings;
  branches: Branch[];
  branch: Branch;
};

type AppValue = AppData & {
  money: (n: number | string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  /** Solo para mostrar u ocultar controles: el servidor vuelve a verificar cada acción. */
  can: (module: ModuleKey, action: Action | "access") => boolean;
};

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ value, children }: { value: AppData; children: ReactNode }) {
  const full = useMemo<AppValue>(
    () => ({
      ...value,
      money: (n) => formatMoney(n, value.settings.currency_symbol),
      dateTime: (iso) => formatDateTime(iso, value.settings.timezone),
      can: (module, action) => hasPermission(value.profile.role, value.permissions, module, action),
    }),
    [value],
  );
  return <AppContext value={full}>{children}</AppContext>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp debe usarse dentro de AppProvider");
  return ctx;
}
