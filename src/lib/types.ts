/** Identificador del rol (tabla `roles`). "admin" tiene acceso total. */
export type Role = string;

export type RoleRow = { id: string; name: string; description: string; is_system: boolean };

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  branch_id: string | null;
  active: boolean;
  /** Super Administrador: el único que nombra o modifica administradores */
  is_super: boolean;
  created_at: string;
};

export type Settings = {
  name: string;
  tax_id: string;
  address: string;
  phone: string;
  email: string;
  currency_code: string;
  currency_symbol: string;
  tax_name: string;
  tax_rate: number;
  timezone: string;
  receipt_footer: string;
};

export type Branch = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  active: boolean;
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia",
  credito: "Crédito",
  cheque: "Cheque",
};
