/**
 * ShortsFactory v3 — Zernio Versandweg (Vercel Serverless Function, Node.js)
 *
 * Was diese Route tut:
 *   1. `GET  ?action=status`        → ist ZERNIO_API_KEY gesetzt? Welche Accounts
 *                                     sind in Zernio verbunden? (GET /v1/accounts)
 *   2. `POST {action:"presign"}`    → Upload-URL bei Zernio holen
 *                                     (POST /v1/media/presign, bis 5 GB)
 *   3. `POST /api/zernio/upload`    → Fallback: Video-Bytes serverseitig an die
 *                                     Presigned-URL weiterleiten (PUT), falls der
 *                                     Browser-Direktupload an CORS scheitert.
 *   4. `POST {action:"publish"}`    → Post anlegen (POST /v1/posts):
 *                                     sofort (`publishNow`) ODER geplant
 *                                     (`scheduledFor` + `timezone`).
 *   5. `POST {action:"post-status"}`→ Status eines Posts nachschlagen.
 *
 * Sicherheit:
 *   - ZERNIO_API_KEY lebt NUR hier (process.env) und gelangt nie ins Bundle.
 *   - Ist APP_PASSWORD / APP_PASSWORD_HASH (oder das alte VITE_Pendant) gesetzt,
 *     verlangt diese Route zusätzlich den Header `x-sf-auth` — entweder das
 *     signierte Sitzungs-Token aus `/api/auth` oder (Legacy) den Passwort-Hash.
 *     Ohne gültiges Token gibt es 401, dein Zernio-Key ist also sicher.
 *   - Kein Kalender, keine Slots, keine Datenbank: Zeiten rechnet das Frontend,
 *     hier wird nur 1:1 an die Zernio-API durchgereicht.
 *
 * Zernio API: https://zernio.com/api/v1 · Docs: https://docs.zernio.com
 */

import crypto from "node:crypto";
import { authenticateRequest, gateConfigured, gateMode } from "./_lib/gate.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

const BASE_URL = (process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1").replace(/\/+$/, "");
const API_KEY = (process.env.ZERNIO_API_KEY || "").trim();

/* ------------------------------------------------------------------ */
/*  Gate: dasselbe Passwort wie der Onepage-Schutz                     */
/*                                                                     */
/*  Geprüft wird in `api/_lib/gate.js` — dort liegen Passwort-Abgleich, */
/*  Token-Signatur und das IP-Rate-Limit. Hier wird nur entschieden,    */
/*  ob die Anfrage durch darf.                                          */
/* ------------------------------------------------------------------ */

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

function gateAllows(req) {
  return authenticateRequest(req).ok;
}

/** HMAC über eine Upload-URL, damit niemand fremde Ziele einschleusen kann (SSRF). */
const signTarget = (target) =>
  crypto.createHmac("sha256", API_KEY || "shortsfactory").update(String(target), "utf8").digest("hex");

/* ------------------------------------------------------------------ */
/*  Helfer                                                             */
/* ------------------------------------------------------------------ */

async function zernio(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data?.error?.message ||
      (typeof data?.error === "string" ? data.error : "") ||
      data?.message ||
      `Zernio HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.details = data?.details ?? data?.error?.details;
    throw err;
  }
  return data;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === "string" && req.body.length) return resolve(Buffer.from(req.body, "utf8"));
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += buf.length;
      if (size > 4.4 * 1024 * 1024) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const normalizeAccounts = (payload) => {
  const list = Array.isArray(payload?.accounts)
    ? payload.accounts
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];
  return list
    .map((a) => ({
      id: String(a?._id || a?.id || ""),
      platform: String(a?.platform || "").toLowerCase(),
      username: a?.username || "",
      displayName: a?.displayName || "",
      profileId: String(a?.profileId || ""),
      isActive: a?.isActive !== false,
    }))
    .filter((a) => a.id && a.platform);
};

const POSTING_PLATFORMS = new Set([
  "twitter",
  "instagram",
  "facebook",
  "youtube",
  "linkedin",
  "threads",
  "tiktok",
  "pinterest",
  "reddit",
  "bluesky",
  "googlebusiness",
  "telegram",
  "snapchat",
  "whatsapp",
  "discord",
  "slack",
]);

/* TikTok verlangt laut API-Doku zwingend diese Settings. */
const TIKTOK_SETTINGS = {
  privacy_level: "PUBLIC_TO_EVERYONE",
  allow_comment: true,
  allow_duet: true,
  allow_stitch: true,
  commercial_content_type: "none",
  content_preview_confirmed: true,
  express_consent_given: true,
  media_type: "video",
  auto_add_music: false,
  video_made_with_ai: false,
};

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-sf-auth");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const json = (status, payload) => res.status(status).json(payload);

  if (!API_KEY) {
    return json(503, {
      ok: false,
      configured: false,
      error:
        "ZERNIO_API_KEY fehlt. In Vercel → Settings → Environment Variables setzen und neu deployen (Anleitung: docs/ANLEITUNG.md).",
    });
  }

  if (!gateAllows(req)) {
    return json(401, {
      ok: false,
      code: "GATE",
      error:
        "Nicht freigeschaltet — bitte zuerst das Passwort im Onepage-Gate eingeben (Token abgelaufen? Seite neu laden).",
    });
  }

  try {
    /* ---- roher Video-Upload (Fallback für CORS-blockierte Direktuploads) ---- */
    if (req.method === "POST" && (req.url || "").startsWith("/api/zernio/upload")) {
      const url = new URL(req.url, "http://internal");
      const target = String(req.headers?.["x-sf-target"] || url.searchParams.get("target") || "");
      const sig = String(req.headers?.["x-sf-sig"] || url.searchParams.get("sig") || "");

      if (!target.startsWith("https://")) {
        return json(400, { ok: false, error: "Upload-Ziel fehlt oder ist nicht HTTPS." });
      }
      if (!safeEqual(sig, signTarget(target))) {
        return json(403, { ok: false, error: "Upload-Signatur ungültig — bitte neu presignen." });
      }

      const bytes = await readRawBody(req);
      if (!bytes.length) {
        return json(400, {
          ok: false,
          error: "Keine Video-Bytes angekommen (Body-Limit von Vercel: 4,5 MB).",
        });
      }

      const contentType = String(
        req.headers?.["x-sf-content-type"] || url.searchParams.get("contentType") || "video/mp4"
      );
      const put = await fetch(target, {
        method: "PUT",
        headers: { "Content-Type": contentType, "Content-Length": String(bytes.length) },
        body: bytes,
      });
      if (!put.ok) {
        const text = await put.text().catch(() => "");
        return json(502, {
          ok: false,
          error: `Storage-Upload fehlgeschlagen (HTTP ${put.status}). ${text.slice(0, 240)}`,
        });
      }
      return json(200, { ok: true, uploaded: bytes.length, via: "relay" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const action = String(req.query?.action || body?.action || "").toLowerCase();

    /* ---- STATUS: Key vorhanden? Welche Accounts sind verbunden? ---- */
    if (action === "status") {
      const accounts = normalizeAccounts(await zernio("/accounts"));
      const usable = accounts.filter((a) => a.isActive && POSTING_PLATFORMS.has(a.platform));
      return json(200, {
        ok: true,
        configured: true,
        baseUrl: BASE_URL,
        gate: gateConfigured(),
        gateMode: gateMode(),
        /* nur Accounts, die wirklich posten können — der Rest liegt in allAccounts */
        accounts: usable,
        allAccounts: accounts,
      });
    }

    /* ---- PRESIGN: Upload-URL für ein Video holen ---- */
    if (action === "presign") {
      const filename = String(body.filename || "short.mp4");
      const contentType = String(body.contentType || "video/mp4");
      const size = Number(body.size) || undefined;
      const data = await zernio("/media/presign", { method: "POST", body: { filename, contentType, size } });
      const uploadUrl = data?.uploadUrl || data?.upload_url || data?.data?.uploadUrl || "";
      const publicUrl = data?.publicUrl || data?.public_url || data?.data?.publicUrl || "";
      if (!uploadUrl || !publicUrl) {
        return json(502, { ok: false, error: "Zernio hat keine Upload-URL zurückgegeben." });
      }
      return json(200, {
        ok: true,
        uploadUrl,
        publicUrl,
        key: data?.key || "",
        expiresIn: data?.expiresIn ?? data?.expires ?? 3600,
        sig: signTarget(uploadUrl),
      });
    }

    /* ---- PUBLISH: Post anlegen (sofort oder geplant) ---- */
    if (action === "publish") {
      const mediaUrl = String(body.mediaUrl || "").trim();
      if (!mediaUrl) return json(400, { ok: false, error: "mediaUrl fehlt." });

      let platforms = Array.isArray(body.platforms)
        ? body.platforms
            .filter((p) => p && p.platform)
            .map((p) => ({
              platform: String(p.platform).toLowerCase(),
              ...(p.accountId ? { accountId: String(p.accountId) } : {}),
            }))
        : [];

      /* Auto-Modus: alle in Zernio verbundenen, aktiven Accounts benutzen. */
      if (platforms.length === 0) {
        platforms = normalizeAccounts(await zernio("/accounts"))
          .filter((a) => a.isActive && POSTING_PLATFORMS.has(a.platform))
          .map((a) => ({ platform: a.platform, accountId: a.id }));
      }
      if (platforms.length === 0) {
        return json(400, {
          ok: false,
          error:
            "Kein verbundener Social-Account in Zernio gefunden. Accounts unter zernio.com verbinden und erneut versuchen.",
        });
      }

      const hashtags = Array.isArray(body.hashtags)
        ? body.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean)
        : [];
      const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
      const title = String(body.title || "").slice(0, 100); // YouTube: max. 100 Zeichen
      const content = String(body.content || title || "").slice(0, 4000);

      const payload = {
        content,
        platforms,
        mediaItems: [
          {
            type: "video",
            url: mediaUrl,
            ...(body.filename ? { filename: String(body.filename) } : {}),
            ...(body.mimeType ? { mimeType: String(body.mimeType) } : {}),
            ...(Number(body.size) ? { size: Number(body.size) } : {}),
          },
        ],
        ...(title ? { title } : {}),
        ...(hashtags.length ? { hashtags } : {}),
        ...(tags.length ? { tags } : {}),
        visibility: "public",
      };

      /* Zeitpunkt: entweder sofort, oder geplant (ohne Kalender-Logik hier). */
      if (body.isDraft) {
        payload.isDraft = true;
      } else if (body.scheduledFor) {
        payload.scheduledFor = String(body.scheduledFor);
        payload.timezone = String(body.timezone || "Europe/Berlin");
      } else {
        payload.publishNow = true;
      }

      if (platforms.some((p) => p.platform === "tiktok")) {
        payload.tiktokSettings = { ...TIKTOK_SETTINGS, ...(body.tiktokSettings || {}) };
      }

      const data = await zernio("/posts", { method: "POST", body: payload });
      const post = data?.post || data?.data?.post || data?.data || data;
      return json(200, {
        ok: true,
        postId: post?._id || post?.id || null,
        status: post?.status || (payload.publishNow ? "publishing" : "scheduled"),
        scheduledFor: post?.scheduledFor || payload.scheduledFor || null,
        platforms: post?.platforms || platforms,
        message: data?.message || "",
        raw: post,
      });
    }

    /* ---- POST-STATUS ---- */
    if (action === "post-status") {
      const postId = String(body.postId || req.query?.postId || "");
      if (!postId) return json(400, { ok: false, error: "postId fehlt." });
      const data = await zernio(`/posts/${encodeURIComponent(postId)}`);
      const post = data?.post || data?.data?.post || data?.data || {};
      return json(200, {
        ok: true,
        postId,
        status: post?.status || "unknown",
        platforms: post?.platforms || [],
      });
    }

    return json(400, { ok: false, error: `Unbekannte Aktion: ${action || "(keine)"}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[zernio]", message);
    return json(e?.status && e.status >= 400 && e.status < 600 ? e.status : 500, {
      ok: false,
      error: message,
      ...(e?.details ? { details: e.details } : {}),
    });
  }
}
