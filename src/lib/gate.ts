/**
 * Onepage-Passwort-Gate — Client-Seite.
 *
 * Ab v3.1 läuft die Prüfung **serverseitig** über `/api/auth`:
 *
 *   • Das Passwort kommt aus einer Vercel-Environment-Variable
 *     (`APP_PASSWORD` — Klartext, serverseitig — oder `APP_PASSWORD_HASH`).
 *   • Nach 5 Fehlversuchen in Folge sperrt der Server die **IP** — mit
 *     eskalierenden Sperrzeiten (5 min → 15 min → 1 h → 6 h → 24 h).
 *     Ohne KV/Redis gilt die Sperre pro warmer Lambda-Instanz, mit Vercel KV
 *     global. Details: docs/EINRICHTUNG.md
 *   • Bei Erfolg gibt es ein signiertes Token. Das liegt **nur im
 *     Arbeitsspeicher dieses Tabs** — kein localStorage, kein sessionStorage.
 *     Ergebnis: Bei jedem Neuladen (F5) muss das Passwort erneut eingegeben
 *     werden, genau wie gewünscht.
 *
 * Fallback ohne Server-Function (z. B. reiner `npm run dev` ohne vercel dev,
 * oder ein Deploy ohne Passwort-Variable): Ist `VITE_APP_PASSWORD_HASH` bzw.
 * `VITE_APP_PASSWORD` beim Build gesetzt, prüft der Browser lokal weiterhin
 * gegen den Hash. Dann gilt ein eigenes, gleich aufgebautes Rate-Limit im
 * Browser (pro Gerät, nicht pro IP) und die Zernio-Route prüft denselben Wert
 * serverseitig über `x-sf-auth`.
 */

/** Vite ersetzt diese Werte beim Build — nur für den Offline-Fallback nötig. */
const ENV_HASH = String(import.meta.env.VITE_APP_PASSWORD_HASH ?? "")
  .trim()
  .toLowerCase();
const ENV_PLAIN = String(import.meta.env.VITE_APP_PASSWORD ?? "").trim();

export type GateMode = "server" | "hash" | "plain" | "off";

/** Standard-Sperrstufen (Minuten) — identisch zu api/_lib/gate.js. */
export const DEFAULT_LOCKOUT_MINUTES = [5, 15, 60, 360, 1440];

export interface GateStatus {
  /** "server" = /api/auth aktiv · "hash"/"plain" = lokaler Fallback · "off" = kein Passwort */
  mode: GateMode;
  /** Muss die Seite ein Passwort verlangen? */
  requirePassword: boolean;
  /** Antwortet die Serverless-Route? (false → lokaler Fallback) */
  serverReachable: boolean;
  locked: boolean;
  retryAfterSeconds: number;
  lockedUntil: number | null;
  attemptsLeft: number;
  failures: number;
  /** Wie oft diese IP in diesem Zeitraum schon gesperrt wurde (Eskalation). */
  level: number;
  maxAttempts: number;
  schedule: number[];
  nextLockoutMinutes: number;
  store: "redis" | "memory" | "browser";
  sessionTtlSeconds: number;
  error?: string;
}

export const FALLBACK_STATUS: GateStatus = {
  mode: "off",
  requirePassword: false,
  serverReachable: false,
  locked: false,
  retryAfterSeconds: 0,
  lockedUntil: null,
  attemptsLeft: 5,
  failures: 0,
  level: 0,
  maxAttempts: 5,
  schedule: DEFAULT_LOCKOUT_MINUTES,
  nextLockoutMinutes: DEFAULT_LOCKOUT_MINUTES[0],
  store: "browser",
  sessionTtlSeconds: 12 * 3600,
};

/* ------------------------------------------------------------------ */
/*  Sitzung: NUR im Arbeitsspeicher (Reload = neues Passwort)          */
/* ------------------------------------------------------------------ */

let sessionToken: string | null = null;
let sessionExpiresAt = 0;
/** Wird beim Status-Check gesetzt: true, wenn `/api/auth` ein Passwort kennt. */
let serverGateConfigured = false;

export const setServerGateConfigured = (value: boolean): void => {
  serverGateConfigured = value;
};

export const gateEnabled = (): boolean =>
  Boolean(ENV_HASH) || Boolean(ENV_PLAIN) || serverGateConfigured;

export function isUnlocked(): boolean {
  if (!sessionToken) return false;
  if (sessionExpiresAt && Date.now() >= sessionExpiresAt) {
    sessionToken = null;
    return false;
  }
  return true;
}

export function lock(): void {
  sessionToken = null;
  sessionExpiresAt = 0;
}

/**
 * Wird ausgelöst, wenn eine Route hinter dem Gate `401` meldet (Token
 * abgelaufen) — die App zeigt dann wieder die Passwort-Seite.
 */
export const GATE_EXPIRED_EVENT = "shortsfactory:gate-expired";

export function notifyGateExpired(): void {
  try {
    window.dispatchEvent(new Event(GATE_EXPIRED_EVENT));
  } catch {
    /* kein Fenster (SSR/Tests) — egal */
  }
}

/** Header für alle Routen, die hinter dem Gate liegen (`/api/zernio`). */
export function gateHeaders(): Record<string, string> {
  const token = isUnlocked() ? sessionToken : null;
  if (token) return { "x-sf-auth": token };
  /* Legacy-Fallback ohne Server-Function: Hash/Passwort als Token. */
  if (ENV_HASH) return { "x-sf-auth": ENV_HASH };
  if (ENV_PLAIN) return { "x-sf-auth": ENV_PLAIN };
  return {};
}

/* ------------------------------------------------------------------ */
/*  Krypto-Helfer (nur für den Offline-Fallback)                       */
/* ------------------------------------------------------------------ */

/** SHA-256 hex — braucht einen secure context (HTTPS oder localhost). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "crypto.subtle fehlt — die Passwort-Prüfung läuft nur über HTTPS oder localhost."
    );
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Längenunabhängiger Vergleich, damit Timing nichts verrät. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/*  Lokaler Fallback — Zähler pro Gerät (kein Server vorhanden)        */
/* ------------------------------------------------------------------ */

interface LocalState {
  fails: number;
  level: number;
  lockedUntil: number;
}

let localState: LocalState = { fails: 0, level: 0, lockedUntil: 0 };

const localStatus = (): GateStatus => {
  const retryAfterSeconds = Math.max(0, Math.ceil((localState.lockedUntil - Date.now()) / 1000));
  return {
    ...FALLBACK_STATUS,
    mode: ENV_HASH ? "hash" : "plain",
    requirePassword: true,
    serverReachable: false,
    locked: retryAfterSeconds > 0,
    retryAfterSeconds,
    lockedUntil: localState.lockedUntil || null,
    failures: localState.fails,
    attemptsLeft: Math.max(0, FALLBACK_STATUS.maxAttempts - localState.fails),
    level: localState.level,
    store: "browser",
  };
};

/* ------------------------------------------------------------------ */
/*  Server-Kommunikation                                               */
/* ------------------------------------------------------------------ */

const AUTH_ENDPOINT = "/api/auth";

const asStatus = (data: Record<string, unknown> | null): GateStatus => ({
  mode: "server",
  requirePassword: true,
  serverReachable: true,
  locked: Boolean(data?.locked),
  retryAfterSeconds: Number(data?.retryAfterSeconds ?? 0),
  lockedUntil: data?.lockedUntil ? Number(data.lockedUntil) : null,
  attemptsLeft: Number(data?.attemptsLeft ?? FALLBACK_STATUS.maxAttempts),
  failures: Number(data?.failures ?? 0),
  level: Number(data?.level ?? 0),
  maxAttempts: Number(data?.maxAttempts ?? FALLBACK_STATUS.maxAttempts),
  schedule:
    Array.isArray(data?.schedule) && data.schedule.length
      ? (data.schedule as number[]).map(Number)
      : DEFAULT_LOCKOUT_MINUTES,
  nextLockoutMinutes: Number(data?.nextLockoutMinutes ?? DEFAULT_LOCKOUT_MINUTES[0]),
  store: (data?.store === "redis" ? "redis" : "memory") as GateStatus["store"],
  sessionTtlSeconds: Number(data?.sessionTtlSeconds ?? FALLBACK_STATUS.sessionTtlSeconds),
});

/**
 * Fragt den Server: Passwort nötig? IP gesperrt? Wie viele Versuche frei?
 * Ist die Route nicht erreichbar oder ohne Passwort konfiguriert, greift der
 * lokale Fallback (bzw. das Gate ist ganz aus).
 */
export async function fetchGateStatus(): Promise<GateStatus> {
  try {
    const res = await fetch(`${AUTH_ENDPOINT}?action=status`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (data && data.configured) {
        setServerGateConfigured(true);
        return asStatus(data);
      }
      /* Server erreichbar, aber kein Passwort gesetzt. */
      setServerGateConfigured(false);
      if (!ENV_HASH && !ENV_PLAIN) return { ...FALLBACK_STATUS };
      return localStatus();
    }
  } catch {
    /* Route fehlt / offline → lokaler Fallback */
  }
  if (!ENV_HASH && !ENV_PLAIN) return { ...FALLBACK_STATUS };
  return localStatus();
}

export type UnlockResult =
  | { ok: true; token: string; message?: string }
  | { ok: false; status: GateStatus; message: string; code: "FALSCH" | "GESPERRT" | "FEHLER" | "LEER" };

/**
 * Schickt das Passwort an `/api/auth`. Bei Fehlversuch kommt der neue
 * Zählerstand (inkl. Sperre) zurück, bei Erfolg das Sitzungs-Token.
 */
export async function unlock(password: string): Promise<UnlockResult> {
  /* ---- Server-Weg ---- */
  try {
    const res = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "unlock", password }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    /* Kein JSON = keine echte Route (z. B. SPA-Fallback) → lokaler Weg. */
    if (!data || typeof data !== "object" || typeof data.ok === "undefined") {
      throw new Error("__NO_ROUTE__");
    }

    if (res.ok && data.ok && typeof data.token === "string") {
      sessionToken = data.token;
      sessionExpiresAt = Number(data.expiresAt ?? 0) || Date.now() + 12 * 3600 * 1000;
      localState = { fails: 0, level: 0, lockedUntil: 0 };
      return { ok: true, token: data.token, message: String(data.message ?? "") };
    }

    if (res.status === 404) throw new Error("__NO_ROUTE__");

    const status = asStatus(data);
    const raw = String(data?.error ?? "").toUpperCase();
    const code: "FALSCH" | "GESPERRT" | "LEER" | "FEHLER" =
      raw === "FALSCH" || raw === "GESPERRT" || raw === "LEER" ? raw : "FEHLER";
    const message =
      typeof data?.message === "string" && data.message
        ? data.message
        : code === "GESPERRT"
          ? "Zu viele Fehlversuche — diese IP ist vorübergehend gesperrt."
          : code === "LEER"
            ? "Bitte ein Passwort eingeben."
            : "Falsches Passwort.";
    return { ok: false, status, message, code };
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__NO_ROUTE__") {
      /* Netzwerkfehler → lokaler Fallback versuchen */
    }
  }

  /* ---- Lokaler Fallback (kein Server / dev-Server) ---- */
  return localUnlock(password);
}

/** Prüfung im Browser gegen die eingebackene Variable + lokales Rate-Limit. */
async function localUnlock(password: string): Promise<UnlockResult> {
  const state = localStatus();
  if (state.locked) return { ok: false, status: state, message: "Gesperrt — bitte warten.", code: "GESPERRT" };
  if (!password.trim()) {
    return { ok: false, status: state, message: "Bitte ein Passwort eingeben.", code: "LEER" };
  }
  if (!ENV_HASH && !ENV_PLAIN) {
    /* Kein Passwort konfiguriert → direkt rein. */
    sessionToken = "open";
    sessionExpiresAt = 0;
    return { ok: true, token: "open" };
  }

  let match = false;
  const candidates = [password, password.trim()];
  if (ENV_HASH) {
    for (const candidate of candidates) {
      if (safeEqual(await sha256Hex(candidate), ENV_HASH)) {
        match = true;
        break;
      }
    }
  } else {
    for (const candidate of candidates) {
      if (safeEqual(candidate, ENV_PLAIN)) {
        match = true;
        break;
      }
    }
  }

  if (match) {
    sessionToken = ENV_HASH ? ENV_HASH : ENV_PLAIN;
    sessionExpiresAt = Date.now() + FALLBACK_STATUS.sessionTtlSeconds * 1000;
    localState = { fails: 0, level: 0, lockedUntil: 0 };
    return { ok: true, token: sessionToken };
  }

  localState.fails += 1;
  if (localState.fails >= FALLBACK_STATUS.maxAttempts) {
    const steps = DEFAULT_LOCKOUT_MINUTES;
    const index = Math.min(localState.level, steps.length - 1);
    localState.lockedUntil = Date.now() + steps[index] * 60_000;
    localState.level = Math.min(localState.level + 1, steps.length);
    localState.fails = 0;
    return {
      ok: false,
      status: localStatus(),
      message: `5 Fehlversuche in Folge — für ${humanizeMinutes(steps[index])} gesperrt (ohne Server nur in diesem Browser).`,
      code: "GESPERRT",
    };
  }
  return {
    ok: false,
    status: localStatus(),
    message: `Falsches Passwort. Noch ${FALLBACK_STATUS.maxAttempts - localState.fails} Versuch(e) bis zur Sperre.`,
    code: "FALSCH",
  };
}

/* ------------------------------------------------------------------ */
/*  Anzeige-Helfer                                                     */
/* ------------------------------------------------------------------ */

export function humanizeMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} Tag(e) ${restHours} h` : `${days} Tag(e)`;
}

/** "4 min 12 s" bzw. "1 h 05 min" — für den Live-Countdown im Gate. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes} min ${String(rest).padStart(2, "0")} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export const gateInfo = (status: GateStatus | null) => {
  const mode = status?.mode ?? (ENV_HASH ? "hash" : ENV_PLAIN ? "plain" : "off");
  return {
    mode,
    enabled: mode !== "off",
    hint:
      mode === "server"
        ? "Prüfung läuft serverseitig über /api/auth (APP_PASSWORD in Vercel). Jede falsche Eingabe zählt pro IP."
        : mode === "hash"
          ? "Offline-Modus: Prüfung gegen VITE_APP_PASSWORD_HASH im Browser (kein Server erreichbar)."
          : mode === "plain"
            ? "Offline-Modus: VITE_APP_PASSWORD (Klartext) — besser APP_PASSWORD serverseitig setzen."
            : "Kein Passwort gesetzt → die App ist offen. Anleitung: docs/EINRICHTUNG.md",
  };
};
