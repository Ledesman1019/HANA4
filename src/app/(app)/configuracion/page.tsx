import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import { CompanyForm } from "@/modules/configuracion/components/company-form";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const { settings, can } = await requireAccess("configuracion", "view");
  return <CompanyForm settings={settings} readOnly={!can("configuracion", "edit")} />;
}
