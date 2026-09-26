/**
 * Machine settings — everything lives in localStorage on THIS device.
 * API keys are never sent anywhere except the matching LLM endpoint.
 */

import type { IntroAnimation, IntroTheme } from "./intro";

export type StoryStyle =
  | "aita"
  | "revenge"
  | "confession"
  | "creepy"
  | "wholesome"
  | "workplace"
  | "custom";

export type ClipMode = "even" | "random" | "sequential";
export type Quality = "auto" | "540" | "720" | "1080";
export type Bitrate = "low" | "med" | "high";

export interface Settings {
  /* ---- AI ---- */
  qwenKey: string;
  mistralKey: string;
  storyStyle: StoryStyle;
  storyWords: number;
  temperature: number;
  customPrompt: string;

  /* ---- voice ---- */
  voice: string;
  rate: number;  // -40 … +40 (%)
  pitch: number; // -20 … +20 (Hz)

  /* ---- captions ---- */
  captionsOn: boolean;
  wordsPerCue: number;   // 1 … 5
  captionScale: number;  // 0.045 … 0.11 of width
  captionY: number;      // 0.25 … 0.85
  captionColor: string;
  outlineWidth: number;  // 0 … 0.26 relative to font size
  uppercase: boolean;
  captionShadow: boolean;

  /* ---- video ---- */
  quality: Quality;
  fps: number;
  bitrate: Bitrate;
  vignette: boolean;
  zoomEffect: boolean;
  tailPadding: number; // seconds of silence after the voice

  /* ---- audio ---- */
  voiceVolume: number; // 0 … 1.4
  musicVolume: number; // 0 … 0.5
  musicFade: boolean;

  /* ---- clip mill ---- */
  clipMode: ClipMode;
  clipSkipIntro: number;
  clipSkipOutro: number;
  clipLengthMode: "auto" | "fixed";
  clipFixedLength: number;

  /* ---- reddit story intro (erste X Sekunden im Video) ---- */
  introOn: boolean;
  introTitleMode: "idea" | "custom";
  introTitle: string;
  introSubreddit: string;
  introAuthor: string;
  introUpvotes: number;
  introAgeLabel: string;
  introDuration: number;    // seconds the card is visible (default 3)
  introTheme: IntroTheme;
  introAnimation: IntroAnimation;
  introPosY: number;        // 0.1 … 0.8 of height
  introTitleScale: number;  // title font size as a fraction of width
  introDim: number;         // backdrop dimming 0 … 0.7
  introShowStats: boolean;
}

const STORE_KEY = "shortsfactory.settings.v3";

export const DEFAULT_SETTINGS: Settings = {
  qwenKey: "",
  mistralKey: "",
  storyStyle: "aita",
  storyWords: 185,
  temperature: 1.05,
  customPrompt: "",

  voice: "en-US-AndrewNeural",
  rate: 2,
  pitch: 0,

  captionsOn: true,
  wordsPerCue: 3,
  captionScale: 0.074,
  captionY: 0.6,
  captionColor: "#ffffff",
  outlineWidth: 0.16,
  uppercase: true,
  captionShadow: true,

  quality: "auto",
  fps: 30,
  bitrate: "med",
  vignette: true,
  zoomEffect: false,
  tailPadding: 0.6,

  voiceVolume: 1,
  musicVolume: 0.13,
  musicFade: true,

  clipMode: "even",
  clipSkipIntro: 5,
  clipSkipOutro: 5,
  clipLengthMode: "auto",
  clipFixedLength: 35,

  introOn: true,
  introTitleMode: "idea",
  introTitle: "",
  introSubreddit: "r/AmItheAsshole",
  introAuthor: "u/Throwaway_42",
  introUpvotes: 15400,
  introAgeLabel: "12 Std.",
  introDuration: 3,
  introTheme: "dark",
  introAnimation: "fly-up",
  introPosY: 0.36,
  introTitleScale: 0.058,
  introDim: 0.34,
  introShowStats: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode — non-fatal */
  }
}

export const hasAnyLLMKey = (s: Settings) => Boolean(s.qwenKey.trim() || s.mistralKey.trim());

/** Edge Read-Aloud neural voices (free, no API key). */
export const VOICES: { id: string; label: string }[] = [
  { id: "en-US-AndrewNeural", label: "Andrew · US male (Reddit classic)" },
  { id: "en-US-ChristopherNeural", label: "Christopher · US male, deep" },
  { id: "en-US-GuyNeural", label: "Guy · US male, newscast" },
  { id: "en-US-BrianNeural", label: "Brian · US male, warm" },
  { id: "en-US-SteffanNeural", label: "Steffan · US male, young" },
  { id: "en-US-JennyNeural", label: "Jenny · US female, casual" },
  { id: "en-US-AriaNeural", label: "Aria · US female, narration" },
  { id: "en-US-MichelleNeural", label: "Michelle · US female, bright" },
  { id: "en-GB-RyanNeural", label: "Ryan · British male" },
  { id: "en-GB-SoniaNeural", label: "Sonia · British female" },
  { id: "en-AU-NatashaNeural", label: "Natasha · Australian female" },
  { id: "en-IE-ConnorNeural", label: "Connor · Irish male" },
];

export const STORY_STYLES: { id: StoryStyle; label: string; blurb: string }[] = [
  { id: "aita", label: "AITA", blurb: "moral dilemma, asks the internet to judge" },
  { id: "revenge", label: "PETTY REVENGE", blurb: "slow-burn payback with a punchline" },
  { id: "confession", label: "CONFESSION", blurb: "off-my-chest secret, raw and personal" },
  { id: "creepy", label: "UNSETTLING", blurb: "eerie true-ish encounter, tense build" },
  { id: "wholesome", label: "WHOLESOME", blurb: "feel-good twist, warm ending" },
  { id: "workplace", label: "WORKPLACE", blurb: "office/boss chaos and malicious compliance" },
  { id: "custom", label: "CUSTOM", blurb: "your own instruction below" },
];

export const CAPTION_PRESETS: {
  id: string;
  label: string;
  patch: Partial<Settings>;
}[] = [
  {
    id: "hormozi",
    label: "BOLD PUNCH",
    patch: { captionScale: 0.082, outlineWidth: 0.2, uppercase: true, captionColor: "#ffffff", wordsPerCue: 3, captionShadow: true },
  },
  {
    id: "clean",
    label: "CLEAN SUB",
    patch: { captionScale: 0.058, outlineWidth: 0.1, uppercase: false, captionColor: "#ffffff", wordsPerCue: 4, captionShadow: true },
  },
  {
    id: "karaoke",
    label: "ONE WORD",
    patch: { captionScale: 0.1, outlineWidth: 0.22, uppercase: true, captionColor: "#d9ff3f", wordsPerCue: 1, captionShadow: true },
  },
  {
    id: "mint",
    label: "MINT POP",
    patch: { captionScale: 0.076, outlineWidth: 0.18, uppercase: true, captionColor: "#3fe8a4", wordsPerCue: 2, captionShadow: true },
  },
];

export const isCoarsePointer = () =>
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Phones get a lighter render, desktops full HD — unless overridden. */
export function resolveDimensions(q: Quality): { width: number; height: number } {
  if (q === "540") return { width: 540, height: 960 };
  if (q === "720") return { width: 720, height: 1280 };
  if (q === "1080") return { width: 1080, height: 1920 };
  return isCoarsePointer() ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
}

export function resolveBitrate(b: Bitrate, width: number): number {
  const base = width >= 1080 ? 8_000_000 : width >= 720 ? 5_000_000 : 3_000_000;
  return b === "low" ? Math.round(base * 0.55) : b === "high" ? Math.round(base * 1.5) : base;
}

export function styleInstruction(s: Settings): string {
  switch (s.storyStyle) {
    case "revenge":
      return "Sub-genre: petty revenge. A slow-burn setup where the narrator quietly gets even, ending on a satisfying punchline.";
    case "confession":
      return "Sub-genre: raw confession. The narrator admits something they have kept secret, honest and a little uncomfortable.";
    case "creepy":
      return "Sub-genre: unsettling true-ish encounter. Build tension steadily, keep it grounded and eerie, no gore.";
    case "wholesome":
      return "Sub-genre: wholesome. Something small and human that turns out unexpectedly kind, warm ending.";
    case "workplace":
      return "Sub-genre: workplace chaos. Bosses, coworkers, malicious compliance, corporate absurdity.";
    case "custom":
      return s.customPrompt.trim() || "Sub-genre: general viral Reddit story.";
    case "aita":
    default:
      return "Sub-genre: AITA. Present a moral dilemma and end by asking the internet to judge.";
  }
}
