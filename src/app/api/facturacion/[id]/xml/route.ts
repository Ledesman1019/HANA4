import { NextResponse, type NextRequest } from "next/server";
import { loadContext } from "@/lib/auth";
import { loadBillingDocument } from "@/modules/facturacion/service";
import { buildXml } from "@/modules/facturacion/xml";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Descarga el XML del comprobante (RLS decide si el usuario puede verlo). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadContext();
  if (ctx.status !== "ok") return new NextResponse("No autorizado", { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("No encontrado", { status: 404 });

  const loaded = await loadBillingDocument(ctx, id);
  if (!loaded) return new NextResponse("No encontrado", { status: 404 });

  const name = `${ctx.settings.tax_id || "00000000000"}-${loaded.doc.number}.xml`.replace(/[^\w.-]/g, "");
  return new NextResponse(buildXml(loaded.billing), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
