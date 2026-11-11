import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ERP HANA4",
    short_name: "HANA4",
    description: "Ventas, inventario, compras, caja, finanzas y personal para retail.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "es",
    background_color: "#0e1321",
    theme_color: "#0e1321",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Accesos directos al mantener presionado el ícono de la app
    shortcuts: [
      { name: "Punto de venta", short_name: "Vender", url: "/pos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Inventario", url: "/inventario", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Caja", url: "/caja", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
