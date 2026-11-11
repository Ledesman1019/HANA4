// Genera los íconos de la PWA a partir del logotipo vectorial.
// Uso: node scripts/generate-icons.mjs
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

/** Hexágono de la marca. `pad` deja el margen de seguridad de los íconos "maskable". */
const logo = (pad, radius) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b6ef6"/>
      <stop offset="1" stop-color="#1d41d8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <path d="M256 104 L387.6 180 V332 L256 408 L124.4 332 V180 Z" fill="none" stroke="#fff" stroke-width="34" stroke-linejoin="round"/>
    <path d="M206 206 V306 M306 206 V306 M206 256 H306" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round"/>
  </g>
</svg>`;

const out = new URL("../public/icons/", import.meta.url);
await mkdir(out, { recursive: true });

const targets = [
  ["icon-192.png", 192, logo(0, 112)],
  ["icon-512.png", 512, logo(0, 112)],
  ["icon-maskable-512.png", 512, logo(0.2, 0)],
  ["apple-touch-icon.png", 180, logo(0.06, 0)],
];

for (const [name, size, svg] of targets) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, "$1").replaceAll("%20", " "));
  console.log("generado", name);
}

await writeFile(new URL("../src/app/icon.svg", import.meta.url), logo(0, 112).trim() + "\n");
console.log("generado src/app/icon.svg");
