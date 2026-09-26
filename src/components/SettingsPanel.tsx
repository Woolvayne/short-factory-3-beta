import { useState } from "react";
import {
  Captions,
  Clapperboard,
  Eye,
  EyeOff,
  MessageSquare,
  Mic,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import Section from "./Section";
import IntroPreview from "./IntroPreview";
import { ColorSwatches, Field, Segmented, Slider, Toggle } from "./Controls";
import { INTRO_ANIMATIONS, INTRO_THEMES, formatCompact, type IntroAnimation, type IntroTheme } from "../lib/intro";
import {
  CAPTION_PRESETS,
  DEFAULT_SETTINGS,
  STORY_STYLES,
  VOICES,
  hasAnyLLMKey,
  type Bitrate,
  type ClipMode,
  type Quality,
  type Settings,
  type StoryStyle,
} from "../lib/settings";
import { cn } from "../utils/cn";

type Tab = "ai" | "voice" | "captions" | "intro" | "video" | "clips";

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "voice", label: "VOICE", icon: Mic },
  { id: "captions", label: "CAPTIONS", icon: Captions },
  { id: "intro", label: "INTRO", icon: MessageSquare },
  { id: "video", label: "VIDEO", icon: Clapperboard },
  { id: "clips", label: "CLIPS", icon: Scissors },
];

function KeyField({
  label,
  value,
  placeholder,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mono-label mb-1.5 block text-[9px] text-coal-400">{label}</span>
      <span
        className={cn(
          "flex items-stretch border bg-coal-850 transition-colors focus-within:border-volt-400/70",
          value ? "border-coal-600" : "border-coal-700/80"
        )}
      >
        <input
          type={show ? "text" : "password"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[12px] text-paper-100 placeholder:text-coal-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="grid w-11 place-items-center border-l border-coal-700 text-coal-400 hover:text-volt-300"
          aria-label={show ? "Hide key" : "Show key"}
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </span>
    </label>
  );
}

export default function SettingsPanel({
  settings,
  onChange,
  disabled,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("ai");
  const keyed = hasAnyLLMKey(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <Section
      index="00"
      title="Machine Settings"
      hint={keyed ? "AI KEYS LOADED" : "OFFLINE WRITER"}
      complete={keyed}
      aside={
        <button
          type="button"
          onClick={() =>
            onChange({
              ...DEFAULT_SETTINGS,
              qwenKey: settings.qwenKey,
              mistralKey: settings.mistralKey,
            })
          }
          disabled={disabled}
          className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 transition-colors hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
        >
          <RotateCcw className="size-3" /> RESET
        </button>
      }
    >
      {/* tab bar */}
      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-coal-700/70 pb-3">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex min-h-[36px] items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest transition-colors",
              tab === id
                ? "bg-heat border-volt-400 text-coal-950"
                : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
            )}
          >
            <Icon className="size-3" /> {label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- AI */}
      {tab === "ai" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <KeyField
              label="QWEN API KEY — DASHSCOPE"
              value={settings.qwenKey}
              placeholder="sk-… (optional)"
              disabled={disabled}
              onChange={(v) => set("qwenKey", v)}
            />
            <KeyField
              label="MISTRAL API KEY"
              value={settings.mistralKey}
              placeholder="optional"
              disabled={disabled}
              onChange={(v) => set("mistralKey", v)}
            />
            <div className="flex items-start gap-2 border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-volt-400" />
              <p className="font-mono text-[10px] leading-relaxed text-coal-300">
                {keyed
                  ? "KEYS LIVE ONLY IN THIS BROWSER'S LOCALSTORAGE AND GO STRAIGHT TO THE LLM — NO SERVER IN BETWEEN."
                  : "NO KEYS? THE BUILT-IN OFFLINE WRITER TAKES OVER — STILL FULL-LENGTH STORIES, ZERO NETWORK."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onChange({ ...settings, qwenKey: "", mistralKey: "" })}
              disabled={disabled || (!settings.qwenKey && !settings.mistralKey)}
              className="flex min-h-[38px] items-center justify-center gap-1.5 border border-coal-600 px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-300 transition-colors hover:border-rose-err hover:text-rose-err disabled:opacity-40"
            >
              <Trash2 className="size-3" /> WIPE KEYS FROM THIS DEVICE
            </button>
          </div>

          <div className="grid content-start gap-3">
            <Field label="STORY GENRE">
              <Segmented<StoryStyle>
                columns={2}
                disabled={disabled}
                value={settings.storyStyle}
                onChange={(v) => set("storyStyle", v)}
                options={STORY_STYLES.map((s) => ({ id: s.id, label: s.label, sub: s.blurb }))}
              />
            </Field>
            {settings.storyStyle === "custom" && (
              <Field label="CUSTOM INSTRUCTION">
                <textarea
                  value={settings.customPrompt}
                  disabled={disabled}
                  rows={3}
                  onChange={(e) => set("customPrompt", e.target.value)}
                  placeholder="e.g. Sub-genre: airline horror stories, always end with a flight attendant twist."
                  className="w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-paper-100 placeholder:text-coal-500 focus:border-volt-400/70 focus:outline-none disabled:opacity-50"
                />
              </Field>
            )}
            <Field
              label="STORY LENGTH"
              value={`~${settings.storyWords} WORDS · ≈${Math.round(settings.storyWords / 2.6)}s`}
            >
              <Slider
                min={110}
                max={280}
                step={5}
                value={settings.storyWords}
                disabled={disabled}
                onChange={(v) => set("storyWords", v)}
              />
            </Field>
            <Field
              label="CREATIVITY"
              value={settings.temperature.toFixed(2)}
              hint="LOWER = SAFER AND MORE COHERENT · HIGHER = WILDER TWISTS"
            >
              <Slider
                min={0.3}
                max={1.5}
                step={0.05}
                value={settings.temperature}
                disabled={disabled}
                onChange={(v) => set("temperature", v)}
              />
            </Field>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- VOICE */}
      {tab === "voice" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <Field label="NARRATOR — EDGE READ ALOUD · FREE · NO KEY">
              <span className="flex items-stretch border border-coal-700/80 bg-coal-850 transition-colors focus-within:border-volt-400/70">
                <span className="grid w-10 place-items-center border-r border-coal-700/80 text-coal-400">
                  <Mic className="size-3.5" />
                </span>
                <select
                  value={settings.voice}
                  disabled={disabled}
                  onChange={(e) => set("voice", e.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[12px] text-paper-100 focus:outline-none disabled:opacity-50"
                >
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id} className="bg-coal-900">
                      {v.label}
                    </option>
                  ))}
                </select>
              </span>
            </Field>
            <Field
              label="SPEAKING RATE"
              value={`${settings.rate > 0 ? "+" : ""}${settings.rate}%`}
              hint="SHORTS USUALLY LAND BETWEEN +5% AND +20%"
            >
              <Slider
                min={-40}
                max={40}
                step={1}
                value={settings.rate}
                disabled={disabled}
                onChange={(v) => set("rate", v)}
              />
            </Field>
            <Field label="PITCH" value={`${settings.pitch > 0 ? "+" : ""}${settings.pitch} Hz`}>
              <Slider
                min={-20}
                max={20}
                step={1}
                value={settings.pitch}
                disabled={disabled}
                onChange={(v) => set("pitch", v)}
              />
            </Field>
          </div>

          <div className="grid content-start gap-3">
            <Field label="VOICE VOLUME" value={`${Math.round(settings.voiceVolume * 100)}%`}>
              <Slider
                min={0.4}
                max={1.4}
                step={0.05}
                value={settings.voiceVolume}
                disabled={disabled}
                onChange={(v) => set("voiceVolume", v)}
              />
            </Field>
            <Field
              label="MUSIC BED VOLUME"
              value={settings.musicVolume === 0 ? "MUTED" : `${Math.round(settings.musicVolume * 100)}%`}
              hint="ONLY APPLIES WHEN A SOUNDTRACK IS ON DECK"
            >
              <Slider
                min={0}
                max={0.5}
                step={0.01}
                value={settings.musicVolume}
                disabled={disabled}
                onChange={(v) => set("musicVolume", v)}
              />
            </Field>
            <Toggle
              label="MUSIC FADE-OUT"
              sub="ramps the bed down over the last 1.4s"
              checked={settings.musicFade}
              disabled={disabled}
              onChange={(v) => set("musicFade", v)}
            />
            <Field label="TAIL PADDING" value={`${settings.tailPadding.toFixed(1)}s`} hint="SILENT BEAT AFTER THE LAST WORD">
              <Slider
                min={0}
                max={3}
                step={0.1}
                value={settings.tailPadding}
                disabled={disabled}
                onChange={(v) => set("tailPadding", v)}
              />
            </Field>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- CAPTIONS */}
      {tab === "captions" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <Toggle
              label="BURN-IN CAPTIONS"
              sub="word-synced from the TTS timestamps"
              checked={settings.captionsOn}
              disabled={disabled}
              onChange={(v) => set("captionsOn", v)}
            />
            <Field label="STYLE PRESETS">
              <div className="grid grid-cols-2 gap-1.5">
                {CAPTION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={disabled || !settings.captionsOn}
                    onClick={() => onChange({ ...settings, ...p.patch })}
                    className="min-h-[38px] border border-coal-700/80 bg-coal-850 px-2 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-200 transition-colors hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label="WORDS PER CUE"
              value={String(settings.wordsPerCue)}
              hint="1 = KARAOKE STYLE · 3 = CLASSIC SHORTS"
            >
              <Slider
                min={1}
                max={5}
                step={1}
                value={settings.wordsPerCue}
                disabled={disabled || !settings.captionsOn}
                onChange={(v) => set("wordsPerCue", v)}
              />
            </Field>
            <Field label="CAPTION COLOUR">
              <ColorSwatches
                value={settings.captionColor}
                disabled={disabled || !settings.captionsOn}
                onChange={(v) => set("captionColor", v)}
              />
            </Field>
          </div>

          <div className="grid content-start gap-3">
            <Field label="TEXT SIZE" value={`${Math.round(settings.captionScale * 1000) / 10}% OF WIDTH`}>
              <Slider
                min={0.045}
                max={0.11}
                step={0.002}
                value={settings.captionScale}
                disabled={disabled || !settings.captionsOn}
                onChange={(v) => set("captionScale", v)}
              />
            </Field>
            <Field
              label="VERTICAL POSITION"
              value={`${Math.round(settings.captionY * 100)}% FROM TOP`}
              hint="60% IS THE CLASSIC SAFE ZONE ABOVE THE UI OVERLAY"
            >
              <Slider
                min={0.25}
                max={0.85}
                step={0.01}
                value={settings.captionY}
                disabled={disabled || !settings.captionsOn}
                onChange={(v) => set("captionY", v)}
              />
            </Field>
            <Field label="OUTLINE WEIGHT" value={settings.outlineWidth === 0 ? "NONE" : `${Math.round(settings.outlineWidth * 100)}%`}>
              <Slider
                min={0}
                max={0.26}
                step={0.01}
                value={settings.outlineWidth}
                disabled={disabled || !settings.captionsOn}
                onChange={(v) => set("outlineWidth", v)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-1.5">
              <Toggle
                label="UPPERCASE"
                checked={settings.uppercase}
                disabled={disabled || !settings.captionsOn}
                onChange={(v) => set("uppercase", v)}
              />
              <Toggle
                label="DROP SHADOW"
                checked={settings.captionShadow}
                disabled={disabled || !settings.captionsOn}
                onChange={(v) => set("captionShadow", v)}
              />
            </div>

            {/* live preview */}
            <div className="relative mt-1 overflow-hidden border border-coal-700 bg-coal-950" style={{ aspectRatio: "16 / 7" }}>
              <div className="absolute inset-0 bg-gradient-to-br from-coal-800 to-coal-950" />
              {settings.captionsOn && (
                <div
                  className="absolute inset-x-2 flex -translate-y-1/2 justify-center"
                  style={{ top: `${settings.captionY * 100}%` }}
                >
                  <span
                    className="text-center font-black break-words"
                    style={{
                      color: settings.captionColor,
                      fontFamily: '"Arial Black", Arial, sans-serif',
                      fontSize: `clamp(10px, ${settings.captionScale * 210}px, 30px)`,
                      textTransform: settings.uppercase ? "uppercase" : "none",
                      WebkitTextStroke: settings.outlineWidth
                        ? `${Math.max(1, settings.outlineWidth * 14)}px #000`
                        : undefined,
                      paintOrder: "stroke fill",
                      textShadow: settings.captionShadow ? "0 3px 10px rgba(0,0,0,.7)" : undefined,
                    }}
                  >
                    {["Sample", "caption text", "right here", "for preview", "of the style"]
                      .join(" ")
                      .split(" ")
                      .slice(0, Math.max(1, settings.wordsPerCue))
                      .join(" ")}
                  </span>
                </div>
              )}
              <span className="absolute bottom-1 left-2 font-mono text-[8px] tracking-widest text-coal-500">
                LIVE PREVIEW
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- VIDEO */}
      {tab === "video" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <Field label="OUTPUT RESOLUTION" hint="AUTO = 720p ON PHONES, 1080p ON DESKTOP">
              <Segmented<Quality>
                columns={2}
                disabled={disabled}
                value={settings.quality}
                onChange={(v) => set("quality", v)}
                options={[
                  { id: "auto", label: "AUTO", sub: "device-aware" },
                  { id: "540", label: "540×960", sub: "draft / fastest" },
                  { id: "720", label: "720×1280", sub: "balanced" },
                  { id: "1080", label: "1080×1920", sub: "full HD" },
                ]}
              />
            </Field>
            <Field label="FRAME RATE">
              <Segmented<number>
                disabled={disabled}
                value={settings.fps}
                onChange={(v) => set("fps", v)}
                options={[
                  { id: 24, label: "24" },
                  { id: 30, label: "30" },
                  { id: 60, label: "60" },
                ]}
              />
            </Field>
            <Field label="BITRATE" hint="HIGHER = SHARPER MOTION BUT BIGGER FILES">
              <Segmented<Bitrate>
                disabled={disabled}
                value={settings.bitrate}
                onChange={(v) => set("bitrate", v)}
                options={[
                  { id: "low", label: "LIGHT" },
                  { id: "med", label: "STANDARD" },
                  { id: "high", label: "CRISP" },
                ]}
              />
            </Field>
          </div>
          <div className="grid content-start gap-3">
            <Toggle
              label="VIGNETTE"
              sub="darkens top + bottom so captions pop"
              checked={settings.vignette}
              disabled={disabled}
              onChange={(v) => set("vignette", v)}
            />
            <Toggle
              label="SLOW ZOOM (KEN BURNS)"
              sub="gentle 6% push-in across the clip"
              checked={settings.zoomEffect}
              disabled={disabled}
              onChange={(v) => set("zoomEffect", v)}
            />
            <div className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
              <p className="font-mono text-[10px] leading-relaxed text-coal-400">
                RENDERING IS REAL-TIME CAPTURE: A 40-SECOND VOICE TAKES ~40 SECONDS PER UNIT. LOWER
                RESOLUTION AND BITRATE MAKE THE ZIP LIGHTER, NOT THE RENDER FASTER.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- CLIPS */}
      {tab === "clips" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <Field
              label="CLIP DISTRIBUTION"
              hint="HOW THE 10 CLIPS ARE PICKED OUT OF ONE LONG SOURCE VIDEO"
            >
              <Segmented<ClipMode>
                columns={1}
                disabled={disabled}
                value={settings.clipMode}
                onChange={(v) => set("clipMode", v)}
                options={[
                  { id: "even", label: "EVENLY SPREAD", sub: "one clip per equal slice — most variety" },
                  { id: "random", label: "RANDOM", sub: "random start points inside the range" },
                  { id: "sequential", label: "SEQUENTIAL", sub: "back-to-back from the start" },
                ]}
              />
            </Field>
            <Field label="CLIP LENGTH">
              <Segmented<"auto" | "fixed">
                disabled={disabled}
                value={settings.clipLengthMode}
                onChange={(v) => set("clipLengthMode", v)}
                options={[
                  { id: "auto", label: "MATCH VOICE", sub: "as long as the story" },
                  { id: "fixed", label: "FIXED", sub: "manual seconds" },
                ]}
              />
            </Field>
            {settings.clipLengthMode === "fixed" && (
              <Field label="FIXED CLIP LENGTH" value={`${settings.clipFixedLength}s`}>
                <Slider
                  min={8}
                  max={90}
                  step={1}
                  value={settings.clipFixedLength}
                  disabled={disabled}
                  onChange={(v) => set("clipFixedLength", v)}
                />
              </Field>
            )}
          </div>
          <div className="grid content-start gap-3">
            <Field label="SKIP INTRO" value={`${settings.clipSkipIntro}s`} hint="IGNORE TITLE CARDS AT THE HEAD OF THE SOURCE">
              <Slider
                min={0}
                max={120}
                step={1}
                value={settings.clipSkipIntro}
                disabled={disabled}
                onChange={(v) => set("clipSkipIntro", v)}
              />
            </Field>
            <Field label="SKIP OUTRO" value={`${settings.clipSkipOutro}s`} hint="IGNORE END CARDS / SUBSCRIBE SCREENS">
              <Slider
                min={0}
                max={120}
                step={1}
                value={settings.clipSkipOutro}
                disabled={disabled}
                onChange={(v) => set("clipSkipOutro", v)}
              />
            </Field>
            <div className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
              <p className="font-mono text-[10px] leading-relaxed text-coal-400">
                THESE SETTINGS DRIVE THE CLIP MILL IN STEP 02 — CHANGE THEM AND HIT RE-SLICE TO
                REDEAL ALL TEN WINDOWS.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- INTRO */}
      {tab === "intro" && (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid content-start gap-3">
            <Toggle
              label="REDDIT-STORY INTRO"
              sub="titel-card fliegt über die ersten sekunden des videos ein"
              checked={settings.introOn}
              disabled={disabled}
              onChange={(v) => set("introOn", v)}
            />

            <Field label="TITEL-QUELLE" hint="DER TITEL IST PRO VIDEO ODER FEST EINSTELLBAR">
              <Segmented<"idea" | "custom">
                columns={2}
                disabled={disabled}
                value={settings.introTitleMode}
                onChange={(v) => set("introTitleMode", v)}
                options={[
                  { id: "idea", label: "IDEA-FELD", sub: "10 verschiedene Titel" },
                  { id: "custom", label: "FESTER TITEL", sub: "für alle 10 gleich" },
                ]}
              />
            </Field>

            <Field
              label="EIGENER TITEL"
              hint={
                settings.introTitleMode === "custom"
                  ? "STEHT AUF JEDER KARTE — MAX. 5 ZEILEN, DER REST ENDET MIT …"
                  : "FALLBACK, FALLS EIN IDEA-FELD LEER IST"
              }
            >
              <input
                type="text"
                value={settings.introTitle}
                disabled={disabled}
                onChange={(e) => set("introTitle", e.target.value)}
                placeholder="AITA for leaving my sister's wedding after what she said?"
                className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-paper-100 placeholder:text-coal-600 focus:border-volt-400/70 focus:outline-none disabled:opacity-50"
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="SUBREDDIT">
                <input
                  type="text"
                  value={settings.introSubreddit}
                  disabled={disabled}
                  onChange={(e) => set("introSubreddit", e.target.value)}
                  placeholder="r/AmItheAsshole"
                  className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11.5px] text-paper-100 placeholder:text-coal-600 focus:border-volt-400/70 focus:outline-none disabled:opacity-50"
                />
              </Field>
              <Field label="ALTER-LABEL">
                <input
                  type="text"
                  value={settings.introAgeLabel}
                  disabled={disabled}
                  onChange={(e) => set("introAgeLabel", e.target.value)}
                  placeholder="12 Std."
                  className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11.5px] text-paper-100 placeholder:text-coal-600 focus:border-volt-400/70 focus:outline-none disabled:opacity-50"
                />
              </Field>
            </div>

            <Field label="AUTOR">
              <input
                type="text"
                value={settings.introAuthor}
                disabled={disabled}
                onChange={(e) => set("introAuthor", e.target.value)}
                placeholder="u/Throwaway_42"
                className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11.5px] text-paper-100 placeholder:text-coal-600 focus:border-volt-400/70 focus:outline-none disabled:opacity-50"
              />
            </Field>

            <Field
              label="UPVOTES"
              value={formatCompact(settings.introUpvotes)}
              hint="ZÄHLT BEIM EINFLIEGEN SICHTBAR HOCH"
            >
              <Slider
                min={100}
                max={250000}
                step={100}
                value={settings.introUpvotes}
                disabled={disabled || !settings.introOn}
                onChange={(v) => set("introUpvotes", v)}
              />
            </Field>

            <Field
              label="DAUER IM VIDEO"
              value={`${settings.introDuration.toFixed(1)} s`}
              hint="STANDARD: DIE ERSTEN 3 SEKUNDEN"
            >
              <Slider
                min={1}
                max={8}
                step={0.5}
                value={settings.introDuration}
                disabled={disabled || !settings.introOn}
                onChange={(v) => set("introDuration", v)}
              />
            </Field>

            <Field label="FLUG-BEWEGUNG">
              <Segmented<IntroAnimation>
                columns={3}
                disabled={disabled || !settings.introOn}
                value={settings.introAnimation}
                onChange={(v) => set("introAnimation", v)}
                options={INTRO_ANIMATIONS}
              />
            </Field>

            <Field label="KARTEN-LOOK">
              <Segmented<IntroTheme>
                columns={2}
                disabled={disabled || !settings.introOn}
                value={settings.introTheme}
                onChange={(v) => set("introTheme", v)}
                options={INTRO_THEMES}
              />
            </Field>

            <Field label="POSITION" value={`${Math.round(settings.introPosY * 100)}% VON OBEN`}>
              <Slider
                min={0.12}
                max={0.8}
                step={0.01}
                value={settings.introPosY}
                disabled={disabled || !settings.introOn}
                onChange={(v) => set("introPosY", v)}
              />
            </Field>

            <Field
              label="TITELGRÖSSE"
              value={`${(settings.introTitleScale * 100).toFixed(1)}% DER BREITE`}
            >
              <Slider
                min={0.035}
                max={0.09}
                step={0.002}
                value={settings.introTitleScale}
                disabled={disabled || !settings.introOn}
                onChange={(v) => set("introTitleScale", v)}
              />
            </Field>

            <Field label="HINTERGRUND ABDUNKELN" value={`${Math.round(settings.introDim * 100)}%`}>
              <Slider
                min={0}
                max={0.7}
                step={0.02}
                value={settings.introDim}
                disabled={disabled || !settings.introOn}
                onChange={(v) => set("introDim", v)}
              />
            </Field>

            <Toggle
              label="UPVOTES + KOMMENTARE ANZEIGEN"
              sub="pfeil, zähler und kommentar-blase unter dem titel"
              checked={settings.introShowStats}
              disabled={disabled || !settings.introOn}
              onChange={(v) => set("introShowStats", v)}
            />
          </div>

          <div className="grid content-start gap-3">
            <IntroPreview
              settings={settings}
              title={
                settings.introTitleMode === "custom" && settings.introTitle.trim()
                  ? settings.introTitle.trim()
                  : "AITA for walking out of my sister's wedding after the toast she made about my daughter?"
              }
            />
            <div className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
              <p className="font-mono text-[10px] leading-relaxed text-coal-400">
                DAS INTRO WIRD DIREKT IN DEN CANVAS-RENDER GEZEICHNET — ES IST ALSO FEST IM VIDEO
                EINGEBRANNT (KEIN OVERLAY, KEIN SCHNITT). DIE CAPTIONS LAUFEN DARUNTER WEITER, DIE
                KARTE LIEGT DARÜBER.
              </p>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
