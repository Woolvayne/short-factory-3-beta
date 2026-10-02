/**
 * ShortsFactory Cloud Worker — Railway backend.
 *
 * · POST /v1/jobs        → queue a batch; renders server-side (ffmpeg),
 *                          keeps going after the browser tab is closed
 * · GET  /v1/jobs/:id    → progress; /videos/:n downloads finished MP4s
 * · POST /v1/keys        → mint API keys for AI agents (admin only)
 * · GET  /v1/openapi.json → machine-readable spec so any AI can drive it
 *
 * Auth: Authorization: Bearer sfk_… (or ?api_key=… for GET downloads).
 * Admin: Authorization: Bearer <ADMIN_TOKEN env>.
 */

import express from "express";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_DIR, JOBS_DIR, UPLOADS_DIR,
  createKey, getJob, initStore, listJobs, listKeys, newJobId,
  newUploadId, revokeKey, upsertJob, verifyKey,
} from "./store.js";
import { buildUnits, enqueue, recoverPending } from "./worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

/* ---- CORS: the Vercel frontend (any origin) may call this API ---- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-filename");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const bearer = (req) => {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
};

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ ok: false, error: "ADMIN_TOKEN ist nicht gesetzt — in Railway unter Variables anlegen." });
  }
  if (bearer(req) !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "admin token invalid" });
  }
  next();
}

async function requireKey(req, res, next) {
  const secret = bearer(req) || String(req.query.api_key || "");
  // the admin token also works everywhere (convenient for testing)
  if (ADMIN_TOKEN && secret === ADMIN_TOKEN) {
    req.apiKey = { id: "admin", label: "admin-token" };
    return next();
  }
  const rec = await verifyKey(secret);
  if (!rec) {
    return res.status(401).json({ ok: false, error: "API key missing or invalid (Authorization: Bearer sfk_…)" });
  }
  req.apiKey = rec;
  next();
}

/* ------------------------------------------------------------------ */
/*  public                                                              */
/* ------------------------------------------------------------------ */

app.get(["/", "/health"], async (_req, res) => {
  const jobs = await listJobs();
  res.json({
    ok: true,
    service: "shortsfactory-cloud-worker",
    version: 1,
    time: new Date().toISOString(),
    queue: {
      queued: jobs.filter((j) => j.status === "queued").length,
      running: jobs.filter((j) => j.status === "running").length,
    },
    adminConfigured: Boolean(ADMIN_TOKEN),
    docs: "/v1/openapi.json",
  });
});

app.get("/v1/openapi.json", async (_req, res) => {
  try {
    const spec = await fs.readFile(path.join(__dirname, "..", "openapi.json"), "utf8");
    res.type("application/json").send(spec);
  } catch {
    res.status(500).json({ ok: false, error: "spec missing" });
  }
});

/* ------------------------------------------------------------------ */
/*  admin — API keys for AI agents                                      */
/* ------------------------------------------------------------------ */

app.post("/v1/keys", requireAdmin, async (req, res) => {
  const { record, secret } = await createKey(req.body?.label ?? "");
  res.status(201).json({
    ok: true,
    id: record.id,
    label: record.label,
    key: secret, // shown exactly once — only the SHA-256 hash is stored
    note: "Diesen Key jetzt sicher speichern — er wird nie wieder angezeigt.",
  });
});

app.get("/v1/keys", requireAdmin, async (_req, res) => {
  const keys = await listKeys();
  res.json({
    ok: true,
    keys: keys.map(({ hash, ...k }) => k),
  });
});

app.delete("/v1/keys/:id", requireAdmin, async (req, res) => {
  const okDel = await revokeKey(req.params.id);
  res.status(okDel ? 200 : 404).json({ ok: okDel });
});

/* ------------------------------------------------------------------ */
/*  uploads — stream a background video / music file to disk           */
/* ------------------------------------------------------------------ */

app.post("/v1/uploads", requireKey, async (req, res) => {
  const id = newUploadId();
  const dest = path.join(UPLOADS_DIR, id);
  let bytes = 0;
  let aborted = false;

  const out = createWriteStream(dest);
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES && !aborted) {
      aborted = true;
      out.destroy();
      fs.rm(dest, { force: true }).catch(() => {});
      res.status(413).json({ ok: false, error: `upload larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` });
      req.destroy();
    }
  });
  req.pipe(out);
  out.on("finish", () => {
    if (aborted) return;
    if (bytes === 0) {
      fs.rm(dest, { force: true }).catch(() => {});
      return res.status(400).json({ ok: false, error: "empty upload" });
    }
    res.status(201).json({ ok: true, uploadId: id, bytes });
  });
  out.on("error", () => {
    if (!aborted) res.status(500).json({ ok: false, error: "upload failed" });
  });
});

/* ------------------------------------------------------------------ */
/*  jobs                                                                */
/* ------------------------------------------------------------------ */

app.post("/v1/jobs", requireKey, async (req, res) => {
  const b = req.body ?? {};
  if (!b.videoUrl && !b.uploadId) {
    return res.status(400).json({
      ok: false,
      error: "videoUrl (direkte MP4-URL mit CORS/öffentlich erreichbar) oder uploadId ist erforderlich",
    });
  }
  if (b.videoUrl && !/^https?:\/\//i.test(String(b.videoUrl))) {
    return res.status(400).json({ ok: false, error: "videoUrl must be http(s) — platform page links (YouTube …) are not supported" });
  }

  /* `scripts` is the agent-facing name. Keep `stories` as a backwards-
     compatible alias and accept a single `script` for one-unit jobs. */
  const scripts = Array.isArray(b.scripts)
    ? b.scripts
    : Array.isArray(b.stories)
      ? b.stories
      : b.script !== undefined
        ? [b.script]
        : [];
  const titles = Array.isArray(b.titles) ? b.titles.map(String) : [];
  const units = buildUnits(
    Array.isArray(b.ideas) ? b.ideas.map(String) : [],
    scripts,
    b.count,
    titles
  );

  const job = {
    id: newJobId(),
    status: "queued",
    createdAt: new Date().toISOString(),
    createdBy: req.apiKey.label || req.apiKey.id,
    params: {
      videoUrl: b.videoUrl ? String(b.videoUrl) : undefined,
      uploadId: b.uploadId ? String(b.uploadId) : undefined,
      musicUrl: b.musicUrl ? String(b.musicUrl) : undefined,
      musicUploadId: b.musicUploadId ? String(b.musicUploadId) : undefined,
      settings: typeof b.settings === "object" && b.settings ? b.settings : {},
    },
    units,
  };
  await upsertJob(job);
  enqueue(job.id);
  res.status(201).json({ ok: true, job: publicJob(job) });
});

app.get("/v1/jobs", requireKey, async (_req, res) => {
  const jobs = await listJobs();
  res.json({ ok: true, jobs: jobs.map(publicJob) });
});

app.get("/v1/jobs/:id", requireKey, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  res.json({ ok: true, job: publicJob(job) });
});

app.delete("/v1/jobs/:id", requireKey, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  job.status = "canceled";
  await upsertJob(job);
  await fs.rm(path.join(JOBS_DIR, job.id), { recursive: true, force: true }).catch(() => {});
  res.json({ ok: true });
});

app.get("/v1/jobs/:id/videos/:n", requireKey, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  const n = Number(req.params.n);
  const unit = job.units.find((u) => u.index === n - 1);
  if (!unit || unit.status !== "done" || !unit.file) {
    return res.status(404).json({ ok: false, error: "video not ready" });
  }
  const file = path.join(JOBS_DIR, job.id, path.basename(unit.file));
  try {
    const stat = await fs.stat(file);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="shortsfactory-${job.id}-${String(n).padStart(2, "0")}.mp4"`);
    createReadStream(file).pipe(res);
  } catch {
    res.status(410).json({ ok: false, error: "file was pruned from disk" });
  }
});

/* ------------------------------------------------------------------ */

function publicJob(job) {
  const units = job.units.map((u) => ({
    index: u.index,
    title: u.title || u.idea,
    idea: u.idea,
    /* The complete script is returned so an agent can audit/reuse exactly
       what was voiced; this is never a provider key or secret. */
    script: u.story || null,
    status: u.status,
    provider: u.provider,
    voiceDuration: u.voiceDuration,
    clipStart: u.clipStart,
    duration: u.duration,
    size: u.size,
    error: u.error,
    videoPath: u.status === "done" ? `/v1/jobs/${job.id}/videos/${u.index + 1}` : null,
  }));
  const done = units.filter((u) => u.status === "done").length;
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdBy: job.createdBy,
    error: job.error,
    progress: { done, total: units.length },
    units,
  };
}

/* ------------------------------------------------------------------ */

await initStore();
await recoverPending(await listJobs());

app.listen(PORT, "0.0.0.0", () => {
  console.log(`shortsfactory cloud worker on :${PORT} (data: ${DATA_DIR})`);
  if (!ADMIN_TOKEN) {
    console.warn("⚠ ADMIN_TOKEN ist nicht gesetzt — /v1/keys bleibt gesperrt, bis die Variable existiert.");
  }
});
