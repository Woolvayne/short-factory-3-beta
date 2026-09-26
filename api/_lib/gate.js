/**
 * ShortsFactory v3 — gemeinsames Passwort-Gate für alle Serverless-Routen.
 *
 * Liegt in `api/_lib/` → Vercel deployt daraus KEINE eigene Function, die Datei
 * wird nur in die Functions gebündelt, die sie importieren (`api/auth.js`,
 * `api/zernio.js`).
 *
 * Was hier passiert:
 *   1. Passwort-Prüfung — serverseitig, timing-safe.
 *      `APP_PASSWORD` (Klartext, empfohlen) ODER `APP_PASSWORD_HASH` (SHA-256).
 *      Aus Kompatibilität zu älteren Deployments werden `VITE_APP_PASSWORD` /
 *      `VITE_APP_PASSWORD_HASH` weiter akzeptiert (Vercel setzt jede Variable
 *      auch in `process.env` der Function — `VITE_` heißt nur: Vite bäckt sie
 *      zusätzlich ins Browser-Bundle).
 *   2. Sitzungs-Token — HMAC-signiert, mit Ablaufzeit. Kein Server-State nötig:
 *      der Schlüssel wird aus dem Passwort abgeleitet, jede Route kann das
 *      Token eigenständig prüfen (`verifyToken`).
 *   3. Rate-Limit pro IP — 5 Fehlversuche in Folge → Sperre. Danach eskaliert
 *      die Sperre (Standard: 5 min → 15 min → 1 h → 6 h → 24 h, danach 24 h).
 *      Gezählt wird pro IP; gespeichert wird nur ein gesalzener SHA-256-Hash
 *      der IP (keine Klartext-IP im Store, in den Logs oder im Dashboard).
 *
 * Speicher für die Zähler:
 *   • **Empfohlen:** Vercel KV / Upstash Redis über REST
 *     (`KV_REST_API_URL` + `KV_REST_API_TOKEN` bzw. `UPSTASH_REDIS_REST_URL`
 *     + `UPSTASH_REDIS_REST_TOKEN`) → Sperre gilt global über alle Instanzen.
 *   • **Fallback:** In-Memory pro Lambda-Instanz. Funktioniert, ist aber nicht
 *     global — bei mehreren parallelen Instanzen kann sich die Sperre
 *     verschieben. Details: docs/EINRICHTUNG.md
 */

import crypto from "node:crypto";

/* ------------------------------------------------------------------ */
/*  Konfiguration (nur serverseitig — niemals `VITE_` für APP_PASSWORD)  */
/* ------------------------------------------------------------------ */

const RAW_PASSWORD = String(process.env.APP_PASSWORD || process.env.VITE_APP_PASSWORD || "").trim();
const RAW_HASH = String(process.env.APP_PASSWORD_HASH || process.env.VITE_APP_PASSWORD_HASH || "")
  .trim()
  .toLowerCase();

/** Passwort-Prüfung aktiv? Ohne Passwort ist die Fabrik offen (wie bisher). */
export const gateConfigured = () => Boolean(RAW_PASSWORD || RAW_HASH);

/** `plain` | `hash` | `off` — nur für Statusmeldungen, nie das Passwort selbst. */
export const gateMode = () => (RAW_PASSWORD ? "plain" : RAW_HASH ? "hash" : "off");

const intFromEnv = (value, fallback, min, max) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Fehlversuche bis zur Sperre — Standard 5. */
export const maxAttempts = () => intFromEnv(process.env.APP_MAX_ATTEMPTS, 5, 1, 100);

/**
 * Sperr-Stufen in Minuten. Stufe 1 greift nach `APP_MAX_ATTEMPTS` Fehlversuchen,
 * jede weitere Sperre nimmt die nächste Stufe (letzte Stufe wiederholt sich).
 * Standard: 5 min, 15 min, 1 h, 6 h, 24 h.
 */
export const lockoutStepsMinutes = () => {
  const raw = String(process.env.APP_LOCKOUT_MINUTES || "").trim();
  const list = (raw ? raw.split(",") : ["5", "15", "60", "360", "1440"])
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 12);
  return list.length ? list : [5, 15, 60, 360, 1440];
};

/** Ablauf eines Sitzungs-Tokens in Sekunden — Standard 12 h. */
export const sessionTtlSeconds = () => intFromEnv(process.env.APP_SESSION_TTL, 12 * 3600, 60, 30 * 24 * 3600);

/* ------------------------------------------------------------------ */
/*  Speicher: Redis (REST) mit In-Memory-Fallback                      */
/* ------------------------------------------------------------------ */

const KV_URL = String(
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ""
).replace(/\/+$/, "");
const KV_TOKEN = String(
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ""
).trim();

export const rateLimitStore = () => (KV_URL && KV_TOKEN ? "redis" : "memory");

const memory = new Map(); // key → { value: string, expires: number }
const MEMORY_MAX = 5000;

const memorySweep = (now) => {
  for (const [key, entry] of memory) {
    if (entry.expires <= now) memory.delete(key);
  }
  if (memory.size <= MEMORY_MAX) return;
  /* Notbremse: älteste Einträge zuerst wegwerfen. */
  const overflow = memory.size - MEMORY_MAX;
  let dropped = 0;
  for (const key of memory.keys()) {
    memory.delete(key);
    if (++dropped >= overflow) break;
  }
};

async function kvGet(key) {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const value = data?.result ?? data?.value ?? null;
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

async function kvSet(key, value, ttlSeconds) {
  const ttl = Math.max(30, Math.round(ttlSeconds));
  if (KV_URL && KV_TOKEN) {
    try {
      await fetch(`${KV_URL}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify([["SET", key, value, "EX", String(ttl)]]),
        cache: "no-store",
      });
      return;
    } catch {
      /* Fall durch auf Memory — eine kaputte KV darf niemanden aussperren. */
    }
  }
  memory.set(key, { value, expires: Date.now() + ttl * 1000 });
  memorySweep(Date.now());
}

async function kvDel(key) {
  if (KV_URL && KV_TOKEN) {
    try {
      await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        cache: "no-store",
      });
    } catch {
      /* egal */
    }
  }
  memory.delete(key);
}

/* ------------------------------------------------------------------ */
/*  Krypto-Helfer                                                      */
/* ------------------------------------------------------------------ */

export const sha256Hex = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest("hex");

export const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) {
    /* Längenunterschied nicht sofort verraten: dummy-Vergleich + false */
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
};

/** Signaturschlüssel — aus dem Passwort abgeleitet, damit keine Extra-Variable nötig ist. */
const signingKey = () => sha256Hex(`shortsfactory::gate::v2::${RAW_PASSWORD || RAW_HASH}`);

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/* ------------------------------------------------------------------ */
/*  Passwort prüfen                                                    */
/* ------------------------------------------------------------------ */

/** Prüft das eingegebene Passwort gegen die Environment-Variable. */
export function passwordMatches(input) {
  if (!gateConfigured()) return true;
  const candidates = [String(input ?? ""), String(input ?? "").trim()];
  if (RAW_PASSWORD) {
    for (const candidate of candidates) {
      if (candidate && safeEqual(candidate, RAW_PASSWORD)) return true;
    }
    return false;
  }
  for (const candidate of candidates) {
    if (candidate && safeEqual(sha256Hex(candidate), RAW_HASH)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Sitzungs-Token                                                     */
/* ------------------------------------------------------------------ */

/**
 * Erzeugt ein signiertes Token. Format:  base64url(payload).base64url(hmac)
 * payload = { v: 2, iat, exp } — kein Passwort, kein Hash, keine IP.
 */
export function createToken(nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + sessionTtlSeconds();
  const payload = b64url(JSON.stringify({ v: 2, iat, exp }));
  const sig = b64url(crypto.createHmac("sha256", signingKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Prüft ein Token aus dem Header `x-sf-auth`. Liefert `{ ok, reason }`. */
export function verifyToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, reason: "missing" };
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "format" };
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = b64url(crypto.createHmac("sha256", signingKey()).update(payload).digest());
  if (!safeEqual(sig, expected)) return { ok: false, reason: "signature" };
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "payload" };
  }
  if (!claims || claims.v !== 2) return { ok: false, reason: "version" };
  if (Number(claims.exp) * 1000 <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, reason: "ok", claims };
}

/**
 * Prüft `x-sf-auth` so, wie es die Routen brauchen:
 *   • neues signiertes Token (bevorzugt)
 *   • Legacy: reiner SHA-256-Hash bzw. Klartext-Passwort als Token
 *     (so funktionierte der Schutz vor v3.1 — bleibt gültig, damit ältere
 *      Browser-Tabs nach einem Deploy nicht sofort rausfliegen)
 */
export function authenticateRequest(req) {
  if (!gateConfigured()) return { ok: true, mode: "off" };
  const token = String(req?.headers?.["x-sf-auth"] || "").trim();
  if (!token) return { ok: false, reason: "missing" };
  if (RAW_PASSWORD && safeEqual(token, RAW_PASSWORD)) return { ok: true, mode: "legacy-plain" };
  if (RAW_HASH && (safeEqual(token, RAW_HASH) || safeEqual(sha256Hex(token), RAW_HASH))) {
    return { ok: true, mode: "legacy-hash" };
  }
  const verified = verifyToken(token);
  return verified.ok ? { ok: true, mode: "token", claims: verified.claims } : verified;
}

/* ------------------------------------------------------------------ */
/*  IP + Rate-Limit                                                    */
/* ------------------------------------------------------------------ */

/** Client-IP hinter Vercel/Cloudflare — erster Eintrag der Forward-Kette. */
export function clientIp(req) {
  const header = (name) => String(req?.headers?.[name] || "").split(",")[0].trim();
  return (
    header("x-vercel-forwarded-for") ||
    header("x-forwarded-for") ||
    header("x-real-ip") ||
    header("cf-connecting-ip") ||
    header("x-client-ip") ||
    String(req?.socket?.remoteAddress || "unknown")
  );
}

/** Nur der Hash der IP landet im Store (Datenschutz + kompakte Keys). */
const recordKey = (ip) => `sf:gate:${sha256Hex(`${signingKey()}::${ip}`).slice(0, 40)}`;

const MAX_RECORD_TTL = 7 * 24 * 3600;

const emptyRecord = () => ({ fails: 0, level: 0, lockedUntil: 0, lastFailure: 0, total: 0 });

async function readRecord(ip) {
  const raw = await kvGet(recordKey(ip));
  if (!raw) return emptyRecord();
  try {
    const parsed = JSON.parse(raw);
    return {
      fails: Math.max(0, Number(parsed?.fails) || 0),
      level: Math.max(0, Number(parsed?.level) || 0),
      lockedUntil: Math.max(0, Number(parsed?.lockedUntil) || 0),
      lastFailure: Math.max(0, Number(parsed?.lastFailure) || 0),
      total: Math.max(0, Number(parsed?.total) || 0),
    };
  } catch {
    return emptyRecord();
  }
}

const writeRecord = (ip, record) =>
  kvSet(recordKey(ip), JSON.stringify(record), MAX_RECORD_TTL);

export const clearRecord = (ip) => kvDel(recordKey(ip));

/** Zustand einer IP — für die Status-Anzeige im Gate (ohne Passwort zu verraten). */
export async function rateLimitState(ip, nowMs = Date.now()) {
  const steps = lockoutStepsMinutes();
  const record = await readRecord(ip);
  const retryAfterSeconds = Math.max(0, Math.ceil((record.lockedUntil - nowMs) / 1000));
  return {
    locked: retryAfterSeconds > 0,
    retryAfterSeconds,
    lockedUntil: record.lockedUntil || null,
    /** Fehlversuche seit der letzten Sperre */
    failures: record.fails,
    attemptsLeft: Math.max(0, maxAttempts() - record.fails),
    /** wie oft diese IP schon gesperrt wurde (0 = noch nie) */
    level: record.level,
    totalFailures: record.total,
    maxAttempts: maxAttempts(),
    schedule: steps,
    /** Länge der nächsten Sperre in Minuten */
    nextLockoutMinutes: steps[Math.min(record.level, steps.length - 1)],
    store: rateLimitStore(),
  };
}

/**
 * Registriert einen Fehlversuch und sperrt die IP, wenn `APP_MAX_ATTEMPTS`
 * erreicht ist. Liefert den neuen Zustand inkl. Restzeit.
 */
export async function registerFailure(ip, nowMs = Date.now()) {
  const steps = lockoutStepsMinutes();
  const record = await readRecord(ip);
  record.fails += 1;
  record.total += 1;
  record.lastFailure = nowMs;

  let justLocked = false;
  if (record.fails >= maxAttempts()) {
    const index = Math.min(record.level, steps.length - 1);
    const lockMs = steps[index] * 60_000;
    record.lockedUntil = nowMs + lockMs;
    record.level = Math.min(record.level + 1, steps.length); /* Stufe bleibt oben stehen */
    record.fails = 0;
    justLocked = true;
  }

  await writeRecord(ip, record);

  const retryAfterSeconds = Math.max(0, Math.ceil((record.lockedUntil - nowMs) / 1000));
  return {
    locked: retryAfterSeconds > 0,
    justLocked,
    retryAfterSeconds,
    lockedUntil: record.lockedUntil || null,
    failures: record.fails,
    attemptsLeft: Math.max(0, maxAttempts() - record.fails),
    level: record.level,
    totalFailures: record.total,
    maxAttempts: maxAttempts(),
    schedule: steps,
    nextLockoutMinutes: steps[Math.min(record.level, steps.length - 1)],
    store: rateLimitStore(),
  };
}

/** Nach erfolgreicher Anmeldung: Zähler dieser IP zurücksetzen. */
export const registerSuccess = (ip) => clearRecord(ip);

/** "5 min" / "1 h 30 min" / "2 Tage" — für Meldungen im Frontend und in den Docs. */
export function humanizeMinutes(minutes) {
  const m = Math.max(1, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} Tag(e) ${restHours} h` : `${days} Tag(e)`;
}
