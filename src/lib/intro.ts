/**
 * Reddit-Story-Intro — der klassische Titel-Card-Look, der während der ersten
 * (einstellbaren, Standard 3) Sekunden über dem Video „einfliegt".
 *
 * Alles wird direkt auf dasselbe Canvas gezeichnet wie die Captions, also ist
 * das Intro 1:1 Teil des gerenderten Videos (kein Overlay, kein Schnitt).
 * Dieselbe Funktion zeichnet auch die Live-Vorschau in Settings → INTRO.
 */

import type { Settings } from "./settings";
import type { LocalRenderItem } from "./types";

export type IntroTheme = "dark" | "light";
export type IntroAnimation = "fly-up" | "fly-left" | "drop";

export interface IntroOptions {
  /** Titelzeile(n) des Reddit-Posts */
  title: string;
  subreddit: string;
  author: string;
  upvotes: number;
  /** Sekunden, die das Intro sichtbar ist (Standard 3) */
  duration: number;
  theme: IntroTheme;
  animation: IntroAnimation;
  /** Kartenmitte als Anteil der Videohöhe (0.1 … 0.8) */
  posY: number;
  /** Titel-Schriftgröße als Anteil der Videobreite */
  titleScale: number;
  /** Hintergrund-Abdunklung 0 … 0.7 */
  dim: number;
  showStats: boolean;
  ageLabel: string;
}

const UI_FONT = 'Arial, Helvetica, "Segoe UI", sans-serif';
const ACCENT = "#ff4500";

const clamp = (v: number, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInCubic = (p: number) => p * p * p;
/** easeOutBack — fliegt rein und schwingt ganz leicht über das Ziel hinaus. */
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  const native = (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect;
  if (typeof native === "function") {
    (
      ctx as CanvasRenderingContext2D & {
        roundRect: (x: number, y: number, w: number, h: number, r: number) => void;
      }
    ).roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Word-wrap mit harter Grenze — zu lange Titel enden mit „…". */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number
): string[] {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxW) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = test;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  /* Rest in die letzte Zeile stauchen, damit nichts still verschwindet */
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length) {
    const rest = words.slice(used).join(" ");
    let last = lines[lines.length - 1];
    while (ctx.measureText(`${last} ${rest}…`).width > maxW && last.includes(" ")) {
      last = last.slice(0, last.lastIndexOf(" "));
    }
    lines[lines.length - 1] = `${last} ${rest}…`.replace(/\s+/g, " ").trim();
  }
  return lines;
}

export function formatCompact(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}K`.replace(".0K", "K");
  return `${(v / 1_000_000).toFixed(1)}M`;
}

function palette(theme: IntroTheme) {
  return theme === "light"
    ? {
        card: "#ffffff",
        border: "rgba(26,26,27,0.14)",
        title: "#1a1a1b",
        meta: "#576f76",
        chip: "rgba(255,69,0,0.10)",
        chipText: "#d63900",
        shadow: "rgba(0,0,0,0.45)",
      }
    : {
        card: "#1a1a1b",
        border: "rgba(255,255,255,0.12)",
        title: "#f2f4f5",
        meta: "#9aa0a3",
        chip: "rgba(255,69,0,0.16)",
        chipText: "#ff6b3d",
        shadow: "rgba(0,0,0,0.6)",
      };
}

function drawUpvoteArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size, y + size * 0.62);
  ctx.lineTo(x + size * 0.68, y + size * 0.62);
  ctx.lineTo(x + size * 0.68, y + size);
  ctx.lineTo(x + size * 0.32, y + size);
  ctx.lineTo(x + size * 0.32, y + size * 0.62);
  ctx.lineTo(x, y + size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCommentBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.4, size * 0.11);
  ctx.beginPath();
  const native = (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect;
  if (typeof native === "function") {
    (
      ctx as CanvasRenderingContext2D & {
        roundRect: (x: number, y: number, w: number, h: number, r: number) => void;
      }
    ).roundRect(x, y, size, size * 0.82, size * 0.2);
  } else {
    roundRect(ctx, x, y, size, size * 0.82, size * 0.2);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.22, y + size * 0.82);
  ctx.lineTo(x + size * 0.22, y + size * 1.12);
  ctx.lineTo(x + size * 0.52, y + size * 0.82);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * Zeichnet das Intro zum Zeitpunkt `t` (Sekunden seit Renderstart).
 * Außerhalb des Zeitfensters passiert nichts.
 */
export function drawRedditIntro(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  o: IntroOptions
): void {
  const duration = Math.max(0.4, o.duration);
  if (t < 0 || t > duration) return;

  const enterDur = Math.min(0.55, duration * 0.34);
  const exitDur = Math.min(0.42, duration * 0.26);
  const p = clamp(t / enterDur);
  const q = clamp((t - (duration - exitDur)) / exitDur);
  const ease = easeOutBack(p);
  const out = easeInCubic(q);
  const alpha = clamp(easeOutCubic(p) * 1.15) * (1 - out);
  if (alpha <= 0.002) return;

  const pal = palette(o.theme);

  /* Versatz + Skalierung je nach Flugrichtung */
  let dx = 0;
  let dy = 0;
  if (o.animation === "fly-left") {
    dx = (1 - ease) * w * 0.62 + out * w * 0.4;
    dy = out * -h * 0.04;
  } else if (o.animation === "drop") {
    dy = (1 - ease) * -h * 0.34 + out * -h * 0.2;
    dx = out * w * 0.06;
  } else {
    dy = (1 - ease) * h * 0.17 + out * -h * 0.26;
  }
  const scale = 0.9 + 0.1 * Math.min(1.06, ease);
  const rotate = (1 - easeOutCubic(p)) * (o.animation === "drop" ? 0.05 : 0.02) * (o.animation === "fly-left" ? -1 : 1);

  /* ---- Abdunklung, damit die Karte vom Hintergrund abhebt ---- */
  if (o.dim > 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(0,0,0,${o.dim})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = alpha;

  /* ---- Geometrie der Karte ---- */
  const pad = Math.round(w * 0.042);
  const cardW = Math.round(w * 0.88);
  const avatarR = w * 0.031;
  const metaFs = Math.round(w * 0.032);
  const titleFs = Math.max(12, Math.round(w * o.titleScale));
  const statsFs = Math.round(w * 0.033);
  const titleLineH = Math.round(titleFs * 1.24);

  ctx.font = `700 ${metaFs}px ${UI_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const headerH = Math.round(avatarR * 2 + w * 0.012);

  ctx.font = `800 ${titleFs}px ${UI_FONT}`;
  const titleLines = wrapLines(ctx, o.title, cardW - pad * 2, 5);
  const titleBlockH = titleLines.length * titleLineH;

  const statsH = o.showStats ? Math.round(statsFs * 2.1) : 0;
  const gapTitleStats = o.showStats ? Math.round(w * 0.028) : 0;
  const cardH = Math.round(pad + headerH + w * 0.026 + titleBlockH + gapTitleStats + statsH + pad * 0.85);

  const centerX = w / 2 + dx;
  const centerY = h * clamp(o.posY, 0.08, 0.86) + dy;
  const cardX = centerX - cardW / 2;
  const cardY = centerY - cardH / 2;

  ctx.translate(centerX, centerY);
  ctx.rotate(rotate);
  ctx.scale(scale, scale);
  ctx.translate(-centerX, -centerY);

  /* ---- Schatten + Karte ---- */
  ctx.save();
  ctx.shadowColor = pal.shadow;
  ctx.shadowBlur = w * 0.05;
  ctx.shadowOffsetY = w * 0.012;
  ctx.fillStyle = pal.card;
  roundRect(ctx, cardX, cardY, cardW, cardH, w * 0.032);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = pal.border;
  ctx.lineWidth = Math.max(1, w * 0.0018);
  roundRect(ctx, cardX, cardY, cardW, cardH, w * 0.032);
  ctx.stroke();

  /* linker Akzent-Streifen */
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, w * 0.032);
  ctx.clip();
  const stripe = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
  stripe.addColorStop(0, ACCENT);
  stripe.addColorStop(1, "#ff8a1f");
  ctx.fillStyle = stripe;
  ctx.fillRect(cardX, cardY, Math.max(3, w * 0.008), cardH);
  ctx.restore();

  /* ---- Kopfzeile: Avatar + Subreddit + Alter ---- */
  const headY = cardY + pad + avatarR;
  const avatarX = cardX + pad + avatarR + w * 0.006;

  const avatarGrad = ctx.createLinearGradient(
    avatarX - avatarR,
    headY - avatarR,
    avatarX + avatarR,
    headY + avatarR
  );
  avatarGrad.addColorStop(0, "#ff8a1f");
  avatarGrad.addColorStop(1, ACCENT);
  ctx.fillStyle = avatarGrad;
  ctx.beginPath();
  ctx.arc(avatarX, headY, avatarR, 0, Math.PI * 2);
  ctx.fill();

  /* kleines Alien-Gesicht als Avatar-Motiv */
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(avatarX - avatarR * 0.34, headY - avatarR * 0.1, avatarR * 0.14, 0, Math.PI * 2);
  ctx.arc(avatarX + avatarR * 0.34, headY - avatarR * 0.1, avatarR * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = Math.max(1, avatarR * 0.1);
  ctx.beginPath();
  ctx.arc(avatarX, headY + avatarR * 0.12, avatarR * 0.42, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();

  ctx.font = `700 ${metaFs}px ${UI_FONT}`;
  ctx.textBaseline = "middle";
  const subText = o.subreddit.trim() || "r/RedditStories";
  ctx.fillStyle = pal.title;
  ctx.fillText(subText, avatarX + avatarR + w * 0.02, headY - metaFs * 0.28);
  const subW = ctx.measureText(subText).width;

  ctx.font = `400 ${Math.round(metaFs * 0.86)}px ${UI_FONT}`;
  ctx.fillStyle = pal.meta;
  ctx.fillText(
    `· ${o.ageLabel || "12 Std."}`,
    avatarX + avatarR + w * 0.02 + subW + metaFs * 0.4,
    headY - metaFs * 0.28
  );

  if (o.author.trim()) {
    ctx.font = `400 ${Math.round(metaFs * 0.82)}px ${UI_FONT}`;
    ctx.fillStyle = pal.meta;
    ctx.fillText(o.author.trim(), avatarX + avatarR + w * 0.02, headY + metaFs * 0.62);
  }

  /* ---- Titel: Zeilen fliegen nacheinander rein ---- */
  ctx.font = `800 ${titleFs}px ${UI_FONT}`;
  const titleTop = cardY + pad + headerH + w * 0.026 + titleFs * 0.86;
  const fromLeft = o.animation === "fly-left";
  titleLines.forEach((lineText, i) => {
    const start = 0.1 + i * 0.075;
    const lp = clamp((t - start) / Math.min(0.4, duration * 0.24));
    const le = easeOutCubic(lp);
    const y = titleTop + i * titleLineH;
    ctx.save();
    ctx.globalAlpha = alpha * le;
    ctx.translate((1 - le) * w * (fromLeft ? 0.09 : 0.05), (1 - le) * h * (fromLeft ? 0 : 0.012));
    ctx.fillStyle = pal.title;
    ctx.fillText(lineText, cardX + pad + w * 0.006, y);
    ctx.restore();
  });

  /* ---- Upvotes / Kommentare ---- */
  if (o.showStats) {
    const statsY = cardY + cardH - pad * 0.85 - statsFs * 0.55;
    const iconSize = statsFs * 1.05;
    const sp = clamp(t / Math.min(1.15, duration * 0.55));
    const counted = Math.round(o.upvotes * easeOutCubic(sp));
    const comments = Math.max(8, Math.round((o.upvotes || 1000) / 13));
    const countedComments = Math.round(comments * easeOutCubic(sp));

    let x = cardX + pad + w * 0.006;

    /* Upvote-Chip */
    ctx.font = `700 ${statsFs}px ${UI_FONT}`;
    const upText = formatCompact(counted);
    const chipW = iconSize + statsFs * 0.55 + ctx.measureText(upText).width + statsFs * 0.9;
    ctx.fillStyle = pal.chip;
    roundRect(ctx, x, statsY - statsFs * 0.95, chipW, statsFs * 1.9, statsFs * 0.95);
    ctx.fill();
    drawUpvoteArrow(ctx, x + statsFs * 0.45, statsY - iconSize * 0.5, iconSize, pal.chipText);
    ctx.fillStyle = pal.chipText;
    ctx.textBaseline = "middle";
    ctx.fillText(upText, x + statsFs * 0.45 + iconSize + statsFs * 0.28, statsY);
    x += chipW + statsFs * 0.7;

    drawCommentBubble(ctx, x, statsY - iconSize * 0.42, iconSize, pal.meta);
    ctx.font = `600 ${statsFs}px ${UI_FONT}`;
    ctx.fillStyle = pal.meta;
    ctx.fillText(formatCompact(countedComments), x + iconSize + statsFs * 0.35, statsY);
    x += iconSize + statsFs * 0.35 + ctx.measureText(formatCompact(countedComments)).width + statsFs * 0.9;

    /* Share-Pfeil */
    ctx.strokeStyle = pal.meta;
    ctx.lineWidth = Math.max(1.4, statsFs * 0.1);
    ctx.beginPath();
    ctx.moveTo(x, statsY + iconSize * 0.18);
    ctx.lineTo(x + iconSize * 0.62, statsY - iconSize * 0.4);
    ctx.lineTo(x + iconSize * 0.62, statsY + iconSize * 0.62);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + iconSize * 0.36, statsY - iconSize * 0.4);
    ctx.lineTo(x + iconSize * 0.62, statsY - iconSize * 0.4);
    ctx.lineTo(x + iconSize * 0.62, statsY - iconSize * 0.14);
    ctx.stroke();
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Settings → Intro-Optionen                                          */
/* ------------------------------------------------------------------ */

export const INTRO_ANIMATIONS: { id: IntroAnimation; label: string; sub: string }[] = [
  { id: "fly-up", label: "FLY UP", sub: "fliegt von unten ein" },
  { id: "fly-left", label: "FLY IN", sub: "fliegt von links ein" },
  { id: "drop", label: "DROP", sub: "fällt von oben rein" },
];

export const INTRO_THEMES: { id: IntroTheme; label: string; sub: string }[] = [
  { id: "dark", label: "DARK", sub: "Reddit Nachtmodus" },
  { id: "light", label: "LIGHT", sub: "Reddit Tagmodus" },
];

/** Welcher Titel auf der Karte steht: Idea-Titel des Videos oder ein fester. */
export function introTitleFor(item: Pick<LocalRenderItem, "idea">, s: Settings): string {
  if (s.introTitleMode === "custom" && s.introTitle.trim()) return s.introTitle.trim();
  return item.idea.trim() || s.introTitle.trim() || "Reddit Story";
}

export function introOptionsFor(
  item: Pick<LocalRenderItem, "idea">,
  s: Settings
): IntroOptions | null {
  if (!s.introOn) return null;
  return {
    title: introTitleFor(item, s),
    subreddit: s.introSubreddit.trim() || "r/RedditStories",
    author: s.introAuthor.trim(),
    upvotes: Math.max(0, Math.round(s.introUpvotes)),
    duration: Math.max(0.5, s.introDuration),
    theme: s.introTheme,
    animation: s.introAnimation,
    posY: s.introPosY,
    titleScale: s.introTitleScale,
    dim: s.introDim,
    showStats: s.introShowStats,
    ageLabel: s.introAgeLabel.trim() || "12 Std.",
  };
}
