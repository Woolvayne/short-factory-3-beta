/**
 * Server-side render pipeline — replaces the browser's Canvas +
 * MediaRecorder path with ffmpeg so videos keep rendering after the
 * user closes the tab.
 *
 * Per unit: background clip window → scale/crop to 9:16 → burn ASS
 * captions (+ simplified Reddit intro card) → mix Edge-TTS voice with
 * an optional music bed → H.264/AAC MP4.
 */

import { execFile } from "node:child_process";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/* Encoding preset — override for weak boxes: FFMPEG_PRESET=ultrafast
   is the recommended setting on a Raspberry Pi 3B+ (see docs/RASPBERRY_PI.md). */
const FFMPEG_PRESET = (() => {
  const allowed = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"]);
  const p = String(process.env.FFMPEG_PRESET || "veryfast").trim().toLowerCase();
  return allowed.has(p) ? p : "veryfast";
})();

/** Small-box introspection for GET /health (no secrets). */
export function renderProfile() {
  return { preset: FFMPEG_PRESET, autoDims: resolveDims("auto") };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 32 * 1024 * 1024, timeout: opts.timeoutMs ?? 15 * 60_000, cwd: opts.cwd },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || "").split("\n").slice(-14).join("\n");
          reject(new Error(`${path.basename(cmd)} failed: ${err.message}\n${tail}`));
        } else resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

/** Silent MP3 for the TTS_FAKE=1 smoke-test mode (no Microsoft endpoint needed). */
export async function makeSilentMp3(dest, seconds) {
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-t", Math.max(1, seconds).toFixed(2),
    "-c:a", "libmp3lame", "-b:a", "48k",
    dest,
  ]);
}

export async function probeDuration(file) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("could not probe video duration");
  return d;
}

/** Download a direct video/audio URL to disk (no platform ripping — direct files only). */
export async function downloadFile(url, dest, maxBytes = 2_000_000_000) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error(`file too large (${Math.round(len / 1e6)} MB)`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const stat = await fs.stat(dest);
  if (stat.size === 0) throw new Error("downloaded file is empty");
  return stat.size;
}

/**
 * Plan `count` clip windows across the source (mirrors src/lib/clips.ts):
 * even distribution inside [skipIntro, duration - skipOutro].
 */
export function planWindows(sourceDuration, count, clipLengths, { skipIntro = 5, skipOutro = 5, mode = "even" } = {}) {
  const usableStart = Math.min(skipIntro, sourceDuration * 0.2);
  const usableEnd = Math.max(usableStart + 1, sourceDuration - Math.min(skipOutro, sourceDuration * 0.2));
  const usable = usableEnd - usableStart;
  const windows = [];
  for (let i = 0; i < count; i++) {
    const len = Math.min(clipLengths[i], Math.max(3, usable));
    let start;
    if (mode === "sequential") {
      start = usableStart + (i * usable) / count;
    } else if (mode === "random") {
      start = usableStart + Math.random() * Math.max(0.001, usable - len);
    } else {
      const segLen = usable / count;
      const segStart = usableStart + i * segLen;
      const wiggle = Math.max(0, segLen - len);
      start = segStart + Math.random() * wiggle;
    }
    start = Math.max(usableStart, Math.min(start, Math.max(usableStart, usableEnd - len)));
    windows.push({ start, length: len });
  }
  return windows;
}

export function resolveDims(quality) {
  if (quality === "540") return { width: 540, height: 960 };
  if (quality === "1080") return { width: 1080, height: 1920 };
  // "auto" on a small cloud box = 720p; on a Raspberry Pi 3B+ set
  // DEFAULT_QUALITY=540 (see docs/RASPBERRY_PI.md) to halve render time.
  const dflt = String(process.env.DEFAULT_QUALITY || "720").trim();
  if (dflt === "540") return { width: 540, height: 960 };
  if (dflt === "1080") return { width: 1080, height: 1920 };
  return { width: 720, height: 1280 }; // "auto" default = 720p
}

/**
 * Render one unit.
 *
 * args: {
 *   jobDir, index,
 *   bgFile, clipStart, voiceFile, voiceDuration, musicFile (optional),
 *   assFile (optional), settings: { quality, fps, tailPadding, voiceVolume,
 *   musicVolume, musicFade, vignette, bitrate }
 * }
 * → { outFile, duration, size }
 */
export async function renderUnit(a) {
  const s = a.settings ?? {};
  const { width, height } = resolveDims(s.quality ?? "auto");
  const fps = [24, 30, 60].includes(Number(s.fps)) ? Number(s.fps) : 30;
  const tail = Math.max(0, Math.min(3, Number(s.tailPadding ?? 0.6)));
  const total = a.voiceDuration + tail;
  const crf = s.bitrate === "high" ? 20 : s.bitrate === "low" ? 27 : 23;

  const outFile = path.join(a.jobDir, `unit-${String(a.index + 1).padStart(2, "0")}.mp4`);

  /* ---- video chain ---- */
  let vf =
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},fps=${fps},setsar=1`;
  if (s.vignette !== false) vf += ",vignette=PI/4.4";
  if (a.assFile) vf += `,subtitles=filename=${path.basename(a.assFile)}`; // relative → cwd=jobDir

  /* ---- audio chain ---- */
  const voiceVol = Math.max(0, Math.min(1.4, Number(s.voiceVolume ?? 1)));
  const musicVol = Math.max(0, Math.min(0.5, Number(s.musicVolume ?? 0.13)));
  const hasMusic = Boolean(a.musicFile) && musicVol > 0;

  const filters = [];
  let aOut;
  // plain apad (unlimited) is version-safe; the output is capped by -t anyway
  filters.push(`[1:a]volume=${voiceVol},apad[va]`);
  if (hasMusic) {
    let m = `[2:a]volume=${musicVol},atrim=0:${total.toFixed(2)}`;
    if (s.musicFade !== false && total > 2.5) {
      m += `,afade=t=out:st=${(total - 2).toFixed(2)}:d=2`;
    }
    m += "[ma]";
    filters.push(m);
    // amix scales each of n inputs by 1/n — volume=2 restores unity gain.
    // (version-safe alternative to the newer `normalize=0` option)
    filters.push(`[va][ma]amix=inputs=2:duration=first:dropout_transition=0,volume=2[aout]`);
    aOut = "[aout]";
  } else {
    aOut = "[va]";
  }

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  // background: loop if the window would run past the end of the file
  args.push("-stream_loop", "-1", "-ss", a.clipStart.toFixed(2), "-t", (total + 0.5).toFixed(2), "-i", a.bgFile);
  args.push("-i", a.voiceFile);
  if (hasMusic) args.push("-stream_loop", "-1", "-i", a.musicFile);

  args.push(
    "-filter_complex", `[0:v]${vf}[vout];${filters.join(";")}`,
    "-map", "[vout]", "-map", aOut,
    "-t", total.toFixed(2),
    "-c:v", "libx264", "-preset", FFMPEG_PRESET, "-crf", String(crf),
    "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-movflags", "+faststart",
    path.basename(outFile)
  );

  await run(FFMPEG, args, { cwd: a.jobDir, timeoutMs: 30 * 60_000 });
  const stat = await fs.stat(outFile);
  if (stat.size < 10_000) throw new Error("render produced a suspiciously small file");
  return { outFile, duration: total, size: stat.size };
}
