import type { Metadata } from "next";
import { param } from "@/components/filters";
import { Launcher } from "@/shell/launcher";

export const metadata: Metadata = { title: "Inicio" };

/** Inicio: módulos SAP en mosaicos (?m=mm) y, dentro, las funciones de cada área (?a=compras). */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  return <Launcher moduleKey={param(sp.m) || undefined} areaKey={param(sp.a) || undefined} />;
}
