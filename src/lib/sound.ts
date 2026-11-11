/**
 * Sonidos de la interfaz, generados con Web Audio (sin archivos que cargar).
 * Solo se usa en el navegador.
 */

const KEY = "hana4-sound";
const EVENT = "hana4-sound-change";

type Tone = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number };

const SOUNDS: Record<string, Tone[]> = {
  // Aviso: dos campanadas ascendentes
  notify: [
    { freq: 880, at: 0, dur: 0.16 },
    { freq: 1174.7, at: 0.13, dur: 0.3 },
  ],
  // Venta registrada: arpegio breve
  success: [
    { freq: 659.3, at: 0, dur: 0.1 },
    { freq: 880, at: 0.08, dur: 0.1 },
    { freq: 1318.5, at: 0.16, dur: 0.26 },
  ],
  error: [
    { freq: 196, at: 0, dur: 0.14, type: "triangle", gain: 0.16 },
    { freq: 155.6, at: 0.13, dur: 0.22, type: "triangle", gain: 0.16 },
  ],
  // Lectura de código de barras
  scan: [{ freq: 1046.5, at: 0, dur: 0.09, type: "square", gain: 0.05 }],
};

export type SoundName = keyof typeof SOUNDS;

let ctx: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Los navegadores bloquean el audio hasta la primera interacción. Esto lo
 * desbloquea en el primer clic o tecla para que los avisos posteriores suenen.
 */
export function primeSound() {
  const unlock = () => void audio()?.resume().catch(() => {});
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export function soundEnabled() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Sin almacenamiento: la preferencia dura lo que dure la pestaña.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSound(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function playSound(name: SoundName, { force = false } = {}) {
  if (!force && !soundEnabled()) return;
  const ac = audio();
  if (!ac || ac.state === "suspended") {
    void ac?.resume().catch(() => {});
    if (!ac || ac.state !== "running") return;
  }
  const now = ac.currentTime + 0.01;
  for (const tone of SOUNDS[name]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const peak = tone.gain ?? 0.14;
    osc.type = tone.type ?? "sine";
    osc.frequency.value = tone.freq;
    // Ataque rápido y caída suave: suena a campana, no a pitido
    gain.gain.setValueAtTime(0.0001, now + tone.at);
    gain.gain.exponentialRampToValueAtTime(peak, now + tone.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + tone.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(now + tone.at);
    osc.stop(now + tone.at + tone.dur + 0.02);
  }
}
