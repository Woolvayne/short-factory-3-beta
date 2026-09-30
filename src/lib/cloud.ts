/**
 * Cloud-Fabrik client — talks to the optional Railway backend
 * (`server/`). Jobs render server-side with ffmpeg, so the tab can be
 * closed as soon as the job is accepted; results are downloaded later.
 *
 * Config (backend URL + API key) lives in localStorage on THIS device.
 */

import type { Settings } from "./settings";

export interface CloudConfig {
  baseUrl: string;
  apiKey: string;
}

const STORE_KEY = "shortsfactory.cloud.v1";

export function loadCloudConfig(): CloudConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { baseUrl: "", apiKey: "", ...(JSON.parse(raw) as Partial<CloudConfig>) };
  } catch {
    /* noop */
  }
  return { baseUrl: "", apiKey: "" };
}

export function saveCloudConfig(cfg: CloudConfig): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  } catch {
    /* private mode — non-fatal */
  }
}

const base = (cfg: CloudConfig) => cfg.baseUrl.trim().replace(/\/+$/, "");
const headers = (cfg: CloudConfig) => ({
  Authorization: `Bearer ${cfg.apiKey.trim()}`,
  "Content-Type": "application/json",
});

export interface CloudUnit {
  index: number;
  idea: string;
  status: "queued" | "script" | "voice" | "staged" | "rendering" | "done" | "error";
  provider?: string;
  voiceDuration?: number;
  duration?: number;
  size?: number;
  error?: string;
  videoPath: string | null;
}

export interface CloudJob {
  id: string;
  status: "queued" | "running" | "done" | "partial" | "failed" | "canceled";
  createdAt: string;
  finishedAt?: string;
  createdBy?: string;
  error?: string;
  progress: { done: number; total: number };
  units: CloudUnit[];
}

export const isCloudConfigured = (cfg: CloudConfig) =>
  /^https?:\/\//.test(cfg.baseUrl.trim()) && cfg.apiKey.trim().length > 8;

export const jobActive = (j: CloudJob) => j.status === "queued" || j.status === "running";

/** Health + auth probe. Throws with a German message on failure. */
export async function checkCloud(cfg: CloudConfig): Promise<{ queued: number; running: number }> {
  const res = await fetch(`${base(cfg)}/health`).catch(() => null);
  if (!res || !res.ok) throw new Error("Backend nicht erreichbar — läuft der Railway-Service?");
  const health = (await res.json()) as { queue?: { queued: number; running: number } };
  const auth = await fetch(`${base(cfg)}/v1/jobs`, { headers: headers(cfg) }).catch(() => null);
  if (!auth) throw new Error("Backend nicht erreichbar");
  if (auth.status === 401) throw new Error("API-Key ungültig (Format sfk_…)");
  if (!auth.ok) throw new Error(`Backend-Fehler HTTP ${auth.status}`);
  return { queued: health.queue?.queued ?? 0, running: health.queue?.running ?? 0 };
}

export async function listCloudJobs(cfg: CloudConfig): Promise<CloudJob[]> {
  const res = await fetch(`${base(cfg)}/v1/jobs`, { headers: headers(cfg) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { jobs: CloudJob[] };
  return data.jobs ?? [];
}

/** Upload a File (background video / music) with progress. → uploadId */
export function uploadToCloud(
  cfg: CloudConfig,
  file: File | Blob,
  onProgress?: (frac: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base(cfg)}/v1/uploads`);
    xhr.setRequestHeader("Authorization", `Bearer ${cfg.apiKey.trim()}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Upload fehlgeschlagen (Netzwerk)"));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}") as { ok?: boolean; uploadId?: string; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && data.uploadId) resolve(data.uploadId);
        else reject(new Error(data.error || `Upload HTTP ${xhr.status}`));
      } catch {
        reject(new Error(`Upload HTTP ${xhr.status}`));
      }
    };
    xhr.send(file);
  });
}

export interface CloudJobPayload {
  videoUrl?: string;
  uploadId?: string;
  musicUploadId?: string;
  count: number;
  ideas: string[];
  settings: Partial<Settings>;
}

export async function submitCloudJob(cfg: CloudConfig, payload: CloudJobPayload): Promise<CloudJob> {
  const res = await fetch(`${base(cfg)}/v1/jobs`, {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; job?: CloudJob; error?: string };
  if (!res.ok || !data.job) throw new Error(data.error || `Job HTTP ${res.status}`);
  return data.job;
}

export async function deleteCloudJob(cfg: CloudConfig, id: string): Promise<void> {
  await fetch(`${base(cfg)}/v1/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(cfg),
  });
}

/** Browser-clickable download URL (auth via ?api_key= query). */
export const cloudVideoUrl = (cfg: CloudConfig, videoPath: string) =>
  `${base(cfg)}${videoPath}?api_key=${encodeURIComponent(cfg.apiKey.trim())}`;

/** Strip fields the backend does not need before shipping settings. */
export function cloudSettings(s: Settings): Partial<Settings> {
  // The whole settings object is meaningful server-side (voice, captions,
  // intro, clips, video). Qwen/Mistral keys are included on purpose: it is
  // the user's OWN backend and the keys enable real AI stories there.
  return { ...s };
}
