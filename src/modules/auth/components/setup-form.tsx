"use client";

import { useActionState } from "react";
import { createFirstAdmin } from "@/modules/auth/actions";
import { Button, Field, FormError, Input } from "@/components/ui";

export function SetupForm() {
  const [state, action, pending] = useActionState(createFirstAdmin, undefined);

  return (
    <form action={action} className="space-y-4">
      <Field label="Nombre de la empresa">
        <Input name="company" required minLength={2} maxLength={120} placeholder="Comercial Los Andes S.A.C." autoFocus />
      </Field>
      <Field label="Tu nombre completo">
        <Input name="full_name" required minLength={3} maxLength={120} autoComplete="name" />
      </Field>
      <Field label="Correo electrónico">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Contraseña" hint="Mínimo 8 caracteres.">
        <Input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
      </Field>
      <FormError message={state?.error} />
      <Button type="submit" loading={pending} className="w-full" size="lg">
        Crear cuenta de administrador
      </Button>
    </form>
  );
}
