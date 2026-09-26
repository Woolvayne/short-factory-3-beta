import { useMemo } from "react";
import {
  BadgeCheck,
  Clock,
  CloudUpload,
  Hash,
  Inbox,
  Loader2,
  RefreshCw,
  Rocket,
  Send,
  TriangleAlert,
  Zap,
} from "lucide-react";
import Section from "./Section";
import { Field, Segmented, Toggle } from "./Controls";
import { cn } from "../utils/cn";
import type { LocalRenderItem, ShipLogEntry, ShipState } from "../lib/types";
import {
  FLEX_INTERVALS,
  MAX_SLOT_TIMES,
  SHIP_GAP_MS,
  SHIP_TIME_PRESETS,
  SHIP_TIMEZONE,
  computeSlots,
  defaultFlexStart,
  fillCustomTimes,
  platformLabel,
  slotTimesLabel,
  type ShipConfig,
  type ShipMode,
  type ZernioStatus,
} from "../lib/zernio";

export interface ShipRun {
  active: boolean;
  total: number;
  done: number;
  pending: number;
  /** Rest der 3-Sekunden-Pause in ms */
  waitMs: number;
  currentIndex: number | null;
  error: string | null;
}

export const IDLE_SHIP_RUN: ShipRun = {
  active: false,
  total: 0,
  done: 0,
  pending: 0,
  waitMs: 0,
  currentIndex: null,
  error: null,
};

const STATUS_LABEL: Record<string, string> = {
  draft: "ENTWURF",
  scheduled: "GEPLANT",
  publishing: "WIRD VERÖFFENTLICHT",
  published: "VERÖFFENTLICHT",
  failed: "FEHLER",
  partial: "TEILWEISE",
};

export function shipStateLabel(state?: ShipState): string {
  if (!state) return "";
  switch (state.status) {
    case "queued":
      return "IN WARTESCHLEIFE";
    case "uploading":
      return `UPLOAD ${Math.round(state.progress * 100)}%`;
    case "publishing":
      return "SENDE AN ZERNIO";
    case "waiting":
      return "PAUSE 3 s";
    case "sent":
      return STATUS_LABEL[state.zernioStatus ?? ""] ?? "GESENDET";
    case "error":
      return "FEHLER";
    default:
      return "";
  }
}

export default function ShipPanel({
  cfg,
  onCfgChange,
  status,
  statusLoading,
  onRefreshStatus,
  items,
  shipStates,
  run,
  onShipAll,
  onShipAllToQueue,
  onShipOne,
  onCancelShip,
  log,
  busy,
}: {
  cfg: ShipConfig;
  onCfgChange: (cfg: ShipConfig) => void;
  status: ZernioStatus | null;
  statusLoading: boolean;
  onRefreshStatus: () => void;
  items: LocalRenderItem[];
  shipStates: Record<number, ShipState>;
  run: ShipRun;
  /** öffnet den Sendeplan-Dialog für alle fertigen Videos */
  onShipAll: () => void;
  /** ein Klick, kein Dialog: alle auf einmal in die Queue (nächste freie Sendeplätze) */
  onShipAllToQueue: () => void;
  /** öffnet den Sendeplan-Dialog für ein einzelnes Video */
  onShipOne: (index: number) => void;
  onCancelShip: () => void;
  log: ShipLogEntry[];
  busy?: boolean;
}) {
  const done = useMemo(() => items.filter((i) => i.status === "done" && i.blob), [items]);
  const notSent = useMemo(
    () => done.filter((i) => shipStates[i.index]?.status !== "sent"),
    [done, shipStates]
  );
  const slots = useMemo(() => computeSlots(cfg, 10), [cfg]);
  /** Units, die über den Sendeplan-Dialog schon eine feste Zeit haben */
  const plannedCount = items.filter((i) => shipStates[i.index]?.slotLabel).length;
  const ready = Boolean(status?.configured) && done.length > 0;
  const set = <K extends keyof ShipConfig>(key: K, value: ShipConfig[K]) =>
    onCfgChange({ ...cfg, [key]: value });

  const accounts = status?.accounts ?? [];

  return (
    <Section
      index="06"
      title="Versand · Zernio"
      hint={
        run.active
          ? `${SHIP_GAP_MS / 1000} s TAKT`
          : cfg.mode === "now"
            ? "SOFORT"
            : cfg.mode === "slots"
              ? slotTimesLabel(cfg.slotTimes)
              : cfg.mode === "custom"
                ? "EIGENE ZEITEN"
                : `ABSTAND ${cfg.flexIntervalMinutes} MIN`
      }
      active={run.active}
      complete={done.length > 0 && notSent.length === 0}
      aside={
        <button
          type="button"
          onClick={onRefreshStatus}
          disabled={statusLoading}
          className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
        >
          {statusLoading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          API
        </button>
      }
    >
      {/* ------------------------------------------------ Status */}
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border px-3 py-2.5",
          status?.configured
            ? "border-volt-400/40 bg-volt-400/5"
            : "border-amber-warn/40 bg-amber-warn/5"
        )}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              status?.configured ? "animate-led bg-volt-400 text-volt-400" : "bg-amber-warn"
            )}
          />
          <span className="mono-label text-[9.5px] text-coal-200">
            ZERNIO_API_KEY {status?.configured ? "VERBUNDEN" : "FEHLT"}
          </span>
        </span>

        {accounts.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            {accounts.map((a) => (
              <span
                key={a.id}
                className="border border-coal-700 bg-coal-950/50 px-2 py-0.5 font-mono text-[9px] tracking-wider text-coal-300"
              >
                {platformLabel(a.platform).toUpperCase()}
                {a.username ? ` · @${a.username.replace(/^@/, "")}` : ""}
              </span>
            ))}
          </span>
        )}

        {!status?.configured && (
          <span className="font-mono text-[9.5px] leading-relaxed text-amber-warn">
            {status?.error
              ? status.error.slice(0, 180)
              : "Vercel → Settings → Environment Variables → ZERNIO_API_KEY setzen + neu deployen."}
          </span>
        )}
        {status?.configured && accounts.length === 0 && (
          <span className="font-mono text-[9.5px] text-amber-warn">
            KEY OK, ABER KEIN SOCIAL-ACCOUNT VERBUNDEN → zernio.com/dashboard
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------------------------- Wann senden */}
        <div className="grid content-start gap-3">
          <Field label="WANN RAUS?" hint={`ZEITZONE ${SHIP_TIMEZONE}`}>
            <Segmented<ShipMode>
              columns={2}
              value={cfg.mode}
              onChange={(v) => set("mode", v)}
              options={[
                { id: "now", label: "SOFORT", sub: "publishNow" },
                { id: "slots", label: "06 & 20 UHR", sub: "Standard · täglich" },
                { id: "custom", label: "EIGENE ZEIT", sub: "pro Video" },
                { id: "flex", label: "FLEXIBEL", sub: "Start + Abstand" },
              ]}
            />
          </Field>

          {cfg.mode === "slots" && (
            <div className="grid gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {cfg.slotTimes.map((time, i) => (
                  <label key={i} className="block">
                    <span className="mono-label mb-1.5 flex items-center justify-between gap-2 text-[9px] text-coal-400">
                      SLOT {i + 1}
                      {cfg.slotTimes.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            set(
                              "slotTimes",
                              cfg.slotTimes.filter((_, idx) => idx !== i)
                            )
                          }
                          className="border border-coal-700 px-1.5 font-mono text-[9px] font-bold text-coal-400 hover:border-rose-err hover:text-rose-err"
                          title="Sendezeit entfernen"
                        >
                          ENTFERNEN
                        </button>
                      )}
                    </span>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) =>
                        set(
                          "slotTimes",
                          cfg.slotTimes.map((t, idx) => (idx === i ? e.target.value : t))
                        )
                      }
                      className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[12px] text-paper-100"
                    />
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={cfg.slotTimes.length >= MAX_SLOT_TIMES}
                  onClick={() =>
                    set("slotTimes", [...cfg.slotTimes, cfg.slotTimes.at(-1) ?? "06:00"])
                  }
                  className="min-h-[30px] border border-coal-600 px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-200 hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
                >
                  + SENDZEIT
                </button>
                {SHIP_TIME_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => set("slotTimes", [...preset.times])}
                    className={cn(
                      "min-h-[30px] border px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest",
                      cfg.slotTimes.join(",") === preset.times.join(",")
                        ? "border-volt-400/60 bg-volt-400/10 text-volt-300"
                        : "border-coal-600 text-coal-300 hover:border-volt-400 hover:text-volt-300"
                    )}
                    title={preset.times.join(" · ")}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <p className="font-mono text-[9px] leading-relaxed tracking-wider text-coal-500">
                STANDARD: EIN VIDEO UM {cfg.slotTimes[0] ?? "06:00"}, DAS NÄCHSTE UM{" "}
                {cfg.slotTimes[1] ?? "20:00"} — DANN DER NÄCHSTE TAG, BIS ALLE 10 DRAUSSEN SIND.
                JEDE ZEIT IST EDITIERBAR, WEITERE SENDZEITEN ÜBER „+ SENDZEIT“. FÜR JEDES VIDEO EINE
                EIGENE ZEIT: MODUS „EIGENE ZEIT“.
              </p>
            </div>
          )}

          {cfg.mode === "custom" && (
            <div className="grid gap-2.5">
              <div className="border border-coal-700/80 bg-coal-850/60 p-2.5">
                <p className="mono-label mb-2 flex items-center gap-1.5 text-[9px] text-coal-400">
                  <Clock className="size-3" /> VORLAGE (WIRD AUF DIE 10 VIDEOS VERTEILT)
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  {cfg.slotTimes.map((time, i) => (
                    <label key={i} className="block">
                      <span className="mono-label mb-1 block text-[8.5px] text-coal-500">
                        ZEIT {i + 1}
                      </span>
                      <input
                        type="time"
                        value={time}
                        onChange={(e) =>
                          set(
                            "slotTimes",
                            cfg.slotTimes.map((t, idx) => (idx === i ? e.target.value : t))
                          )
                        }
                        className="sf-input w-[124px] border border-coal-700/80 bg-coal-850 px-2.5 py-2 font-mono text-[12px] text-paper-100"
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => set("customTimes", fillCustomTimes(cfg.slotTimes, 10))}
                    className="min-h-[38px] border border-volt-400/60 bg-volt-400/10 px-3 py-2 font-mono text-[9.5px] font-bold tracking-widest text-volt-300 hover:bg-volt-400/20"
                  >
                    ZEITEN ÜBERNEHMEN
                  </button>
                  <button
                    type="button"
                    onClick={() => set("customTimes", Array.from({ length: 10 }, () => ""))}
                    className="min-h-[38px] border border-coal-600 px-3 py-2 font-mono text-[9.5px] font-bold tracking-widest text-coal-300 hover:border-rose-err hover:text-rose-err"
                  >
                    ALLE LEEREN (SOFORT)
                  </button>
                </div>
              </div>

              <div className="grid gap-1.5">
                {Array.from({ length: 10 }, (_, i) => {
                  const value = cfg.customTimes[i] ?? "";
                  return (
                    <label key={i} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-mono text-[9.5px] text-coal-400 tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <input
                        type="datetime-local"
                        value={value}
                        onChange={(e) => {
                          const next = Array.from({ length: 10 }, (_, idx) =>
                            idx === i ? e.target.value : (cfg.customTimes[idx] ?? "")
                          );
                          set("customTimes", next);
                        }}
                        className="sf-input min-w-0 flex-1 border border-coal-700/80 bg-coal-850 px-2.5 py-2 font-mono text-[11px] text-paper-100"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = Array.from({ length: 10 }, (_, idx) =>
                            idx === i ? "" : (cfg.customTimes[idx] ?? "")
                          );
                          set("customTimes", next);
                        }}
                        className="shrink-0 border border-coal-700 px-2 py-1.5 font-mono text-[9px] font-bold text-coal-400 hover:border-volt-400 hover:text-volt-300"
                        title="Leer = sofort veröffentlichen"
                      >
                        {value ? "LEEREN" : "SOFORT"}
                      </button>
                    </label>
                  );
                })}
              </div>
              <p className="font-mono text-[9px] leading-relaxed tracking-wider text-coal-500">
                LEERES FELD = DIESES VIDEO GEHT SOFORT RAUS. ZEITEN IN DER VERGANGENHEIT WERDEN
                AUTOMATISCH AUF JETZT VORGEZOGEN (MARKIERT IM SENDEPLAN). ALLES IN {SHIP_TIMEZONE}.
              </p>
            </div>
          )}

          {cfg.mode === "flex" && (
            <div className="grid gap-2">
              <label className="block">
                <span className="mono-label mb-1.5 block text-[9px] text-coal-400">
                  START ({SHIP_TIMEZONE})
                </span>
                <input
                  type="datetime-local"
                  value={cfg.flexStart || defaultFlexStart()}
                  onChange={(e) => set("flexStart", e.target.value)}
                  className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[12px] text-paper-100"
                />
              </label>
              <Field label="ABSTAND ZWISCHEN DEN VIDEOS">
                <Segmented<number>
                  columns={4}
                  value={cfg.flexIntervalMinutes}
                  onChange={(v) => set("flexIntervalMinutes", v)}
                  options={FLEX_INTERVALS}
                />
              </Field>
            </div>
          )}

          {cfg.mode === "now" && (
            <p className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-coal-300">
              JEDES VIDEO GEHT DIREKT NACH DEM UPLOAD RAUS (`publishNow: true`). ZWISCHEN ZWEI
              VIDEOS WARTET DIE FABRIK TROTZDEM {SHIP_GAP_MS / 1000} SEKUNDEN.
            </p>
          )}

          <Toggle
            label="ALS ENTWURF SPEICHERN"
            sub="test-modus: landet als draft in zernio, wird nicht veröffentlicht"
            checked={cfg.asDraft}
            onChange={(v) => set("asDraft", v)}
          />

          {/* Slot-Vorschau — Liste, kein Kalender. Zeigt verplante Units mit ihrer
              echten Zeit aus dem Sendeplan-Dialog. */}
          {(cfg.mode !== "now" || plannedCount > 0) && (
            <div className="border border-coal-700/80 bg-coal-950/40 p-2.5">
              <p className="mono-label mb-2 flex items-center justify-between gap-2 text-[9px] text-coal-400">
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3" /> SENDEPLAN (10 VIDEOS)
                </span>
                <span className="text-coal-500">
                  {plannedCount > 0
                    ? `${plannedCount} × VERPLANT`
                    : cfg.mode === "custom"
                      ? "EIGENE ZEIT PRO VIDEO"
                      : cfg.mode === "flex"
                        ? `ABSTAND ${cfg.flexIntervalMinutes} MIN`
                        : slotTimesLabel(cfg.slotTimes)}
                </span>
              </p>
              <ol className="grid gap-1">
                {slots.map((slot, i) => {
                  const unit = items[i];
                  const state = unit ? shipStates[unit.index] : undefined;
                  /* echte Planung aus dem Dialog schlägt die Panel-Vorschau */
                  const label = state?.slotLabel ?? slot.label;
                  const planned = Boolean(state?.slotLabel);
                  return (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 border-b border-coal-800/80 py-1 last:border-0"
                    >
                      <span className="font-mono text-[9.5px] text-coal-400 tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[9.5px] tracking-wider",
                          planned
                            ? state?.status === "sent"
                              ? "text-volt-300"
                              : "text-ember-400"
                            : slot.bumped
                              ? "text-amber-warn"
                              : "text-coal-200"
                        )}
                        title={
                          planned
                            ? `Zeit aus dem Sendeplan-Dialog${state?.status === "queued" ? " — wartet in der Queue" : ""}`
                            : slot.bumped
                              ? "Die eingestellte Zeit lag in der Vergangenheit — wird auf „jetzt“ vorgezogen."
                              : undefined
                        }
                      >
                        {label}
                        {slot.bumped && !planned ? " (VORGEZOGEN)" : ""}
                        {planned && state?.status === "queued" ? " · QUEUE" : ""}
                      </span>
                      {state?.status === "sent" && (
                        <BadgeCheck className="size-3 shrink-0 text-volt-400" />
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>

        {/* --------------------------------------------- Beschriftung */}
        <div className="grid content-start gap-3">
          <Field label="POST-TITEL" hint="LEER = TITEL AUS DEM IDEA-FELD · YOUTUBE MAX. 100 ZEICHEN">
            <input
              type="text"
              value={cfg.titleOverride}
              onChange={(e) => set("titleOverride", e.target.value)}
              placeholder="z. B. AITA weil ich die Hochzeit meiner Schwester verlassen habe?"
              maxLength={100}
              className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11.5px] text-paper-100 placeholder:text-coal-600"
            />
          </Field>

          <Field label="HASHTAGS">
            <span className="flex items-stretch border border-coal-700/80 bg-coal-850 focus-within:border-volt-400/70">
              <span className="grid w-9 place-items-center border-r border-coal-700/80 text-coal-400">
                <Hash className="size-3.5" />
              </span>
              <input
                type="text"
                value={cfg.hashtags}
                onChange={(e) => set("hashtags", e.target.value)}
                placeholder="#shorts #redditstories #storytime #viral #fyp"
                className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[11.5px] text-paper-100 placeholder:text-coal-600 focus:outline-none"
              />
            </span>
          </Field>

          <Field
            label="CAPTION-VORLAGE"
            hint="{title} {excerpt} {story} {hashtags} {index} {idea}"
          >
            <textarea
              rows={5}
              value={cfg.captionTemplate}
              onChange={(e) => set("captionTemplate", e.target.value)}
              className="w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-paper-100 focus:border-volt-400/70 focus:outline-none"
            />
          </Field>

          <div className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
            <p className="font-mono text-[9.5px] leading-relaxed text-coal-400">
              VERSANDWEG: VIDEO → `POST /v1/media/presign` → DIREKTER PUT-UPLOAD → `POST /v1/posts`
              MIT `mediaItems`. DER API-KEY BLEIBT IN `api/zernio.js` (VERCEL ENV), DER BROWSER
              SIEHT IHN NIE.
            </p>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- Batch-Versand */}
      <div className="mt-5 border border-coal-700 bg-coal-850/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CloudUpload className="size-5 shrink-0 text-coal-300" />
            <div>
              <p className="font-display text-xs font-black tracking-[0.1em] text-coal-200 uppercase">
                Zernio Dispatch
              </p>
              <p className="mono-label mt-0.5 text-[9px] leading-relaxed text-coal-400">
                SENDEPLAN WÄHLEN (SOFORT · EIGENE ZEIT · QUEUE · FLEXIBEL) ODER ALLE DIREKT IN DIE
                QUEUE · {SHIP_GAP_MS / 1000} s PAUSE ZWISCHEN JEDEM VIDEO
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Ein Klick, kein Dialog: ALLE auf einmal in die Queue (nächste freie Sendeplätze) */}
            <button
              type="button"
              onClick={onShipAllToQueue}
              disabled={!ready || busy}
              title={`Alle ${notSent.length || done.length} Videos auf einmal in die Queue — Sendeplan ${slotTimesLabel(
                cfg.slotTimes
              )}`}
              className={cn(
                "flex min-h-[44px] items-center gap-2 border px-4 py-2.5 font-display text-sm font-black tracking-tight uppercase",
                ready && !busy
                  ? "border-volt-400/60 bg-volt-400/10 text-volt-300 hover:bg-volt-400/20"
                  : "border-coal-700 text-coal-500"
              )}
            >
              <Inbox className="size-4" strokeWidth={2.4} />
              {notSent.length > 0 ? `Alle ${notSent.length} → Queue` : `Alle ${done.length} → Queue`}
            </button>

            {run.active && (
              <button
                type="button"
                onClick={onCancelShip}
                className="flex min-h-[44px] items-center gap-2 border border-coal-600 px-4 py-2.5 font-display text-sm font-black tracking-tight text-coal-200 uppercase hover:border-rose-err hover:text-rose-err"
              >
                <TriangleAlert className="size-4" /> STOP
              </button>
            )}

            {/* öffnet den Sendeplan-Dialog für den ganzen Stapel */}
            <button
              type="button"
              onClick={onShipAll}
              disabled={!ready || busy}
              title="Sendeplan für alle fertigen Videos wählen — sofort, eigene Zeit, Queue oder flexibel"
              className={cn(
                "flex min-h-[44px] items-center gap-2 border px-4 py-2.5 font-display text-sm font-black tracking-tight uppercase",
                ready && !busy
                  ? "glow-volt bg-heat border-volt-400 text-coal-950 hover:opacity-90"
                  : "border-coal-700 text-coal-500"
              )}
            >
              {notSent.length > 0 && notSent.length !== done.length ? (
                <Send className="size-4" strokeWidth={2.4} />
              ) : (
                <Rocket className="size-4" strokeWidth={2.4} />
              )}
              {notSent.length > 0
                ? `${notSent.length} Video${notSent.length === 1 ? "" : "s"} → Zernio`
                : `Alle ${done.length} erneut → Zernio`}
            </button>
          </div>
        </div>

        {run.active && (
          <div className="mt-3 grid gap-2">
            <div className="h-1 w-full overflow-hidden bg-coal-800">
              <div
                className="h-full bg-volt-400 transition-[width] duration-300"
                style={{ width: `${run.total ? (run.done / run.total) * 100 : 0}%` }}
              />
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-wider text-ember-400">
              <Loader2 className="size-3 animate-spin" />
              {run.currentIndex !== null && (
                <span>
                  UNIT {String(run.currentIndex + 1).padStart(2, "0")} ·{" "}
                  {shipStateLabel(shipStates[run.currentIndex])}
                </span>
              )}
              <span>
                FERTIG {run.done}/{run.total}
              </span>
              {run.pending > 0 && <span>WARTEND {run.pending}</span>}
              {run.waitMs > 0 && (
                <span className="text-volt-300">
                  PAUSE {(run.waitMs / 1000).toFixed(1)} s
                </span>
              )}
            </p>
          </div>
        )}

        {run.error && (
          <div className="mt-3 flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
            <p className="font-mono text-[11px] leading-relaxed text-rose-err">{run.error}</p>
          </div>
        )}

        {done.length === 0 && (
          <p className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-wider text-coal-500">
            <Zap className="size-3.5" /> ERST RENDERN — DANN ERSCHEINT HIER DER VERSAND-BUTTON.
          </p>
        )}
      </div>

      {/* -------------------------------------------------- Einzelversand */}
      {done.length > 0 && (
        <div className="mt-4">
          <p className="mono-label mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-coal-400">
            EINZELVERSAND
            <span className="font-mono text-[8.5px] tracking-wider text-coal-500">
              KLICK = SENDEPLAN-DIALOG (SOFORT · EIGENE ZEIT · QUEUE)
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {done.map((item) => {
              const state = shipStates[item.index];
              const sent = state?.status === "sent";
              return (
                <button
                  key={item.index}
                  type="button"
                  onClick={() => onShipOne(item.index)}
                  disabled={sent}
                  className={cn(
                    "flex min-h-[34px] items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[9.5px] font-bold tracking-widest disabled:opacity-45",
                    sent
                      ? "border-volt-400/60 bg-volt-400/10 text-volt-300"
                      : state?.status === "error"
                        ? "border-rose-err/60 bg-rose-err/10 text-rose-err"
                        : state?.status === "queued"
                          ? "border-ember-500/60 bg-ember-500/10 text-ember-400"
                          : "border-coal-600 bg-coal-850 text-coal-200 hover:border-volt-400 hover:text-volt-300"
                  )}
                  title={
                    state?.error ??
                    `Sendeplan für Unit ${String(item.index + 1).padStart(2, "0")} wählen — ${item.idea}`
                  }
                >
                  {sent ? (
                    <BadgeCheck className="size-3" />
                  ) : state?.status === "queued" ? (
                    <Inbox className="size-3" />
                  ) : (
                    <Send className="size-3" />
                  )}
                  {String(item.index + 1).padStart(2, "0")} ·{" "}
                  {state ? shipStateLabel(state) : "SENDEN"}
                  {state?.slotLabel && (
                    <span className={cn("font-normal", sent ? "text-volt-300/70" : "text-coal-500")}>
                      · {state.slotLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* -------------------------------------------------- Protokoll */}
      {log.length > 0 && (
        <div className="mt-4 border border-coal-700/80 bg-coal-950/40 p-3">
          <p className="mono-label mb-2 text-[9px] text-coal-400">VERSAND-PROTOKOLL</p>
          <ul className="grid gap-1">
            {log.slice(0, 12).map((entry, i) => (
              <li
                key={`${entry.at}-${i}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-coal-800/70 py-1 last:border-0"
              >
                <span className="font-mono text-[9.5px] text-coal-300">
                  {String(entry.index + 1).padStart(2, "0")} · {entry.slotLabel} ·{" "}
                  <span className={entry.error ? "text-rose-err" : "text-volt-300"}>
                    {entry.error ? "FEHLER" : (STATUS_LABEL[entry.zernioStatus] ?? entry.zernioStatus)}
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[9px] text-coal-500">
                  {entry.error ? entry.error.slice(0, 90) : entry.postId ? `ID ${entry.postId}` : entry.idea.slice(0, 60)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
