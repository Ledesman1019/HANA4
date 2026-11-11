const UNITS = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE"];
const TWENTIES = ["", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const TENS = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const HUNDREDS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

/** 1–999 en letras */
function hundreds(n: number): string {
  if (n === 100) return "CIEN";
  const parts: string[] = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest > 0 && rest <= 20) parts.push(UNITS[rest]);
  else if (rest > 20 && rest < 30) parts.push(TWENTIES[rest - 20]);
  else if (rest >= 30) parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? ` Y ${UNITS[rest % 10]}` : ""));
  return parts.join(" ");
}

/** "UNO" se apocopa antes de "MIL", "MILLONES" o del nombre de la moneda */
const apocope = (text: string) => text.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");

function integerWords(n: number): string {
  if (n === 0) return "CERO";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions === 1) parts.push("UN MILLÓN");
  else if (millions > 1) parts.push(`${apocope(integerWords(millions))} MILLONES`);
  if (thousands === 1) parts.push("MIL");
  else if (thousands > 1) parts.push(`${apocope(hundreds(thousands))} MIL`);
  if (rest > 0) parts.push(hundreds(rest));
  return parts.join(" ");
}

/**
 * Importe en letras, como exige el comprobante impreso:
 * 1234.5 → "MIL DOSCIENTOS TREINTA Y CUATRO CON 50/100 SOLES"
 */
export function amountInWords(amount: number, currency = "SOLES") {
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${apocope(integerWords(whole))} CON ${fraction}/100 ${currency}`;
}
