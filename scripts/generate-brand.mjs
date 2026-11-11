// Genera las imágenes de marca y los íconos de la PWA a partir del logo original.
// Uso: node scripts/generate-brand.mjs
import { mkdir, rm } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "assets/brand/logo-original.png"; // 1536×1024, fondo transparente
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

await mkdir("public/brand", { recursive: true });
await mkdir("public/icons", { recursive: true });

// Logo completo, recortado a su contenido (para fondos claros)
await sharp(SOURCE).trim().resize({ width: 720 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile("public/brand/logo.png");

// Símbolo: la «H» con las barras y la órbita (zona izquierda del logo)
// La punta de la órbita se cruza con la «H» de HANA: en esa franja se conserva
// solo el azul brillante de la órbita y se borra el azul marino de la letra.
const REGION = { left: 30, top: 200, width: 610, height: 385 };
const LETTER_FROM = 498; // x (dentro de la región) donde empieza la letra
const { data, info } = await sharp(SOURCE).extract(REGION).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let y = 0; y < info.height; y++) {
  // Bajo el trazo superior de la «H» del símbolo, la letra vecina empieza un poco antes
  for (let x = y > 160 ? LETTER_FROM - 22 : LETTER_FROM; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 2] < 150) data[i + 3] = 0;
  }
}
const mark = await sharp(data, { raw: info }).trim().png().toBuffer();
await sharp(mark).resize({ width: 256, height: 256, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile("public/brand/mark.png");

/** Ícono cuadrado: símbolo centrado sobre blanco. `scale` = cuánto del lienzo ocupa. */
async function icon(file, size, scale, radius) {
  const inner = Math.round(size * scale);
  const logo = await sharp(mark).resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  let image = sharp({ create: { width: size, height: size, channels: 4, background: WHITE } }).composite([{ input: logo, gravity: "center" }]);
  if (radius) {
    const flat = await image.png().toBuffer();
    const maskSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
    image = sharp(flat).composite([{ input: maskSvg, blend: "dest-in" }]);
  }
  await image.png({ compressionLevel: 9 }).toFile(file);
  console.log("generado", file);
}

await icon("public/icons/icon-192.png", 192, 0.82, 42);
await icon("public/icons/icon-512.png", 512, 0.82, 112);
// "Maskable": el sistema recorta el borde, así que el símbolo va más pequeño
await icon("public/icons/icon-maskable-512.png", 512, 0.6, 0);
await icon("public/icons/apple-touch-icon.png", 180, 0.78, 0);
// Ícono de la pestaña del navegador
await icon("src/app/icon.png", 96, 0.9, 20);
await rm("src/app/icon.svg", { force: true });

console.log("generado public/brand/logo.png y public/brand/mark.png");
