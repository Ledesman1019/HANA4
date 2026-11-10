"use client";

import { useActionState } from "react";
import { login } from "@/modules/auth/actions";
import { Button, Field, FormError, Input } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="space-y-4">
      <Field label="Correo electrónico">
        <Input name="email" type="email" autoComplete="email" required autoFocus placeholder="tu@empresa.com" />
      </Field>
      <Field label="Contraseña">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormError message={state?.error} />
      <Button type="submit" loading={pending} className="w-full" size="lg">
        Ingresar
      </Button>
    </form>
  );
}
