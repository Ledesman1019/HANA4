import type { Metadata, Viewport } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { ThemedToaster } from "@/components/theme";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "ERP HANA4", template: "%s · ERP HANA4" },
  description: "ERP HANA4: ventas, inventario, compras, caja, finanzas y personal para retail.",
  robots: { index: false, follow: false },
  applicationName: "ERP HANA4",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: el script de tema añade la clase "dark" antes de hidratar.
    <html lang="es" className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {children}
        <ThemedToaster />
      </body>
    </html>
  );
}
