import { BarChart3, BookOpenText, Boxes, ClipboardList, FileCheck2, FileText, HandCoins, PiggyBank, Landmark, LayoutDashboard, Receipt, Settings, ShoppingCart, Truck, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  sales: Receipt,
  quotes: FileText,
  billing: FileCheck2,
  receivables: PiggyBank,
  cash: Wallet,
  customers: Users,
  inventory: Boxes,
  purchases: ClipboardList,
  suppliers: Truck,
  payables: HandCoins,
  finance: Landmark,
  ledger: BookOpenText,
  hr: UserRound,
  reports: BarChart3,
  settings: Settings,
};
