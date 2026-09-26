import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { cn } from "../utils/cn";
import { drawRedditIntro, type IntroOptions } from "../lib/intro";
import { drawCaption } from "../lib/renderer";
import type { Settings } from "../lib/settings";

const W = 540;
const H = 960;

/** Platzhalter-„Gameplay", damit man die Karte im Kontext sieht. */
function drawFakeBackground(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = ctx.createLinearGradient(0, 0, w * 0.4, h);
  sky.addColorStop(0, "#1d2b4a");
  sky.addColorStop(0.55, "#3a2350");
  sky.addColorStop(1, "#160c1c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  /* wandernde Blöcke — Parkour-Andeutung */
  const size = w * 0.26;
  for (let i = 0; i < 6; i++) {
    const phase = (t * 0.45 + i * 0.37) % 2;
    const x = ((i * 173 + phase * 260) % (w + size)) - size * 0.5;
    const y = h * 0.22 + i * h * 0.12 + Math.sin(t * 1.6 + i) * 10;
    ctx.fillStyle = i % 2 ? "rgba(122,196,120,0.30)" : "rgba(150,116,86,0.32)";
    ctx.fillRect(x, y, size, size * 0.62);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x, y, size, size * 0.1);
  }

  /* weiches Licht von oben */
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.1, 10, w * 0.5, h * 0.1, h * 0.6);
  glow.addColorStop(0, "rgba(255,200,150,0.20)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Live-Vorschau des Reddit-Story-Intros — zeichnet exakt dieselbe Funktion,
 * die später im Video landet (`drawRedditIntro`), inkl. Captions darunter.
 */
export default function IntroPreview({
  settings,
  title,
  captionSample = "sample caption text",
  className,
}: {
  settings: Settings;
  title: string;
  captionSample?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [time, setTime] = useState(0.6);
  const [playing, setPlaying] = useState(false);

  const duration = Math.max(0.5, settings.introDuration);

  const options: IntroOptions = useMemo(
    () => ({
      title,
      subreddit: settings.introSubreddit.trim() || "r/RedditStories",
      author: settings.introAuthor.trim(),
      upvotes: Math.max(0, Math.round(settings.introUpvotes)),
      duration,
      theme: settings.introTheme,
      animation: settings.introAnimation,
      posY: settings.introPosY,
      titleScale: settings.introTitleScale,
      dim: settings.introDim,
      showStats: settings.introShowStats,
      ageLabel: settings.introAgeLabel.trim() || "12 Std.",
    }),
    [settings, title, duration]
  );

  const draw = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      drawFakeBackground(ctx, W, H, t);

      if (settings.captionsOn) {
        drawCaption(ctx, captionSample, W, H, settings);
      }

      if (settings.introOn) {
        /* Loop: Karte fliegt rein, kurze Pause, wieder von vorn */
        const looped = t % (duration + 0.6);
        drawRedditIntro(ctx, W, H, looped, options);
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, H * 0.42, W, H * 0.1);
        ctx.fillStyle = "#ffd7c2";
        ctx.font = "700 24px Arial, Helvetica, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("INTRO AUS", W / 2, H * 0.47);
      }
    },
    [options, settings, duration, captionSample]
  );

  /* statisches Bild bei jeder Einstellungsänderung (die Animation zeichnet selbst) */
  useEffect(() => {
    if (playing) return;
    draw(time);
  }, [draw, time, playing]);

  /* Animation — läuft in einer Endlosschleife, bis STOP gedrückt wird */
  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const start = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = (now - start) / 1000;
      setTime(elapsed);
      draw(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [playing, draw]);

  const shownTime = playing ? time % (duration + 0.6) : time;

  return (
    <div className={cn("grid gap-2", className)}>
      <div
        className="relative mx-auto w-full overflow-hidden border border-coal-700 bg-black"
        style={{ aspectRatio: "9 / 16", maxWidth: 260 }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span className="absolute top-1.5 left-2 font-mono text-[8px] tracking-[0.18em] text-coal-400/80">
          LIVE PREVIEW · 9:16
        </span>
        <span className="absolute right-2 bottom-1.5 font-mono text-[9px] tracking-wider text-paper-100/80 tabular-nums">
          t = {shownTime.toFixed(1)} s / {duration.toFixed(1)} s
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              setTime(0);
              setPlaying(true);
            }
          }}
          className={cn(
            "flex min-h-[36px] flex-1 items-center justify-center gap-1.5 border font-mono text-[10px] font-bold tracking-widest",
            playing
              ? "border-ember-500/60 bg-ember-500/10 text-ember-400"
              : "bg-heat border-volt-400 text-coal-950 hover:opacity-90"
          )}
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? "STOP" : "INTRO ABSPIELEN"}
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={duration}
        step={0.05}
        value={Math.min(duration, shownTime)}
        onChange={(e) => {
          setPlaying(false);
          setTime(Number(e.target.value));
        }}
        className="sf-range h-6 w-full cursor-pointer bg-transparent"
        style={{
          ["--pct" as string]: `${(Math.min(duration, shownTime) / duration) * 100}%`,
        }}
        aria-label="Zeitpunkt im Intro"
      />
      <p className="font-mono text-[8.5px] leading-relaxed tracking-wider text-coal-500">
        {playing ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> SCHLEIFE LÄUFT — REGLER STOPPT SIE.
          </span>
        ) : (
          "DAS IST 1:1 DIE ZEICHENROUTINE AUS DEM RENDERER — KEIN MOCKUP."
        )}
      </p>
    </div>
  );
}
