import { BarChart3, Boxes, ClipboardList, Landmark, LayoutDashboard, Receipt, Settings, ShoppingCart, Truck, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  sales: Receipt,
  cash: Wallet,
  customers: Users,
  inventory: Boxes,
  purchases: ClipboardList,
  suppliers: Truck,
  finance: Landmark,
  hr: UserRound,
  reports: BarChart3,
  settings: Settings,
};
