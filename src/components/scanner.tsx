"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";
import { playSound } from "@/lib/sound";
import { Dialog } from "./dialog";
import { Button, Input } from "./ui";

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const REPEAT_MS = 1500;

function beep() {
  playSound("scan");
  navigator.vibrate?.(60);
}

/**
 * Lector de códigos por cámara. Usa el detector nativo del navegador cuando
 * existe (Chrome, Edge, Android) y, si no, carga ZXing bajo demanda.
 */
function ScannerView({ onDetect }: { onDetect: (code: string) => string | void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectRef = useRef(onDetect);
  const [state, setState] = useState<"starting" | "ready" | "error">("starting");
  const [message, setMessage] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopZxing: (() => void) | null = null;
    let lastCode = "";
    let lastAt = 0;

    const handle = (raw: string) => {
      const code = raw.trim();
      const now = Date.now();
      if (!code || (code === lastCode && now - lastAt < REPEAT_MS)) return;
      lastCode = code;
      lastAt = now;
      beep();
      const feedback = onDetectRef.current(code);
      setLast(feedback || code);
    };

    async function start() {
      const video = videoRef.current;
      if (!video) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage("Este navegador no permite usar la cámara. Abre el sistema con HTTPS en Chrome, Edge o Safari.");
        return setState("error");
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        setState("ready");

        const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
        if (Native) {
          const detector = new Native({ formats: FORMATS });
          let busy = false;
          let lastRun = 0;
          const tick = (time: number) => {
            if (stopped) return;
            frame = requestAnimationFrame(tick);
            if (busy || time - lastRun < 110 || video.readyState < 2) return;
            busy = true;
            lastRun = time;
            detector
              .detect(video)
              .then((codes) => codes[0] && handle(codes[0].rawValue))
              .catch(() => {})
              .finally(() => {
                busy = false;
              });
          };
          frame = requestAnimationFrame(tick);
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const controls = await new BrowserMultiFormatReader().decodeFromVideoElement(video, (result) => {
            if (result) handle(result.getText());
          });
          stopZxing = () => controls.stop();
          if (stopped) controls.stop();
        }
      } catch (e) {
        if (stopped) return;
        const name = (e as DOMException)?.name;
        setMessage(
          name === "NotAllowedError"
            ? "No hay permiso para usar la cámara. Actívalo en el candado de la barra de direcciones y vuelve a intentar."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No se encontró ninguna cámara en este equipo."
              : "No se pudo iniciar la cámara. Cierra otras aplicaciones que la estén usando.",
        );
        setState("error");
      }
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {state === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
            <Loader2 className="h-6 w-6 animate-spin" />
            Iniciando cámara…
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white/85">
            <CameraOff className="h-7 w-7" />
            {message}
          </div>
        )}
        {state === "ready" && (
          <div className="pointer-events-none absolute inset-x-[10%] inset-y-[24%] rounded-xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)]">
            <div className="absolute inset-0 overflow-hidden rounded-[10px]">
              <div className="h-full w-full [animation:scan-line_2.2s_ease-in-out_infinite]">
                <div className="h-0.5 w-full bg-red-500/90 shadow-[0_0_10px_2px_rgb(239_68_68/0.7)]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <p aria-live="polite" className="min-h-5 text-center text-sm">
        {last ? <span className="font-medium text-emerald-700">✓ {last}</span> : <span className="text-slate-500">Centra el código de barras dentro del recuadro.</span>}
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!manual.trim()) return;
          const feedback = onDetectRef.current(manual.trim());
          setLast(feedback || manual.trim());
          setManual("");
        }}
      >
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="O escribe el código manualmente" aria-label="Código manual" inputMode="numeric" className="tabular" />
        <Button type="submit" variant="secondary">
          Agregar
        </Button>
      </form>
    </div>
  );
}

export function ScannerDialog({ open, onClose, onDetect, title = "Escanear código" }: { open: boolean; onClose: () => void; onDetect: (code: string) => string | void; title?: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description="Puedes escanear varios productos seguidos." size="md">
      <ScannerView onDetect={onDetect} />
    </Dialog>
  );
}
