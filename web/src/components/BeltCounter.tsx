"use client";

import { useEffect, useRef, useState } from "react";
import { revolutionsFrom } from "@/lib/treadmill";
import { buttonClass, primaryButtonClass } from "@/components/ui/controls";

/* Räknar varv på ett löpband: tidpunkterna då kritstrecket passerar
 * (2026-11-28). Två sätt, samma utdata — räkningen sker i lib/treadmill.ts.
 *
 * KNACKA. En stor knapp; man knackar varje gång strecket passerar. Det enda
 * som kräver något av en är att inte tappa takten, och ett missat varv
 * eller en dubbelknack rättas av räkningen.
 *
 * KAMERA. Telefonen står still och filmar bandet. Man trycker där strecket
 * passerar, och appen läser ljusstyrkan i en smal remsa genom den punkten,
 * i bandets rörelseriktning. Varje position i remsan jämförs med sin egen
 * bakgrund (ett långsamt medelvärde), så att ramen, motorkåpan och bandets
 * mönster inte räknas — bara det som skiljer sig från det vanliga, alltså
 * strecket.
 *
 * Varför en remsa och inte en punkt: vid 20 km/h flyttar sig bandet 18 cm
 * mellan två bilder i 30 bilder/s. Ett streck på 5 cm hoppar då förbi en
 * punkt utan att någonsin synas i den. I en remsa som är längre än så syns
 * det i minst en bild per varv.
 *
 * FALLGROP: kameran ger inte alltid den bildfrekvens man ber om, och i
 * dåligt ljus sänker telefonen den själv. Bildfrekvensen visas därför, och
 * under 20 bilder/s varnar vyn. */

const MIN_SECONDS = 30;
const MIN_REVS = 15;

export function BeltCounter({
  onDone,
  onCancel,
  method,
}: {
  onDone: (times: number[], method: "kamera" | "knack") => void;
  onCancel: () => void;
  method: "kamera" | "knack";
}) {
  return method === "knack" ? (
    <TapCounter onDone={(t) => onDone(t, "knack")} onCancel={onCancel} />
  ) : (
    <CameraCounter onDone={(t) => onDone(t, "kamera")} onCancel={onCancel} />
  );
}

function Progress({ times }: { times: number[] }) {
  const r = revolutionsFrom(times);
  const secs = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  return (
    <div className="tabular flex justify-between text-sm text-[var(--ink-2)]">
      <span>{r ? `${r.revs} varv` : `${Math.max(0, times.length - 1)} varv`}</span>
      <span>{Math.round(secs)} s</span>
      <span>{r ? `${r.period.toFixed(2).replace(".", ",")} s/varv` : "–"}</span>
    </div>
  );
}

function ready(times: number[]) {
  const r = revolutionsFrom(times);
  return r != null && r.revs >= MIN_REVS && r.seconds >= MIN_SECONDS;
}

function TapCounter({ onDone, onCancel }: { onDone: (t: number[]) => void; onCancel: () => void }) {
  const [times, setTimes] = useState<number[]>([]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--ink-2)]">
        Knacka varje gång strecket passerar samma ställe, till exempel bandets bakkant. Fortsätt i minst{" "}
        {MIN_SECONDS} sekunder.
      </p>
      <button
        type="button"
        // pointerdown, inte click: click kommer först när fingret lyfts, och
        // den fördröjningen varierar från knack till knack.
        onPointerDown={(e) => {
          e.preventDefault();
          const t = e.timeStamp / 1000;
          setTimes((prev) => [...prev, t]);
        }}
        className="flex h-[42vh] min-h-56 w-full touch-manipulation items-center justify-center rounded-[14px] bg-[var(--surface-raised)] text-xl font-semibold text-[var(--foreground)] select-none active:bg-[var(--line)]"
      >
        {times.length === 0 ? "Knacka här" : times.length}
      </button>
      <Progress times={times} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButtonClass} disabled={!ready(times)} onClick={() => onDone(times)} style={{ opacity: ready(times) ? 1 : 0.4 }}>
          Klar
        </button>
        <button type="button" className={buttonClass} onClick={() => setTimes([])}>
          Börja om
        </button>
        <button type="button" className={buttonClass} onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

type Dir = "vertical" | "horizontal";

function CameraCounter({ onDone, onCancel }: { onDone: (t: number[]) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const plotRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [dir, setDir] = useState<Dir>("vertical");
  const [times, setTimes] = useState<number[]>([]);
  const [fps, setFps] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  // Kameran.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, frameRate: { ideal: 60 }, width: { ideal: 640 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
      } catch {
        setError("Kameran gick inte att starta. Tillåt kameran för sidan, eller knacka i stället.");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Avläsningen, när en punkt är vald och mätningen startad.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !point || !running) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const W = 240;
    let H = 0;
    let bg: Float32Array | null = null;
    let warm = 0;
    const recentSignal: number[] = [];
    const peaks: number[] = [];
    const history: number[] = [];
    let inEvent = false;
    let eventMax = 0;
    let eventTime = 0;
    let lastEvent = -Infinity;
    let frames = 0;
    let fpsStart = 0;
    let stop = false;
    let handle = 0;

    const step = (now: number, captureTime?: number) => {
      if (stop) return;
      // Kamerans egen tidsstämpel när den finns; annars när bilden visas.
      const t = (captureTime ?? now) / 1000;
      if (v.videoWidth > 0) {
        if (H === 0) {
          H = Math.round((W * v.videoHeight) / v.videoWidth);
          canvas.width = W;
          canvas.height = H;
        }
        ctx.drawImage(v, 0, 0, W, H);
        // Remsan: 8 % bred tvärs rörelsen, 70 % lång längs den.
        const cx = point.x * W;
        const cy = point.y * H;
        const along = dir === "vertical" ? H : W;
        const across = dir === "vertical" ? W : H;
        const len = Math.max(8, Math.round(along * 0.7));
        const wid = Math.max(3, Math.round(across * 0.08));
        const c0 = dir === "vertical" ? cy : cx;
        const a0 = Math.min(Math.max(0, Math.round(c0 - len / 2)), along - len);
        const w0 = Math.min(Math.max(0, Math.round((dir === "vertical" ? cx : cy) - wid / 2)), across - wid);
        const img =
          dir === "vertical" ? ctx.getImageData(w0, a0, wid, len) : ctx.getImageData(a0, w0, len, wid);
        const prof = new Float32Array(len);
        const d = img.data;
        for (let py = 0; py < img.height; py++) {
          for (let px = 0; px < img.width; px++) {
            const i = (py * img.width + px) * 4;
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            prof[dir === "vertical" ? py : px] += lum;
          }
        }
        for (let j = 0; j < len; j++) prof[j] /= wid;
        if (!bg || bg.length !== len) {
          bg = Float32Array.from(prof);
          warm = 0;
        }
        let sig = 0;
        for (let j = 1; j < len - 1; j++) {
          const dev = (Math.abs(prof[j - 1] - bg[j - 1]) + Math.abs(prof[j] - bg[j]) + Math.abs(prof[j + 1] - bg[j + 1])) / 3;
          if (dev > sig) sig = dev;
        }
        const alpha = warm < 30 ? 0.2 : 0.03;
        for (let j = 0; j < len; j++) bg[j] += alpha * (prof[j] - bg[j]);
        warm++;

        recentSignal.push(sig);
        if (recentSignal.length > 90) recentSignal.shift();
        history.push(sig);
        if (history.length > 240) history.shift();

        if (warm > 30) {
          const sorted = [...recentSignal].sort((a, b) => a - b);
          const noise = sorted[Math.floor(sorted.length / 2)];
          const peakRef = peaks.length >= 3 ? [...peaks].sort((a, b) => a - b)[Math.floor(peaks.length / 2)] : null;
          const thr = peakRef != null ? noise + Math.max(8, 0.4 * (peakRef - noise)) : noise * 2 + 15;
          if (!inEvent && sig > thr && t - lastEvent > 0.15) {
            inEvent = true;
            eventMax = sig;
            eventTime = t;
          } else if (inEvent) {
            if (sig > eventMax) {
              eventMax = sig;
              eventTime = t;
            }
            if (sig < (noise + thr) / 2) {
              inEvent = false;
              lastEvent = eventTime;
              peaks.push(eventMax);
              if (peaks.length > 9) peaks.shift();
              const at = eventTime;
              setTimes((prev) => [...prev, at]);
            }
          }
          drawPlot(plotRef.current, history, thr);
        }

        frames++;
        if (frames === 1) fpsStart = t;
        else if (frames % 30 === 0 && t > fpsStart) setFps(Math.round((frames - 1) / (t - fpsStart)));
      }
      schedule();
    };

    type RVFC = (cb: (now: number, meta: { captureTime?: number }) => void) => number;
    const rvfc = (v as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(v);
    const schedule = () => {
      handle = rvfc ? rvfc((now, meta) => step(now, meta.captureTime)) : requestAnimationFrame((now) => step(now));
    };
    schedule();
    return () => {
      stop = true;
      const cancel = (v as unknown as { cancelVideoFrameCallback?: (h: number) => void }).cancelVideoFrameCallback;
      if (rvfc && cancel) cancel.call(v, handle);
      else cancelAnimationFrame(handle);
    };
  }, [point, dir, running]);

  const strip =
    point &&
    (dir === "vertical"
      ? { left: `${(point.x - 0.04) * 100}%`, top: `${Math.max(0, Math.min(0.3, point.y - 0.35)) * 100}%`, width: "8%", height: "70%" }
      : { top: `${(point.y - 0.04) * 100}%`, left: `${Math.max(0, Math.min(0.3, point.x - 0.35)) * 100}%`, height: "8%", width: "70%" });

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-sm text-[var(--ink-2)]">{error}</p>
      ) : (
        <>
          <p className="text-sm text-[var(--ink-2)]">
            Ställ telefonen stadigt så att bandet syns, och tryck i bilden där strecket passerar. Välj sedan åt vilket
            håll bandet rör sig i bilden.
          </p>
          <div
            className="relative w-full overflow-hidden rounded-[14px] bg-black"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPoint({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
              setTimes([]);
            }}
          >
            <video ref={videoRef} playsInline muted className="block w-full" />
            {strip && (
              <span aria-hidden className="pointer-events-none absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.6)]" style={strip} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--ink-2)]">Bandet rör sig</span>
            {(
              [
                { k: "vertical", l: "upp–ner" },
                { k: "horizontal", l: "sida till sida" },
              ] as const
            ).map((o) => (
              <button
                key={o.k}
                type="button"
                aria-pressed={dir === o.k}
                onClick={() => {
                  setDir(o.k);
                  setTimes([]);
                }}
                className={`rounded-full border px-3 py-1 text-sm ${dir === o.k ? "border-[var(--foreground)] font-semibold text-[var(--foreground)]" : "border-[var(--line)] text-[var(--ink-2)]"}`}
              >
                {o.l}
              </button>
            ))}
          </div>
          <canvas ref={plotRef} width={600} height={80} className="h-16 w-full rounded-md bg-[var(--surface-raised)] text-[var(--foreground)]" aria-label="Signalen i remsan, en topp per varv" />
          <Progress times={times} />
          {fps != null && fps < 20 && (
            <p className="text-sm text-[var(--ink-2)]">
              Kameran ger bara {fps} bilder per sekund. Mer ljus hjälper, annars går det bra att knacka i stället.
            </p>
          )}
          <p className="text-xs text-[var(--ink-3)]">
            En topp per varv i kurvan betyder att strecket syns. Syns inga toppar: flytta remsan så att strecket går
            genom den, eller gör strecket bredare.{fps != null ? ` Kameran: ${fps} bilder/s.` : ""}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!error && !running && (
          <button type="button" className={primaryButtonClass} disabled={!point} style={{ opacity: point ? 1 : 0.4 }} onClick={() => setRunning(true)}>
            Starta mätningen
          </button>
        )}
        {!error && running && (
          <button type="button" className={primaryButtonClass} disabled={!ready(times)} style={{ opacity: ready(times) ? 1 : 0.4 }} onClick={() => onDone(times)}>
            Klar
          </button>
        )}
        {!error && running && (
          <button type="button" className={buttonClass} onClick={() => setTimes([])}>
            Börja om
          </button>
        )}
        <button type="button" className={buttonClass} onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

function drawPlot(c: HTMLCanvasElement | null, xs: number[], thr: number) {
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return;
  const max = Math.max(thr * 1.5, ...xs, 1);
  ctx.clearRect(0, 0, c.width, c.height);
  const style = getComputedStyle(c);
  ctx.strokeStyle = style.color || "#888";
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(0, c.height - (thr / max) * c.height);
  ctx.lineTo(c.width, c.height - (thr / max) * c.height);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  xs.forEach((x, i) => {
    const px = (i / 239) * c.width;
    const py = c.height - (x / max) * c.height;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}
