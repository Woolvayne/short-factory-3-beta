import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Clock,
  Hash,
  Inbox,
  Layers,
  Loader2,
  Rocket,
  Send,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { Field, Segmented, Toggle } from "./Controls";
import { cn } from "../utils/cn";
import type { LocalRenderItem } from "../lib/types";
import { formatBytes, formatDuration } from "../lib/media";
import {
  FLEX_INTERVALS,
  SHIP_GAP_MS,
  SHIP_TIMEZONE,
  platformLabel,
  slotTimesLabel,
  type ShipConfig,
  type ZernioStatus,
} from "../lib/zernio";
import {
  PLAN_KIND_LABEL,
  QUICK_TIMES,
  defaultPlanFor,
  defaultPlanTime,
  quickTimeValue,
  slotsForTargets,
  summarizeSlots,
  type ShipPlan,
  type ShipPlanKind,
} from "../lib/shipPlan";

/**
 * Sendeplan-Dialog: öffnet sich, wenn ein einzelnes Video (Output Bay /
 * „Einzelversand") oder der ganze Stapel („Alle → Zernio") verschickt werden
 * soll. Man wählt SOFORT · EIGENE ZEIT · QUEUE (bzw. beim Stapel zusätzlich
 * FLEXIBEL · EIGENE ZEITEN), sieht den fertigen Sendeplan als Liste und reiht
 * das Ganze dann in die Warteschlange ein.
 */

export interface ShipDialogProps {
  /** ein Video oder der ganze Stapel */
  scope: "single" | "batch";
  targets: LocalRenderItem[];
  cfg: ShipConfig;
  status: ZernioStatus | null;
  /** Videos, die schon in der Warteschlange auf einen Slot warten */
  pendingScheduled: number;
  /** Versand läuft gerade (der Plan wird einfach angehängt) */
  running: boolean;
  onClose: () => void;
  onConfirm: (plan: ShipPlan) => void;
  /** „EIGENE ZEITEN" im Panel bearbeiten → Dialog zu, Panel auf */
  onEditPanelTimes: () => void;
}

const KIND_ICON: Record<ShipPlanKind, typeof Zap> = {
  now: Zap,
  at: CalendarClock,
  queue: Inbox,
  series: Clock,
  custom: Layers,
};

export default function ShipDialog({
  scope,
  targets,
  cfg,
  status,
  pendingScheduled,
  running,
  onClose,
  onConfirm,
  onEditPanelTimes,
}: ShipDialogProps) {
  const single = scope === "single";
  const count = targets.length;
  const first = targets[0];

  const [plan, setPlan] = useState<ShipPlan>(() =>
    defaultPlanFor(cfg, scope, first?.index ?? 0)
  );
  const panelRef = useRef<HTMLDivElement>(null);

  /* Esc = zu, Strg/Cmd+Enter = senden */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, plan, count]);

  /* Beim Öffnen: Seiten-Scrollen sperren + Fokus in den Dialog (nicht bei jeder Eingabe!) */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const set = <K extends keyof ShipPlan>(key: K, value: ShipPlan[K]) =>
    setPlan((p) => ({ ...p, [key]: value }));

  const pickKind = (kind: ShipPlanKind) =>
    setPlan((p) => ({
      ...p,
      kind,
      /* „EIGENE ZEIT" ohne Zeit ist sinnlos → sinnvolle Vorbelegung */
      time:
        kind === "at"
          ? p.time || defaultPlanTime()
          : kind === "series"
            ? p.time || cfg.flexStart || defaultPlanTime()
            : p.time,
      intervalMinutes:
        kind === "series" && p.intervalMinutes <= 0 ? cfg.flexIntervalMinutes : p.intervalMinutes,
    }));

  const slots = useMemo(
    () => slotsForTargets(plan, cfg, targets),
    // targets ist prop-stabil pro Dialog-Instanz
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, cfg, count, targets.map((t) => t.index).join(",")]
  );
  const summary = useMemo(() => summarizeSlots(slots), [slots]);
  const needsTime = plan.kind === "at" && !plan.time.trim();
  const canSend = count > 0 && !needsTime;
  const accounts = status?.accounts ?? [];
  const totalBytes = targets.reduce((sum, t) => sum + (t.size ?? t.blob?.size ?? 0), 0);

  function submit() {
    if (!canSend) return;
    onConfirm(plan);
  }

  const kindOptions: { id: ShipPlanKind; label: string; sub: string }[] = single
    ? [
        { id: "now", label: "SOFORT", sub: "publishNow · geht direkt raus" },
        { id: "at", label: "EIGENE ZEIT", sub: `flexibel planen · ${SHIP_TIMEZONE}` },
        { id: "queue", label: "IN DIE QUEUE", sub: `nächster Platz · ${slotTimesLabel(cfg.slotTimes)}` },
      ]
    : [
        { id: "now", label: "ALLE SOFORT", sub: `publishNow · ${SHIP_GAP_MS / 1000} s Takt` },
        { id: "queue", label: "ALLE → QUEUE", sub: `Sendeplan ${slotTimesLabel(cfg.slotTimes)}` },
        { id: "series", label: "FLEXIBEL", sub: "Startzeit + Abstand" },
        { id: "custom", label: "EIGENE ZEITEN", sub: "eine Zeit pro Video" },
      ];

  const KindIcon = KIND_ICON[plan.kind];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-coal-950/92 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ship-dialog-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="card-bracket relative my-auto w-full max-w-[760px] animate-rise border border-volt-400/50 bg-coal-900 shadow-[0_40px_120px_-40px_rgba(239,47,36,0.85)] outline-none"
      >
        {/* ------------------------------------------------ Kopf */}
        <header className="flex items-start justify-between gap-3 border-b border-coal-700/70 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="mono-label flex items-center gap-1.5 text-[9px] text-coal-400">
              <KindIcon className="size-3 text-volt-400" />
              06 · SENDEPLAN · {PLAN_KIND_LABEL[plan.kind]}
            </p>
            <h3
              id="ship-dialog-title"
              className="mt-1 truncate font-display text-base font-black tracking-[0.06em] text-paper-100 uppercase"
            >
              {single
                ? `Unit ${String((first?.index ?? 0) + 1).padStart(2, "0")} → Zernio`
                : `Alle ${count} Videos → Zernio`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dialog schließen"
            className="shrink-0 border border-coal-600 p-1.5 text-coal-300 hover:border-rose-err hover:text-rose-err"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid max-h-[calc(92dvh-8.5rem)] gap-4 overflow-y-auto px-4 py-4 sm:px-5">
          {/* ------------------------------------------- Ziel-Übersicht */}
          {single && first ? (
            <div className="flex items-center gap-3 border border-coal-700/80 bg-coal-850/60 p-2.5">
              {first.blobUrl ? (
                <video
                  src={first.blobUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-[74px] w-auto shrink-0 border border-coal-700 bg-black object-cover"
                  style={{ aspectRatio: "9 / 16" }}
                />
              ) : (
                <span className="grid h-[74px] w-[42px] shrink-0 place-items-center border border-coal-700 bg-coal-950">
                  <Layers className="size-4 text-coal-500" />
                </span>
              )}
              <div className="min-w-0">
                <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-coal-100">
                  {first.idea || "OHNE IDEA"}
                </p>
                <p className="mt-1 font-mono text-[9px] tracking-wider text-coal-400">
                  {first.duration ? `${formatDuration(first.duration)} · ` : ""}
                  {totalBytes ? `${formatBytes(totalBytes)} · ` : ""}
                  {first.mime?.includes("webm") ? "WEBM" : "MP4"} · DATEI{" "}
                  {`shortsfactory_${String(first.index + 1).padStart(2, "0")}`}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-coal-700/80 bg-coal-850/60 px-3 py-2.5 font-mono text-[9.5px] tracking-wider text-coal-300">
              <span className="flex items-center gap-1.5">
                <Layers className="size-3.5 text-volt-400" /> {count} VIDEOS
              </span>
              {totalBytes > 0 && <span>{formatBytes(totalBytes)} GESAMT</span>}
              <span>
                {SHIP_GAP_MS / 1000} s PAUSE ZWISCHEN JEDEM VIDEO
              </span>
              <span className="text-coal-500">
                {targets.map((t) => String(t.index + 1).padStart(2, "0")).join(" · ")}
              </span>
            </div>
          )}

          {/* ------------------------------------------- Wie senden? */}
          <Field label="WIE SENDEN?" hint={`ZEITZONE ${SHIP_TIMEZONE}`}>
            <Segmented<ShipPlanKind>
              columns={single ? 3 : 2}
              value={plan.kind}
              onChange={pickKind}
              options={kindOptions}
            />
          </Field>

          {/* ------------------------------------------- Plan-Details */}
          {plan.kind === "now" && (
            <p className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-coal-300">
              {single
                ? "DIESES VIDEO GEHT DIREKT NACH DEM UPLOAD RAUS (`publishNow: true`)."
                : `JEDES VIDEO GEHT DIREKT NACH DEM UPLOAD RAUS — ZWISCHEN ZWEI VIDEOS WARTET DIE FABRIK ${SHIP_GAP_MS / 1000} SEKUNDEN.`}
            </p>
          )}

          {(plan.kind === "at" || plan.kind === "series") && (
            <div className="grid gap-2.5">
              <label className="block">
                <span className="mono-label mb-1.5 block text-[9px] text-coal-400">
                  {plan.kind === "series" ? "START" : "SENDENZEIT"} ({SHIP_TIMEZONE})
                </span>
                <input
                  type="datetime-local"
                  value={plan.time}
                  onChange={(e) => set("time", e.target.value)}
                  className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[12px] text-paper-100"
                />
              </label>

              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_TIMES.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => set("time", quickTimeValue(q))}
                    className={cn(
                      "min-h-[30px] border px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest",
                      plan.time === quickTimeValue(q)
                        ? "border-volt-400/60 bg-volt-400/10 text-volt-300"
                        : "border-coal-600 text-coal-300 hover:border-volt-400 hover:text-volt-300"
                    )}
                  >
                    {q.label}
                  </button>
                ))}
                {plan.time && (
                  <button
                    type="button"
                    onClick={() => set("time", "")}
                    className="min-h-[30px] border border-coal-600 px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-400 hover:border-rose-err hover:text-rose-err"
                    title="Zeit entfernen — Video geht sofort raus"
                  >
                    LEEREN
                  </button>
                )}
              </div>

              {!single && (
                <Field label="ABSTAND ZWISCHEN DEN VIDEOS">
                  <Segmented<number>
                    columns={4}
                    value={plan.intervalMinutes}
                    onChange={(v) => set("intervalMinutes", v)}
                    options={FLEX_INTERVALS}
                  />
                </Field>
              )}

              {needsTime && (
                <p className="flex items-center gap-2 border border-amber-warn/50 bg-amber-warn/10 px-3 py-2 font-mono text-[9.5px] tracking-wider text-amber-warn">
                  <TriangleAlert className="size-3.5 shrink-0" /> BITTE EINE ZEIT WÄHLEN — ODER
                  „LEEREN" FÜR SOFORT-VERSAND.
                </p>
              )}
            </div>
          )}

          {plan.kind === "queue" && (
            <div className="grid gap-2.5">
              <div className="border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
                <p className="font-mono text-[10px] leading-relaxed text-coal-300">
                  {single
                    ? "DAS VIDEO BEKOMMT DEN NÄCHSTEN FREIEN PLATZ IM SENDEPLAN VON PANEL 06."
                    : "JEDES VIDEO BEKOMMT REIHERUM DEN NÄCHSTEN FREIEN PLATZ IM SENDEPLAN — ALLE AUF EINMAL EINGEREIHT."}
                </p>
                <p className="mt-1.5 font-mono text-[9px] tracking-wider text-coal-500">
                  SENDEZEITEN {slotTimesLabel(cfg.slotTimes)} · {SHIP_TIMEZONE} · ÄNDERBAR IM PANEL
                  06 („+ SENDZEIT")
                </p>
              </div>

              {single && (
                <div className="flex flex-wrap items-center justify-between gap-3 border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
                  <span className="mono-label text-[9px] text-coal-400">
                    POSITION IN DER QUEUE
                    <span className="mt-0.5 block font-mono text-[8.5px] text-coal-500">
                      {plan.queueOffset === 0
                        ? "nächster freier Platz"
                        : `überspringt ${plan.queueOffset} Platz${plan.queueOffset === 1 ? "" : "e"}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => set("queueOffset", Math.max(0, plan.queueOffset - 1))}
                      disabled={plan.queueOffset === 0}
                      className="size-8 border border-coal-600 font-mono text-[12px] font-bold text-coal-200 hover:border-volt-400 hover:text-volt-300 disabled:opacity-35"
                      aria-label="Queue-Platz zurück"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-mono text-[12px] font-bold text-volt-300 tabular-nums">
                      {plan.queueOffset}
                    </span>
                    <button
                      type="button"
                      onClick={() => set("queueOffset", Math.min(9, plan.queueOffset + 1))}
                      disabled={plan.queueOffset >= 9}
                      className="size-8 border border-coal-600 font-mono text-[12px] font-bold text-coal-200 hover:border-volt-400 hover:text-volt-300 disabled:opacity-35"
                      aria-label="Queue-Platz weiter"
                    >
                      +
                    </button>
                  </span>
                </div>
              )}

              {pendingScheduled > 0 && (
                <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed tracking-wider text-amber-warn">
                  <Inbox className="mt-0.5 size-3.5 shrink-0" />
                  {pendingScheduled} VIDEO{pendingScheduled === 1 ? "" : "S"} WARTEN BEREITS MIT EINEM
                  SLOT IN DER QUEUE — DIESE ZEITEN WERDEN ÜBERSPRUNGEN.
                </p>
              )}
            </div>
          )}

          {plan.kind === "custom" && (
            <div className="grid gap-2.5">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {targets.map((item, i) => {
                  const value = cfg.customTimes?.[item.index] ?? "";
                  const slot = slots[i];

                  return (
                    <div
                      key={item.index}
                      className="flex items-center gap-2 border border-coal-700/80 bg-coal-850/60 px-2.5 py-2"
                    >
                      <span className="font-mono text-[9.5px] text-coal-400 tabular-nums">
                        {String(item.index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-coal-500">
                        {value ? msToDateTimeLocalLabel(value) : "LEER = SOFORT"}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[9.5px] tracking-wider",
                          slot?.bumped ? "text-amber-warn" : "text-coal-200"
                        )}
                      >
                        {slot?.label ?? "SOFORT"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[9px] leading-relaxed tracking-wider text-coal-500">
                  DIE ZEITEN PRO VIDEO WERDEN IM PANEL 06 → „EIGENE ZEIT" GESETZT (MODUS „EIGENE
                  ZEIT"). LEERES FELD = DIESES VIDEO GEHT SOFORT RAUS.
                </p>
                <button
                  type="button"
                  onClick={onEditPanelTimes}
                  className="min-h-[32px] shrink-0 border border-coal-600 px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-200 hover:border-volt-400 hover:text-volt-300"
                >
                  IM PANEL BEARBEITEN
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------------------- Post-Details */}
          <div className="grid gap-2.5 border border-coal-700/80 bg-coal-950/40 p-3">
            <p className="mono-label text-[9px] text-coal-400">
              POST-DETAILS · OPTIONAL {single ? "" : `(GILT FÜR ALLE ${count})`}
            </p>
            <Field label="POST-TITEL" hint={`LEER = ${cfg.titleOverride.trim() ? "PANEL-TITEL" : "TITEL AUS DEM IDEA-FELD"}`}>
              <input
                type="text"
                value={plan.titleOverride}
                onChange={(e) => set("titleOverride", e.target.value)}
                placeholder={single ? (first?.idea || "z. B. AITA weil ich …") : "leer lassen = Titel aus dem Idea-Feld jedes Videos"}
                maxLength={100}
                className="sf-input w-full border border-coal-700/80 bg-coal-850 px-3 py-2.5 font-mono text-[11.5px] text-paper-100 placeholder:text-coal-600"
              />
            </Field>
            <Field label="HASHTAGS" hint={`LEER = ${cfg.hashtags.trim() || "KEINE"}`}>
              <span className="flex items-stretch border border-coal-700/80 bg-coal-850 focus-within:border-volt-400/70">
                <span className="grid w-9 place-items-center border-r border-coal-700/80 text-coal-400">
                  <Hash className="size-3.5" />
                </span>
                <input
                  type="text"
                  value={plan.hashtags}
                  onChange={(e) => set("hashtags", e.target.value)}
                  placeholder={cfg.hashtags || "#shorts #redditstories"}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[11.5px] text-paper-100 placeholder:text-coal-600 focus:outline-none"
                />
              </span>
            </Field>
            <Toggle
              label="ALS ENTWURF SPEICHERN"
              sub="landet als draft in zernio, wird nicht veröffentlicht"
              checked={plan.asDraft}
              onChange={(v) => set("asDraft", v)}
            />
          </div>

          {/* ------------------------------------------- Sendeplan-Vorschau */}
          <div className="border border-coal-700/80 bg-coal-950/40 p-3">
            <p className="mono-label mb-2 flex items-center justify-between gap-2 text-[9px] text-coal-400">
              <span className="flex items-center gap-1.5">
                <CalendarClock className="size-3" /> DEIN SENDEPLAN
              </span>
              <span className="text-volt-300">{summary}</span>
            </p>
            <ol className="grid gap-1">
              {targets.slice(0, 10).map((item, i) => {
                const slot = slots[i];
                return (
                  <li
                    key={item.index}
                    className="flex items-center justify-between gap-2 border-b border-coal-800/80 py-1 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-coal-500">
                      {String(item.index + 1).padStart(2, "0")} · {item.idea || "OHNE IDEA"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[9.5px] tracking-wider",
                        slot?.ms === null
                          ? "text-ember-400"
                          : slot?.bumped || slot?.shifted
                            ? "text-amber-warn"
                            : "text-coal-200"
                      )}
                      title={
                        slot?.bumped
                          ? "Zeit lag in der Vergangenheit → auf „jetzt + 2 min“ vorgezogen"
                          : slot?.shifted
                            ? "Slot war schon belegt → nach hinten geschoben"
                            : undefined
                      }
                    >
                      {slot?.label ?? "SOFORT"}
                      {slot?.bumped ? " (VORGEZOGEN)" : ""}
                      {slot?.shifted ? " (VERSCHOBEN)" : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* ------------------------------------------- Ziel-Accounts */}
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2.5",
              status?.configured && accounts.length > 0
                ? "border-volt-400/40 bg-volt-400/5"
                : "border-amber-warn/40 bg-amber-warn/5"
            )}
          >
            <span className="mono-label text-[9px] text-coal-400">GEHT AN</span>
            {accounts.length > 0 ? (
              accounts.map((a) => (
                <span
                  key={a.id}
                  className="border border-coal-700 bg-coal-950/50 px-2 py-0.5 font-mono text-[9px] tracking-wider text-coal-300"
                >
                  {platformLabel(a.platform).toUpperCase()}
                  {a.username ? ` · @${a.username.replace(/^@/, "")}` : ""}
                </span>
              ))
            ) : (
              <span className="font-mono text-[9.5px] text-amber-warn">
                {status?.configured
                  ? "KEY OK, ABER KEIN SOCIAL-ACCOUNT VERBUNDEN → zernio.com/dashboard"
                  : (status?.error ?? "ZERNIO_API_KEY FEHLT → VERCEL ENV SETZEN + NEU DEPLOYEN").slice(0, 160)}
              </span>
            )}
          </div>

          {running && (
            <p className="flex items-center gap-2 font-mono text-[9.5px] tracking-wider text-ember-400">
              <Loader2 className="size-3.5 animate-spin" /> VERSAND LÄUFT GERADE — DIESER PLAN WIRD
              AN DIE WARTESCHLANGE ANGEHÄNGT.
            </p>
          )}
        </div>

        {/* ------------------------------------------------ Fuß */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-coal-700/70 px-4 py-3 sm:px-5">
          <p className="font-mono text-[9px] leading-relaxed tracking-wider text-coal-500">
            {plan.asDraft ? "ENTWURF · " : ""}
            {count > 1 ? `${SHIP_GAP_MS / 1000} s TAKT ZWISCHEN JEDEM VIDEO · ` : ""}
            UPLOAD → `POST /v1/posts` · KEY BLEIBT SERVERSEITIG
          </p>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] border border-coal-600 px-4 py-2.5 font-display text-sm font-black tracking-tight text-coal-200 uppercase hover:border-rose-err hover:text-rose-err"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSend || !status?.configured || accounts.length === 0}
              title={
                !status?.configured
                  ? "ZERNIO_API_KEY fehlt"
                  : accounts.length === 0
                    ? "Kein Social-Account bei Zernio verbunden"
                    : summary
              }
              className={cn(
                "flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-2 border px-4 py-2.5 font-display text-sm font-black tracking-tight uppercase sm:flex-none",
                canSend && status?.configured && accounts.length > 0
                  ? "glow-volt bg-heat border-volt-400 text-coal-950 hover:opacity-90"
                  : "border-coal-700 text-coal-500"
              )}
            >
              {plan.asDraft ? (
                <Layers className="size-4" strokeWidth={2.4} />
              ) : plan.kind === "now" ? (
                <Rocket className="size-4" strokeWidth={2.4} />
              ) : plan.kind === "queue" ? (
                <Inbox className="size-4" strokeWidth={2.4} />
              ) : (
                <Send className="size-4" strokeWidth={2.4} />
              )}
              <span className="truncate">
                {plan.asDraft
                  ? `${count > 1 ? `${count} ` : ""}Entwurf${count > 1 ? "e" : ""} speichern`
                  : count > 1
                    ? `${count} Videos → Zernio`
                    : `→ Zernio · ${summary}`}
              </span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** "2026-09-25T20:00" → "25.09. 20:00" (nur Anzeige im Dialog). */
function msToDateTimeLocalLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return value;
  return `${m[3]}.${m[2]}. ${m[4]}:${m[5]}`;
}
