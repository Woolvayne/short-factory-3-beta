/**
 * ShortsFactory — TTS relay (Vercel Serverless Function, Node.js runtime)
 *
 * Why this exists: browsers cannot open a WebSocket to Microsoft's Edge Read
 * Aloud endpoint (browser handshakes always carry an Origin header, which the
 * endpoint rejects), and Supabase's Edge Function runtime unreliably drops
 * outbound third-party WebSockets ("EarlyDrop" after ~10ms CPU). The Node.js
 * runtime on Vercel has no such restriction — raw `ws` connections work.
 *
 * Implements the publicly documented open-source edge-tts protocol
 * (github.com/rany2/edge-tts, v7.2.8), including the current hardening:
 *   - Sec-MS-GEC token: SHA-256 over Windows-epoch ticks (rounded to 5 min)
 *     + TrustedClientToken, BigInt math, with clock-skew correction on 403
 *   - Read-Aloud extension Origin + matching Chromium/143 User-Agent
 *   - muid cookie, permessage-deflate, JS-style X-Timestamp frames
 *   - text sanitising (the service chokes on C0 control characters) and
 *     splitting into ≤4096-byte SSML chunks — Microsoft enforces that limit
 *     since Dec 2025 and silently stops answering oversized requests
 *   - CBR byte-count offset compensation so word timings stay correct when a
 *     story needs more than one chunk
 *
 * Reliability: the Edge Read Aloud service is *intermittent* by nature — it
 * regularly completes a turn without sending audio, drops the handshake with
 * 403/503, or just goes quiet (upstream issues #443, #452, #473, #482), and it
 * dislikes several simultaneous requests from one (data-centre) IP. A single
 * stalled socket therefore must not fail a video: every attempt has a short
 * handshake timeout and an idle timeout, transient failures are retried with
 * jittered backoff, and the whole call stays inside one global budget that ends
 * before the function's maxDuration. Only when every attempt is exhausted does
 * the relay report an error — and then it says *why* (which frames arrived).
 *
 *   POST { "text": "...", "voice": "en-US-AndrewNeural", "rate": 2, "pitch": 0 }
 *   → 200 { "ok": true, "format": "audio/mpeg", "audioBase64": "…",
 *           "words": [{ "text": "...", "offset": 0.42, "duration": 0.21 }, …] }
 *
 * audioBase64 is a concatenated MP3 stream (audio-24khz-48kbitrate-mono-mp3).
 * offsets/durations are SECONDS (converted from the 100-ns WordBoundary ticks).
 *
 * Same-origin with the app → no CORS, no apikey, no auth.
 */

// Explicitly pin the Node.js runtime (NOT edge) — raw outbound WebSocket via "ws".
export const config = {
  runtime: "nodejs",
  // Chunked synthesis + retries need headroom; the relay's own budget (below)
  // ends well before this so we always return JSON instead of a platform 504.
  maxDuration: 60,
};

import { createHash } from "node:crypto";
import WebSocket from "ws";

/* ------------------------------------------------------------------ */
/*  constants — mirrors edge-tts src/edge_tts/constants.py              */
/* ------------------------------------------------------------------ */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_VOICE = "en-US-AndrewNeural";
const WSS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
};

const WS_HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "Sec-WebSocket-Version": "13",
  ...BASE_HEADERS,
};

const WIN_EPOCH = 11644473600n;
const TICKS_PER_SECOND = 10_000_000n;
const ROUNDING_SECONDS = 300n; // token rotates every 5 minutes

/** Microsoft rejects (or silently ignores) SSML frames bigger than this. */
const MAX_CHUNK_BYTES = 4096;
/** audio-24khz-48kbitrate-mono-mp3 is a 48 kbit/s CBR stream. */
const MP3_BITRATE_BPS = 48_000n;

/* ------------------------------------------------------------------ */
/*  timing — fail fast per attempt, retry, stay inside one budget       */
/* ------------------------------------------------------------------ */

const HANDSHAKE_TIMEOUT_MS = 10_000; // no 101 within 10s → drop and retry
const IDLE_TIMEOUT_MS = 15_000;      // no frame at all for 15s → drop and retry
const ATTEMPT_TIMEOUT_MS = 45_000;   // hard cap for one connection (stalls die much earlier)
const MAX_ATTEMPTS = 3;              // per text chunk
const RETRY_BASE_MS = 300;           // + jitter, grows with the attempt number
/** Global budget: below maxDuration (60s) and below the client's 75s abort. */
const TOTAL_TIMEOUT_MS = 50_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*  DRM — Sec-MS-GEC token with clock-skew correction                  */
/* ------------------------------------------------------------------ */

let clockSkewMs = 0;

const hex32 = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** SHA-256(ticks rounded down to 5min + trusted token), uppercase hex. BigInt
 *  is required — the tick value (~1.34e17) exceeds 2^53. */
function generateSecMsGec() {
  const nowSeconds = BigInt(Math.floor((Date.now() + clockSkewMs) / 1000));
  let ticks = (nowSeconds + WIN_EPOCH) * TICKS_PER_SECOND;
  ticks -= ticks % (ROUNDING_SECONDS * TICKS_PER_SECOND);
  const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  return createHash("sha256").update(strToHash, "utf8").digest("hex").toUpperCase();
}

/** Fresh muid cookie per connection, like the reference client. */
const generateMuid = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const wssUrl = (gec, connId) =>
  `${WSS_BASE}` +
  `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
  `&ConnectionId=${connId}` +
  `&Sec-MS-GEC=${gec}` +
  `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

/* ------------------------------------------------------------------ */
/*  text hygiene + chunking — mirrors edge-tts communicate.py           */
/* ------------------------------------------------------------------ */

/** The service errors out on a couple of C0 ranges (vertical tab from OCR'd
 *  PDFs being the classic one); the reference client blanks them out. \t and
 *  \n are kept. */
const removeIncompatibleCharacters = (s) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");

/** xml.sax.saxutils.escape — only &, < and > need escaping in element text.
 *  Escaping quotes as well would needlessly inflate the byte count. */
const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** xml.sax.saxutils.unescape — WordBoundary text comes back escaped. */
const unescapeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Rightmost newline (preferred) or space within the first `limit` bytes. */
function findSplitPoint(buf, limit) {
  let at = buf.lastIndexOf(0x0a, limit - 1); // "\n"
  if (at < 0) at = buf.lastIndexOf(0x20, limit - 1); // " "
  return at;
}

/** Largest index ≤ limit that does not cut a multi-byte UTF-8 character. */
function findUtf8SplitPoint(buf, limit) {
  let at = Math.min(limit, buf.length);
  // 0b10xxxxxx = UTF-8 continuation byte → back off until we're at a lead byte
  while (at > 0 && (buf[at] & 0xc0) === 0x80) at -= 1;
  return at;
}

/** Never split inside an XML entity (`&amp;`) — move back to the '&'. */
function adjustForXmlEntity(buf, splitAt) {
  let at = splitAt;
  while (at > 0) {
    const amp = buf.lastIndexOf(0x26, at - 1); // "&"
    if (amp < 0) break;
    if (buf.indexOf(0x3b, amp, at) !== -1) break; // ";" → entity is complete
    at = amp;
  }
  return at;
}

/**
 * Split (already escaped) text into chunks of at most `byteLength` UTF-8 bytes,
 * preferring natural boundaries. Same rules as the reference client.
 */
function splitTextByByteLength(text, byteLength) {
  let buf = Buffer.from(text, "utf8");
  const out = [];
  let guard = 0;
  while (buf.length > byteLength && guard++ < 512) {
    let splitAt = findSplitPoint(buf, byteLength);
    if (splitAt < 0) splitAt = findUtf8SplitPoint(buf, byteLength);
    splitAt = adjustForXmlEntity(buf, splitAt);
    if (splitAt <= 0) splitAt = findUtf8SplitPoint(buf, byteLength) || 1;

    const chunk = buf.subarray(0, splitAt).toString("utf8").trim();
    if (chunk) out.push(chunk);
    buf = buf.subarray(splitAt);
  }
  const rest = buf.toString("utf8").trim();
  if (rest) out.push(rest);
  return out;
}

/* ------------------------------------------------------------------ */
/*  frames — mirrors edge-tts src/edge_tts/communicate.py               */
/* ------------------------------------------------------------------ */

/** JS-style date string, exactly like the reference client sends it
 *  (new Date().toString() in UTC — note the zero-padded day of month). */
function dateToString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const month = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][d.getUTCMonth()];
  return (
    `${day} ${month} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
    `GMT+0000 (Coordinated Universal Time)`
  );
}

function speechConfigFrame() {
  const body = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "true" },
          outputFormat: OUTPUT_FORMAT,
        },
      },
    },
  });
  return (
    `X-Timestamp:${dateToString()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    `${body}\r\n`
  );
}

const signed = (n) => `${n >= 0 ? "+" : "-"}${Math.abs(Math.round(n))}`;

function ssmlFrame(text, voice, rate, pitch) {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${signed(pitch)}Hz' rate='${signed(rate)}%' volume='+0%'>${text}</prosody>` +
    `</voice></speak>`;
  return (
    `X-RequestId:${hex32()}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${dateToString()}Z\r\n` + // trailing Z is an upstream quirk, kept on purpose
    "Path:ssml\r\n\r\n" +
    ssml
  );
}

/** "A:x\r\nB:y" → { a: "x", b: "y" } (lower-cased keys). */
function parseHeaderBlock(block) {
  const headers = {};
  for (const line of block.split("\r\n")) {
    const c = line.indexOf(":");
    if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }
  return headers;
}

function parseTextFrame(raw) {
  const idx = raw.indexOf("\r\n\r\n");
  const head = idx === -1 ? raw : raw.slice(0, idx);
  const body = idx === -1 ? "" : raw.slice(idx + 4);
  return { headers: parseHeaderBlock(head), body };
}

/* ------------------------------------------------------------------ */
/*  one attempt — a single WebSocket for a single text chunk            */
/* ------------------------------------------------------------------ */

function speakOnce(text, voice, rate, pitch, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let opened = false;
    let audioBytes = 0;
    let idleTimer = null;
    const audioChunks = [];
    const words = [];
    const seen = []; // frame paths that arrived — makes failures diagnosable

    const startedAt = Date.now();
    const note = (p) => {
      if (p && !seen.includes(p)) seen.push(p);
    };
    const describe = () =>
      `${opened ? "socket open" : "handshake pending"}` +
      (seen.length ? `, frames: ${seen.join(" → ")}` : ", no frames received");

    const headers = { ...WS_HEADERS, Cookie: `muid=${generateMuid()};` };
    const ws = new WebSocket(wssUrl(generateSecMsGec(), hex32()), {
      headers,
      perMessageDeflate: true,
      handshakeTimeout: Math.max(1000, Math.min(HANDSHAKE_TIMEOUT_MS, timeoutMs)),
    });

    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    };
    const clearTimers = () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    };
    const shutdown = (hard) => {
      try {
        if (hard) ws.terminate();
        else if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
          ws.close();
      } catch {
        /* noop */
      }
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      shutdown(true);
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      shutdown(false);
      resolve({ audio: Buffer.concat(audioChunks), words, seen, audioBytes });
    };

    /** A timeout is always worth another attempt — the service is intermittent. */
    const timeoutError = (why) => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      const err = new Error(`TTS socket timed out after ${secs}s (${why}, ${describe()})`);
      err.retryable = true;
      err.timedOut = true;
      return err;
    };

    /* idle watchdog: re-armed on every frame, so a stream that keeps delivering
       audio is never killed, but a silent socket dies after IDLE_TIMEOUT_MS. */
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      const ms = Math.max(500, Math.min(IDLE_TIMEOUT_MS, timeoutMs));
      idleTimer = setTimeout(() => {
        idleTimer = null;
        fail(timeoutError(`silent for ${Math.round(ms / 1000)}s`));
      }, ms);
      timers.add(idleTimer);
    };

    /* hard cap for this attempt (also covers a stalled TLS/HTTP upgrade) */
    later(() => fail(timeoutError(`attempt budget ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    armIdle();

    ws.on("open", () => {
      opened = true;
      armIdle();
      try {
        ws.send(speechConfigFrame());
        ws.send(ssmlFrame(text, voice, rate, pitch));
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });

    /* A rejected handshake would otherwise surface as a bare
       "Unexpected server response: 403" without the server's Date header, so
       clock-skew correction could never kick in. Handle it explicitly. */
    ws.on("unexpected-response", (req, res) => {
      const status = Number(res?.statusCode ?? 0);
      const serverDate = res?.headers?.date;
      let body = "";
      const finishHandshakeError = () => {
        const err = new Error(
          `TTS handshake rejected (HTTP ${status || "unknown"})` +
            (body ? `: ${body.replace(/\s+/g, " ").slice(0, 140)}` : "")
        );
        err.status = status;
        err.serverDate = serverDate;
        // 4xx (except throttling/DRM) = our request is wrong → no point retrying
        err.retryable =
          !status ||
          status === 403 ||
          status === 408 ||
          status === 425 ||
          status === 429 ||
          status >= 500;
        try {
          req?.destroy();
        } catch {
          /* noop */
        }
        fail(err);
      };
      try {
        res.setEncoding("utf8");
        res.on("data", (d) => {
          if (body.length < 1024) body += d;
        });
        res.on("end", finishHandshakeError);
        res.on("error", finishHandshakeError);
      } catch {
        finishHandshakeError();
      }
      later(finishHandshakeError, 2000); // never wait forever for a body
    });

    ws.on("error", (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.retryable === undefined) e.retryable = true; // ECONNRESET, ETIMEDOUT, DNS, TLS …
      fail(e);
    });

    ws.on("close", (code) => {
      if (settled) return;
      // Server dropped after streaming — keep what we have (upstream behaviour).
      if (audioBytes > 0) return succeed();
      const err = new Error(`TTS socket closed early (code ${code ?? "?"}, ${describe()})`);
      err.retryable = true;
      fail(err);
    });

    ws.on("message", (data, isBinary) => {
      if (settled) return;
      armIdle();
      try {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          if (buf.length < 3) return;
          const headerLen = (buf[0] << 8) | buf[1];
          if (2 + headerLen > buf.length) return;
          const frameHeaders = parseHeaderBlock(buf.toString("utf8", 2, 2 + headerLen));
          if (frameHeaders.path !== "audio") return;
          const payload = buf.subarray(2 + headerLen);
          if (payload.length === 0) return; // terminator frame, carries no audio
          audioChunks.push(payload);
          audioBytes += payload.length;
          note("audio");
          return;
        }

        const raw = data.toString("utf8");
        const { headers: frameHeaders, body } = parseTextFrame(raw);
        const path = frameHeaders.path;
        note(path);

        if (path === "audio.metadata") {
          const payload = JSON.parse(body);
          for (const meta of payload?.Metadata ?? []) {
            if (meta?.Type !== "WordBoundary" || !meta?.Data) continue;
            words.push({
              text: unescapeXml(String(meta.Data.text?.Text ?? "")),
              offset: Number(meta.Data.Offset ?? 0) / 1e7,
              duration: Number(meta.Data.Duration ?? 0) / 1e7,
            });
          }
        } else if (path === "turn.end") {
          if (audioBytes > 0) succeed();
          else {
            // The service completed the turn without a single audio frame —
            // its classic intermittent failure, so it is worth another attempt.
            const err = new Error(`TTS service sent no audio for this turn (${describe()})`);
            err.retryable = true;
            err.noAudio = true;
            fail(err);
          }
        }
        /* "response" / "turn.start" / anything else: just noted, never fatal */
      } catch {
        /* a malformed frame must not kill the render */
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/*  one chunk — attempt, retry, correct clock skew                      */
/* ------------------------------------------------------------------ */

async function speakChunk(text, voice, rate, pitch, deadline) {
  const chunkStarted = Date.now();
  let lastError = null;
  let attempts = 0;
  let skewFixes = 0;

  for (;;) {
    const left = deadline - Date.now();
    if (left < 1500) break; // not enough budget for a meaningful attempt
    if (attempts >= MAX_ATTEMPTS) break;
    attempts += 1;

    try {
      return await speakOnce(text, voice, rate, pitch, Math.min(ATTEMPT_TIMEOUT_MS, left));
    } catch (err) {
      lastError = err;

      /* 403 + a usable Date header → our clock is off; correct and retry
         without burning an attempt (same as the reference client). */
      if (err.status === 403 && err.serverDate && skewFixes < 2) {
        const skew = Date.parse(err.serverDate) - Date.now();
        if (Number.isFinite(skew) && Math.abs(skew) > 1000) {
          clockSkewMs += skew;
          skewFixes += 1;
          attempts -= 1;
          console.warn(`tts: clock skew ${skew}ms detected via 403, retrying`);
          continue;
        }
      }

      if (err.retryable === false) throw err;
      if (attempts >= MAX_ATTEMPTS) break;

      /* Jittered backoff: also de-conflicts the two browser lanes that hit
         this function at the same time — Microsoft blocks simultaneous
         requests from one IP far more often than sequential ones. */
      const backoff = Math.min(1500, RETRY_BASE_MS * attempts + Math.round(Math.random() * 400));
      if (Date.now() + backoff >= deadline) break;
      console.warn(
        `tts: attempt ${attempts}/${MAX_ATTEMPTS} failed (${err.message}), retrying in ${backoff}ms`
      );
      await sleep(backoff);
    }
  }

  const secs = Math.round((Date.now() - chunkStarted) / 1000);
  const detail = lastError?.message ?? `no attempt could be started within the ${secs}s budget`;
  const wrapped = new Error(
    `${detail}${attempts > 1 ? ` — after ${attempts} attempts in ${secs}s` : ""}`
  );
  wrapped.retryable = lastError?.retryable;
  wrapped.status = lastError?.status;
  wrapped.attempts = attempts;
  throw wrapped;
}

/* ------------------------------------------------------------------ */
/*  synthesis — chunk the text, stitch audio + word timings             */
/* ------------------------------------------------------------------ */

/**
 * Speak with the reference client's chunking: text is sanitised, escaped and
 * split into ≤4096-byte pieces, each spoken on its own connection. Word
 * offsets of later chunks are shifted by the exact duration of the audio that
 * came before them (48 kbit/s CBR → ticks = bytes * 8 * 1e7 / 48000).
 */
async function synthesize(text, voice, rate, pitch, deadline) {
  const parts = splitTextByByteLength(
    escapeXml(removeIncompatibleCharacters(text)),
    MAX_CHUNK_BYTES
  );
  if (parts.length === 0) {
    const err = new Error("TTS text is empty after sanitising");
    err.retryable = false;
    throw err;
  }

  const audioParts = [];
  const words = [];
  let previousAudioBytes = 0n;

  for (const part of parts) {
    const { audio, words: chunkWords } = await speakChunk(part, voice, rate, pitch, deadline);

    const compensationTicks = (previousAudioBytes * 8n * TICKS_PER_SECOND) / MP3_BITRATE_BPS;
    const compensationSeconds = Number(compensationTicks) / 1e7;
    for (const w of chunkWords) {
      words.push({ text: w.text, offset: w.offset + compensationSeconds, duration: w.duration });
    }

    audioParts.push(audio);
    previousAudioBytes += BigInt(audio.length);
  }

  return { audio: Buffer.concat(audioParts), words, parts: parts.length };
}

const toBase64 = (buf) => buf.toString("base64");
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ */
/*  handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const text = body?.text;
    if (typeof text !== "string" || text.trim().length < 3) {
      return res.status(400).json({ ok: false, error: "text (string, ≥3 chars) is required" });
    }
    if (text.length > 4000) {
      return res.status(400).json({ ok: false, error: "text is too long (max 4000 chars)" });
    }

    const rawVoice = body?.voice;
    const voice =
      typeof rawVoice === "string" && /^[A-Za-z0-9_-]+$/.test(rawVoice)
        ? rawVoice
        : DEFAULT_VOICE;
    const rate = clamp(Number(body?.rate ?? 0) || 0, -50, 50);
    const pitch = clamp(Number(body?.pitch ?? 0) || 0, -50, 50);

    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const { audio, words } = await synthesize(text.trim(), voice, rate, pitch, deadline);
    if (audio.length === 0) {
      return res.status(502).json({ ok: false, error: "TTS returned no audio frames" });
    }

    return res.status(200).json({
      ok: true,
      format: "audio/mpeg",
      sampleRate: 24000,
      audioBase64: toBase64(audio),
      words,
    });
  } catch (e) {
    console.error("tts relay failed", e?.message ?? e);
    // 502 = the upstream speech service let us down; 500 stays for our own bugs.
    const upstream = Boolean(e?.retryable || e?.status || e?.timedOut || e?.noAudio);
    return res
      .status(upstream ? 502 : 500)
      .json({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
  }
}
