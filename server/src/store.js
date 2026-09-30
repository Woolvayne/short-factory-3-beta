/**
 * Tiny JSON persistence on the data volume — jobs, uploads and API keys
 * survive restarts when a Railway Volume is mounted at DATA_DIR (/data).
 * Without a volume everything still works, it's just ephemeral.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");

export async function initStore() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

/* ------------------------------------------------------------------ */
/*  API keys — sfk_<64 hex>, stored as SHA-256 hashes only              */
/* ------------------------------------------------------------------ */

export const hashKey = (key) => createHash("sha256").update(key, "utf8").digest("hex");

export async function listKeys() {
  return readJson(KEYS_FILE, []);
}

export async function createKey(label = "") {
  const keys = await listKeys();
  const secret = `sfk_${randomBytes(32).toString("hex")}`;
  const record = {
    id: `key_${randomBytes(6).toString("hex")}`,
    label: String(label).slice(0, 80),
    hash: hashKey(secret),
    prefix: secret.slice(0, 10),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    disabled: false,
  };
  keys.push(record);
  await writeJson(KEYS_FILE, keys);
  return { record, secret }; // secret is shown exactly once
}

export async function revokeKey(id) {
  const keys = await listKeys();
  const idx = keys.findIndex((k) => k.id === id);
  if (idx === -1) return false;
  keys.splice(idx, 1);
  await writeJson(KEYS_FILE, keys);
  return true;
}

export async function verifyKey(secret) {
  if (typeof secret !== "string" || !secret.startsWith("sfk_")) return null;
  const keys = await listKeys();
  const h = hashKey(secret);
  const rec = keys.find((k) => k.hash === h && !k.disabled);
  if (!rec) return null;
  rec.lastUsedAt = new Date().toISOString();
  writeJson(KEYS_FILE, keys).catch(() => {});
  return rec;
}

/* ------------------------------------------------------------------ */
/*  jobs                                                                */
/* ------------------------------------------------------------------ */

export async function listJobs() {
  return readJson(JOBS_FILE, []);
}

export async function saveJobs(jobs) {
  await writeJson(JOBS_FILE, jobs);
}

export async function getJob(id) {
  const jobs = await listJobs();
  return jobs.find((j) => j.id === id) ?? null;
}

export async function upsertJob(job) {
  const jobs = await listJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx === -1) jobs.unshift(job);
  else jobs[idx] = job;
  await saveJobs(jobs);
}

export const newJobId = () => `job_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
export const newUploadId = () => `upl_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;

/** Keep disk usage in check on tiny volumes: prune oldest finished jobs. */
export async function pruneJobs(maxJobs = Number(process.env.MAX_JOBS || 6)) {
  const jobs = await listJobs();
  const keep = [];
  let finished = 0;
  for (const j of jobs) {
    const isFinal = ["done", "failed", "partial"].includes(j.status);
    if (isFinal) finished += 1;
    if (isFinal && finished > maxJobs) {
      await fs.rm(path.join(JOBS_DIR, j.id), { recursive: true, force: true }).catch(() => {});
      continue;
    }
    keep.push(j);
  }
  if (keep.length !== jobs.length) await saveJobs(keep);
}
