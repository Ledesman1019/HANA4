import { NextResponse } from "next/server";
import { loadContext } from "@/lib/auth";
import { computeAlerts } from "@/shell/alerts";

/** Avisos de la campana (barra inferior). */
export async function GET() {
  const ctx = await loadContext();
  if (ctx.status !== "ok") return NextResponse.json({ items: [] }, { status: 401 });
  return NextResponse.json({ items: await computeAlerts(ctx) }, { headers: { "Cache-Control": "private, no-store" } });
}
