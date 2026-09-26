/**
 * Versand-Plan — die Logik hinter dem Sendeplan-Dialog.
 *
 * Ein „Plan" beschreibt, WIE ein Post (oder ein ganzer Stapel) zu Zernio soll:
 *
 *   `now`    → sofort veröffentlichen (`publishNow`)
 *   `at`     → flexibel planen: eine eigene Uhrzeit (Europe/Berlin)
 *   `queue`  → in die Queue einreihen: nächster freier Platz im Sendeplan
 *              (Standard 06:00 & 20:00 Uhr, im Panel `06` editierbar)
 *   `series` → Startzeit + fester Abstand (alle Videos hintereinander verplant)
 *   `custom` → die 10 eigenen Zeiten aus dem Panel `06` (Zeit pro Unit-Index)
 *
 * Der Plan wird beim Einreihen in die Warteschlange EINMAL in konkrete
 * `Slot`s übersetzt (`slotsForPlan`) und hängt dann am Queue-Eintrag — so kann
 * jeder Post seinen eigenen Zeitpunkt haben, während die Queue stur mit dem
 * 3-Sekunden-Takt (`SHIP_GAP_MS`) abgearbeitet wird.
 */

import type { LocalRenderItem } from "./types";
import {
  berlinParts,
  berlinWallToMs,
  computeSlots,
  defaultFlexStart,
  msToDateTimeLocal,
  parseDateTimeLocal,
  msToBerlinWall,
  formatSlotLabel,
  type ShipConfig,
  type Slot,
} from "./zernio";

export type ShipPlanKind = "now" | "at" | "queue" | "series" | "custom";

export interface ShipPlan {
  kind: ShipPlanKind;
  /**
   * `datetime-local`-Wert ("YYYY-MM-DDTHH:mm", Europe/Berlin):
   * bei `at` die Sendezeit, bei `series` die Startzeit. Leer = keine Zeit.
   */
  time: string;
  /** Abstand zwischen zwei Videos in Minuten (`series`, bzw. `at` im Stapel) */
  intervalMinutes: number;
  /**
   * Queue-Position: `0` = nächste freie Sendezeit, `2` = zwei Plätze später.
   * Wird beim Einreihen automatisch um bereits verplante Queue-Einträge erhöht.
   */
  queueOffset: number;
  /** als Entwurf zu Zernio (wird nicht veröffentlicht) */
  asDraft: boolean;
  /** Titel nur für diesen Versand — leer = Einstellung aus dem Panel `06` */
  titleOverride: string;
  /** Hashtags nur für diesen Versand — leer = Einstellung aus dem Panel `06` */
  hashtags: string;
}

/** Ein Eintrag in der Versand-Warteschlange: Video + fertiger Slot + Config. */
export interface ShipQueueEntry {
  item: LocalRenderItem;
  slot: Slot;
  cfg: ShipConfig;
  /** woraus der Slot entstanden ist — `queue`-Plätze zählen für den nächsten freien Platz */
  via: ShipPlanKind;
}

/** Frühester sinnvoller Sendezeitpunkt ( identisch zu `computeSlots` ). */
const MIN_FUTURE_MS = 2 * 60_000;

const SOFORT: Slot = { ms: null, wall: null, label: "SOFORT" };

export function emptyPlan(kind: ShipPlanKind = "now", asDraft = false): ShipPlan {
  return {
    kind,
    time: "",
    intervalMinutes: 720,
    queueOffset: 0,
    asDraft,
    titleOverride: "",
    hashtags: "",
  };
}

/* ------------------------------------------------------------------ */
/*  Schnellwahl-Zeiten für „EIGENE ZEIT"                                */
/* ------------------------------------------------------------------ */

export interface QuickTime {
  id: string;
  label: string;
  /** relativer Abstand in Minuten */
  minutes?: number;
  /** feste Uhrzeit (Europe/Berlin) … */
  hour?: number;
  /** … plus Tagesversatz (0 = heute, 1 = morgen) */
  dayOffset?: number;
}

export const QUICK_TIMES: QuickTime[] = [
  { id: "m15", label: "+15 MIN", minutes: 15 },
  { id: "h1", label: "+1 STD", minutes: 60 },
  { id: "h3", label: "+3 STD", minutes: 180 },
  { id: "h20", label: "20 UHR", hour: 20, dayOffset: 0 },
  { id: "h6", label: "06 UHR", hour: 6, dayOffset: 1 },
];

/** Quick-Time-Chip → `datetime-local`-Wert (liegt die Zeit in der Vergangenheit, einen Tag weiter). */
export function quickTimeValue(q: QuickTime, nowMs: number = Date.now()): string {
  if (typeof q.minutes === "number") return msToDateTimeLocal(nowMs + q.minutes * 60_000);
  const hour = q.hour ?? 20;
  const p = berlinParts(new Date(nowMs));
  let ms = berlinWallToMs(p.year, p.month, p.day + (q.dayOffset ?? 0), hour, 0);
  if (ms <= nowMs + MIN_FUTURE_MS) ms = berlinWallToMs(p.year, p.month, p.day + (q.dayOffset ?? 0) + 1, hour, 0);
  return msToDateTimeLocal(ms);
}

/** Standard-Startzeit für „EIGENE ZEIT": jetzt + 10 Minuten. */
export const defaultPlanTime = (nowMs: number = Date.now()) => msToDateTimeLocal(nowMs + 10 * 60_000);

/* ------------------------------------------------------------------ */
/*  Plan → Slots                                                        */
/* ------------------------------------------------------------------ */

/**
 * Übersetzt einen Plan in `count` konkrete Sendezeiten.
 * Reihenfolge = Versand-Reihenfolge (Ausnahme `custom`: Zeile = Unit-Index).
 */
export function slotsForPlan(
  plan: ShipPlan,
  cfg: ShipConfig,
  count: number,
  nowMs: number = Date.now()
): Slot[] {
  const n = Math.max(1, count);

  if (plan.kind === "now") return Array.from({ length: n }, () => ({ ...SOFORT }));

  /* in die Queue einreihen: nächste freie Sendezeit aus dem Panel-Sendeplan */
  if (plan.kind === "queue") {
    const offset = Math.max(0, plan.queueOffset);
    const all = computeSlots({ ...cfg, mode: "slots" }, n + offset, nowMs);
    const picked = all.slice(offset, offset + n);
    while (picked.length < n) picked.push({ ...SOFORT });
    return picked;
  }

  /* die 10 eigenen Zeiten aus dem Panel (Zeile = Unit-Index) */
  if (plan.kind === "custom") return computeSlots({ ...cfg, mode: "custom" }, n, nowMs);

  /* Startzeit + fester Abstand */
  if (plan.kind === "series") {
    return computeSlots(
      {
        ...cfg,
        mode: "flex",
        flexStart: plan.time || defaultFlexStart(nowMs),
        flexIntervalMinutes: Math.max(1, plan.intervalMinutes),
      },
      n,
      nowMs
    );
  }

  /* `at`: eine feste Uhrzeit — im Stapel folgen die weiteren Videos im Abstand */
  const parsed = parseDateTimeLocal(plan.time);
  if (parsed === null) return Array.from({ length: n }, () => ({ ...SOFORT }));
  const bumped = parsed <= nowMs + MIN_FUTURE_MS;
  const start = bumped ? nowMs + MIN_FUTURE_MS : parsed;
  const interval = Math.max(1, plan.intervalMinutes) * 60_000;
  return Array.from({ length: n }, (_, i) => {
    const ms = start + i * interval;
    return {
      ms,
      wall: msToBerlinWall(ms),
      label: formatSlotLabel(ms),
      bumped: bumped && i === 0,
    };
  });
}

/**
 * Verhindert Doppelbuchungen: liegt ein Slot schon in der Queue (oder doppelt
 * im eigenen Stapel), wird er um `stepMs` nach hinten geschoben.
 */
export function avoidSlotCollisions(slots: Slot[], taken: Set<number>, stepMs: number): Slot[] {
  const used = new Set(taken);
  const step = Math.max(60_000, stepMs);
  return slots.map((slot) => {
    if (slot.ms === null) return slot;
    let ms = slot.ms;
    let guard = 0;
    while (used.has(ms) && guard < 500) {
      ms += step;
      guard += 1;
    }
    used.add(ms);
    if (ms === slot.ms) return slot;
    return { ms, wall: msToBerlinWall(ms), label: formatSlotLabel(ms), shifted: true };
  });
}

/** Panel-Einstellungen + Plan-Overrides (Titel, Hashtags, Entwurf). */
export function configForPlan(plan: ShipPlan, cfg: ShipConfig): ShipConfig {
  return {
    ...cfg,
    asDraft: plan.asDraft,
    titleOverride: plan.titleOverride.trim() || cfg.titleOverride,
    hashtags: plan.hashtags.trim() || cfg.hashtags,
  };
}

/**
 * Slots passend zu einer konkreten Unit-Liste: normalerweise in
 * Versand-Reihenfolge, im Modus `custom` über den Unit-Index
 * (Video 01 bekommt Zeile 01 usw.).
 */
export function slotsForTargets(
  plan: ShipPlan,
  cfg: ShipConfig,
  targets: LocalRenderItem[],
  nowMs: number = Date.now()
): Slot[] {
  const byUnitIndex = plan.kind === "custom";
  const list = slotsForPlan(plan, cfg, byUnitIndex ? 10 : targets.length, nowMs);
  return targets.map(
    (item, position) => (byUnitIndex ? list[item.index] : list[position]) ?? { ...SOFORT }
  );
}

/** Kurzfassung für Buttons: „HEUTE 20:00" bzw. „10 × HEUTE 20:00 → FR 26.09. 06:00". */
export function summarizeSlots(slots: Slot[]): string {
  const first = slots[0]?.label ?? "SOFORT";
  if (slots.length <= 1) return first;
  const last = slots[slots.length - 1]?.label ?? first;
  return first === last ? `${slots.length} × ${first}` : `${slots.length} × ${first} → ${last}`;
}

/** Kurzfassung direkt aus einem Plan (ohne Unit-Liste). */
export function planSummary(
  plan: ShipPlan,
  cfg: ShipConfig,
  count: number,
  nowMs: number = Date.now()
): string {
  return summarizeSlots(slotsForPlan(plan, cfg, count, nowMs));
}

/**
 * Vorbelegung des Dialogs aus den Panel-Einstellungen: was dort ausgewählt ist,
 * ist im Dialog die erste Wahl — ändern kann man es dort trotzdem.
 */
export function defaultPlanFor(
  cfg: ShipConfig,
  scope: "single" | "batch",
  index = 0,
  nowMs: number = Date.now()
): ShipPlan {
  const base: ShipPlan = {
    ...emptyPlan("now", cfg.asDraft),
    intervalMinutes: cfg.flexIntervalMinutes > 0 ? cfg.flexIntervalMinutes : 720,
  };

  if (scope === "single") {
    switch (cfg.mode) {
      case "slots":
        return { ...base, kind: "queue" };
      case "custom": {
        const time = String(cfg.customTimes?.[index] ?? "");
        return time ? { ...base, kind: "at", time } : { ...base, kind: "now" };
      }
      case "flex":
        return { ...base, kind: "at", time: cfg.flexStart || defaultPlanTime(nowMs) };
      case "now":
      default:
        return { ...base, kind: "now" };
    }
  }

  switch (cfg.mode) {
    case "slots":
      return { ...base, kind: "queue" };
    case "custom":
      return { ...base, kind: "custom" };
    case "flex":
      return {
        ...base,
        kind: "series",
        time: cfg.flexStart || defaultFlexStart(nowMs),
        intervalMinutes: cfg.flexIntervalMinutes > 0 ? cfg.flexIntervalMinutes : 720,
      };
    case "now":
    default:
      return { ...base, kind: "now" };
  }
}

/**Plan-Beschreibung für Hinweise/Tooltips (ohne Zeiten neu zu rechnen). */
export const PLAN_KIND_LABEL: Record<ShipPlanKind, string> = {
  now: "SOFORT",
  at: "EIGENE ZEIT",
  queue: "QUEUE",
  series: "FLEXIBEL",
  custom: "EIGENE ZEITEN",
};
