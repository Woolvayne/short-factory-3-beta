/**
 * Job worker — sequential in-process queue. One job at a time, one unit
 * at a time (a 0.5–1 GB Railway box has no headroom for parallel ffmpeg).
 *
 * A job keeps running even when the client that created it disconnects —
 * that is the whole point: press the button, close the tab, download later.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { speak } from "./edge-tts.js";
import { generateStory, styleInstruction, offlineIdea } from "./stories.js";
import { buildAss } from "./captions.js";
import { downloadFile, makeSilentMp3, planWindows, probeDuration, renderUnit, resolveDims } from "./render.js";
import { JOBS_DIR, UPLOADS_DIR, getJob, upsertJob, pruneJobs } from "./store.js";

const queue = [];
let running = false;

export function enqueue(jobId) {
  queue.push(jobId);
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift();
      try {
        await runJob(id);
      } catch (e) {
        console.error(`worker: job ${id} crashed`, e);
        const job = await getJob(id);
        if (job) {
          job.status = "failed";
          job.error = String(e?.message ?? e).slice(0, 400);
          job.finishedAt = new Date().toISOString();
          await upsertJob(job);
        }
      }
      await pruneJobs().catch(() => {});
    }
  } finally {
    running = false;
  }
}

/** Re-queue jobs that were mid-flight when the process restarted. */
export async function recoverPending(jobs) {
  for (const j of jobs) {
    if (j.status === "queued" || j.status === "running") {
      j.status = "queued";
      await upsertJob(j);
      enqueue(j.id);
    }
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n)));

async function runJob(id) {
  const job = await getJob(id);
  if (!job || job.status === "canceled") return;

  job.status = "running";
  job.startedAt = new Date().toISOString();
  await upsertJob(job);

  const jobDir = path.join(JOBS_DIR, job.id);
  await fs.mkdir(jobDir, { recursive: true });

  const p = job.params;
  const s = p.settings ?? {};

  /* ---- 1 · background source ---- */
  const bgFile = path.join(jobDir, "source.mp4");
  if (p.uploadId) {
    const src = path.join(UPLOADS_DIR, path.basename(p.uploadId));
    await fs.copyFile(src, bgFile);
  } else if (p.videoUrl) {
    await stage(job, "download", `lade Quelle: ${p.videoUrl.slice(0, 80)}`);
    await downloadFile(p.videoUrl, bgFile);
  } else {
    throw new Error("no background source (videoUrl or uploadId required)");
  }
  const sourceDuration = await probeDuration(bgFile);

  /* ---- optional music bed ---- */
  let musicFile = null;
  if (p.musicUploadId) {
    musicFile = path.join(jobDir, "music.bin");
    await fs.copyFile(path.join(UPLOADS_DIR, path.basename(p.musicUploadId)), musicFile);
  } else if (p.musicUrl) {
    musicFile = path.join(jobDir, "music.bin");
    await stage(job, "download", "lade Musik");
    await downloadFile(p.musicUrl, musicFile);
  }

  /* ---- 2 · per-unit pipeline: story → voice → captions → render ---- */
  const storyCfg = {
    qwenKey: s.qwenKey || process.env.QWEN_API_KEY || "",
    mistralKey: s.mistralKey || process.env.MISTRAL_API_KEY || "",
    words: clamp(s.storyWords ?? 185, 80, 320),
    temperature: clamp(s.temperature ?? 1.05, 0, 1.5),
    styleInstruction: styleInstruction(s.storyStyle ?? "aita", s.customPrompt ?? ""),
  };
  const voice = typeof s.voice === "string" && /^[A-Za-z0-9_-]+$/.test(s.voice) ? s.voice : "en-US-AndrewNeural";
  const rate = clamp(s.rate ?? 2, -50, 50);
  const pitch = clamp(s.pitch ?? 0, -50, 50);
  const dims = resolveDims(s.quality ?? "auto");

  // phase A: stories + voices (fast) — so clip windows can honour real durations
  for (const unit of job.units) {
    if ((await isCanceled(job.id))) return;
    try {
      unit.status = "script";
      await upsertJob(job);
      if (!unit.story) {
        const r = await generateStory(unit.idea, storyCfg);
        unit.story = r.text;
        unit.provider = r.provider;
      }

      unit.status = "voice";
      await upsertJob(job);
      const voiceFile = path.join(jobDir, `voice-${unit.index + 1}.mp3`);
      if (process.env.TTS_FAKE === "1") {
        // smoke-test mode: silent voice track + evenly spaced word timings
        const ws = unit.story.split(/\s+/).filter(Boolean);
        const dur = ws.length * 0.32 + 0.5;
        await makeSilentMp3(voiceFile, dur);
        unit.voiceDuration = Math.round(dur * 100) / 100;
        unit._words = ws.map((w, i) => ({ text: w, offset: i * 0.32, duration: 0.28 }));
      } else {
        const take = await speak(unit.story, voice, rate, pitch, 180_000);
        await fs.writeFile(voiceFile, take.audio);
        unit.voiceDuration = Math.round(take.duration * 100) / 100;
        unit._words = take.words;
      }
      unit._voiceFile = voiceFile;
      unit.status = "staged";
    } catch (e) {
      unit.status = "error";
      unit.error = String(e?.message ?? e).slice(0, 300);
    }
    await upsertJob(job);
  }

  // phase B: clip windows from real voice durations
  const staged = job.units.filter((u) => u.status === "staged");
  const tail = clamp(s.tailPadding ?? 0.6, 0, 3);
  const lengths = job.units.map((u) =>
    s.clipLengthMode === "fixed"
      ? clamp(s.clipFixedLength ?? 35, 5, 120)
      : (u.voiceDuration ?? 35) + tail + 0.5
  );
  const windows = planWindows(sourceDuration, job.units.length, lengths, {
    skipIntro: clamp(s.clipSkipIntro ?? 5, 0, 600),
    skipOutro: clamp(s.clipSkipOutro ?? 5, 0, 600),
    mode: ["even", "random", "sequential"].includes(s.clipMode) ? s.clipMode : "even",
  });

  // phase C: render
  for (const unit of staged) {
    if ((await isCanceled(job.id))) return;
    try {
      unit.status = "rendering";
      await upsertJob(job);

      let assFile = null;
      const introOn = s.introOn !== false;
      if (s.captionsOn !== false || introOn) {
        const ass = buildAss(unit._words ?? [], {
          width: dims.width,
          height: dims.height,
          captionsOn: s.captionsOn !== false,
          wordsPerCue: clamp(s.wordsPerCue ?? 3, 1, 5),
          captionScale: clamp(s.captionScale ?? 0.074, 0.03, 0.12),
          captionY: clamp(s.captionY ?? 0.6, 0.25, 0.85),
          captionColor: s.captionColor ?? "#ffffff",
          outlineWidth: clamp(s.outlineWidth ?? 0.16, 0, 0.3),
          uppercase: s.uppercase !== false,
          captionShadow: s.captionShadow !== false,
          intro: introOn
            ? {
                title: s.introTitleMode === "custom" && s.introTitle ? s.introTitle : unit.idea,
                subreddit: s.introSubreddit ?? "r/AmItheAsshole",
                author: s.introAuthor ?? "u/Throwaway_42",
                ageLabel: s.introAgeLabel ?? "12h",
                upvotes: clamp(s.introUpvotes ?? 15400, 0, 10_000_000),
                duration: clamp(s.introDuration ?? 3, 1, 8),
                theme: s.introTheme === "light" ? "light" : "dark",
                posY: clamp(s.introPosY ?? 0.36, 0.1, 0.8),
                showStats: s.introShowStats !== false,
              }
            : null,
        });
        assFile = path.join(jobDir, `unit-${unit.index + 1}.ass`);
        await fs.writeFile(assFile, ass, "utf8");
      }

      const w = windows[unit.index];
      unit.clipStart = Math.round(w.start * 10) / 10;
      const res = await renderUnit({
        jobDir,
        index: unit.index,
        bgFile,
        clipStart: w.start,
        voiceFile: unit._voiceFile,
        voiceDuration: unit.voiceDuration,
        musicFile,
        assFile,
        settings: s,
      });

      unit.file = path.basename(res.outFile);
      unit.size = res.size;
      unit.duration = Math.round(res.duration * 100) / 100;
      unit.status = "done";
      // free intermediate artefacts as we go (tiny disks!)
      await fs.rm(unit._voiceFile, { force: true }).catch(() => {});
      if (assFile) await fs.rm(assFile, { force: true }).catch(() => {});
    } catch (e) {
      unit.status = "error";
      unit.error = String(e?.message ?? e).slice(0, 300);
    }
    delete unit._voiceFile;
    delete unit._words;
    await upsertJob(job);
  }

  /* ---- wrap up ---- */
  await fs.rm(bgFile, { force: true }).catch(() => {});
  if (musicFile) await fs.rm(musicFile, { force: true }).catch(() => {});
  if (p.uploadId) {
    await fs.rm(path.join(UPLOADS_DIR, path.basename(p.uploadId)), { force: true }).catch(() => {});
  }

  const done = job.units.filter((u) => u.status === "done").length;
  job.status = done === job.units.length ? "done" : done > 0 ? "partial" : "failed";
  if (job.status === "failed" && !job.error) {
    job.error = job.units.find((u) => u.error)?.error ?? "all units failed";
  }
  job.finishedAt = new Date().toISOString();
  await upsertJob(job);
  console.log(`worker: job ${job.id} → ${job.status} (${done}/${job.units.length} units)`);
}

async function stage(job, phase, note) {
  job.phase = phase;
  job.note = note;
  await upsertJob(job);
}

async function isCanceled(id) {
  const j = await getJob(id);
  return !j || j.status === "canceled";
}

/** Build the initial unit list for a new job. */
export function buildUnits(ideas, stories, count) {
  const n = clamp(count ?? (ideas?.length || 10), 1, 10);
  const units = [];
  const existing = [];
  for (let i = 0; i < n; i++) {
    let idea = (ideas?.[i] ?? "").trim();
    if (!idea) idea = offlineIdea(existing);
    existing.push(idea);
    units.push({
      index: i,
      idea,
      story: (stories?.[i] ?? "").trim() || undefined,
      status: "queued",
    });
  }
  return units;
}
