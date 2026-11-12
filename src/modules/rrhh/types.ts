/** Tipos y estados propios del módulo rrhh. */

export type Employee = {
  id: string;
  branch_id: string | null;
  doc_number: string;
  full_name: string;
  position: string;
  email: string;
  phone: string;
  salary: number;
  /** Usuario del sistema del colaborador: sus ventas le generan comisión */
  profile_id: string | null;
  /** % de comisión sobre la venta neta */
  commission_rate: number;
  hire_date: string;
  status: "activo" | "vacaciones" | "licencia" | "cesado";
};
