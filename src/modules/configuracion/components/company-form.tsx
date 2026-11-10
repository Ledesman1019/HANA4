"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, Card, CardHeader, Field, FormError, Input } from "@/components/ui";
import { updateSettings } from "@/modules/configuracion/actions";
import type { Settings } from "@/lib/types";

export function CompanyForm({ settings, readOnly }: { settings: Settings; readOnly: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="max-w-3xl">
      <CardHeader title="Datos de la empresa" description="Aparecen en los comprobantes y en todo el sistema." />
      <form
        className="p-5"
        inert={readOnly}
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          setError(null);
          startTransition(async () => {
            const res = await updateSettings(values);
            if (!res.ok) return setError(res.error);
            toast.success("Configuración guardada");
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Razón social o nombre comercial *" className="sm:col-span-2">
            <Input name="name" defaultValue={settings.name} required minLength={2} maxLength={120} />
          </Field>
          <Field label="RUC">
            <Input name="tax_id" defaultValue={settings.tax_id} maxLength={11} inputMode="numeric" pattern="\d{11}" title="11 dígitos" />
          </Field>
          <Field label="Teléfono">
            <Input name="phone" type="tel" defaultValue={settings.phone} maxLength={30} />
          </Field>
          <Field label="Dirección fiscal" className="sm:col-span-2">
            <Input name="address" defaultValue={settings.address} maxLength={200} />
          </Field>
          <Field label="Correo de contacto" className="sm:col-span-2">
            <Input name="email" type="email" defaultValue={settings.email} />
          </Field>
        </div>

        <h3 className="mb-3 mt-7 text-sm font-semibold text-slate-900">Moneda e impuestos</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Símbolo de moneda *">
            <Input name="currency_symbol" defaultValue={settings.currency_symbol} required maxLength={5} />
          </Field>
          <Field label="Nombre del impuesto *">
            <Input name="tax_name" defaultValue={settings.tax_name} required maxLength={10} />
          </Field>
          <Field label="Tasa (%) *" hint="Los precios de venta ya la incluyen.">
            <Input name="tax_rate" type="number" min={0} max={50} step="0.01" defaultValue={Number(settings.tax_rate)} required />
          </Field>
          <Field label="Mensaje al pie del comprobante" className="sm:col-span-3">
            <Input name="receipt_footer" defaultValue={settings.receipt_footer} maxLength={200} />
          </Field>
        </div>

        <div className="mt-4">
          <FormError message={error} />
        </div>
        {!readOnly && (
          <div className="mt-5 flex justify-end">
            <Button type="submit" loading={pending}>
              Guardar cambios
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
