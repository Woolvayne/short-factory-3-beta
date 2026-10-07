/**
 * Panel 07 · CLOUD-FABRIK (Railway) — ein Knopf, dann darf der Tab zu:
 * Ideen + Settings + Quelle gehen an das Railway-Backend (`server/`),
 * das die Videos serverseitig mit ffmpeg rendert. Ergebnisse können
 * jederzeit später heruntergeladen werden — auch von einem anderen Gerät.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudUpload,
  Download,
  Loader2,
  RefreshCw,
  Satellite,
  Trash2,
} from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";
import type { Settings } from "../lib/settings";
import type { ClipSource } from "../lib/clips";
import type { MusicFile } from "../lib/types";
import {
  checkCloud,
  cloudSettings,
  cloudVideoUrl,
  deleteCloudJob,
  isCloudConfigured,
  jobActive,
  listCloudJobs,
  loadCloudConfig,
  saveCloudConfig,
  submitCloudJob,
  uploadToCloud,
  type CloudConfig,
  type CloudJob,
} from "../lib/cloud";
import { formatBytes } from "../lib/media";

type LinkState = "unknown" | "checking" | "online" | "offline";

const STATUS_LABEL: Record<CloudJob["status"], string> = {
  queued: "IN QUEUE",
  running: "RENDERT…",
  done: "FERTIG",
  partial: "TEILWEISE",
  failed: "FEHLER",
  canceled: "ABGEBROCHEN",
};

export default function CloudPanel({
  ideas,
  settings,
  source,
  tracks,
  disabled,
}: {
  ideas: string[];
  settings: Settings;
  source: ClipSource | null;
  tracks: MusicFile[];
  disabled?: boolean;
}) {
  const [cfg, setCfg] = useState<CloudConfig>(() => loadCloudConfig());
  const [link, setLink] = useState<LinkState>("unknown");
  const [linkNote, setLinkNote] = useState<string>("");
  const [jobs, setJobs] = useState<CloudJob[]>([]);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string>("");
  const [sendError, setSendError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const configured = isCloudConfigured(cfg);
  const filledIdeas = useMemo(() => ideas.map((i) => i.trim()).filter(Boolean), [ideas]);
  const selectedTrack = tracks.find((t) => t.selected) ?? null;

  const updateCfg = (patch: Partial<CloudConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveCloudConfig(next);
      return next;
    });
    setLink("unknown");
  };

  const refreshJobs = useCallback(async () => {
    if (!isCloudConfigured(cfg)) return;
    try {
      const list = await listCloudJobs(cfg);
      setJobs(list);
      setLink("online");
    } catch {
      /* poll errors stay silent — the TEST button reports loudly */
    }
  }, [cfg]);

  /* poll while a job is active */
  useEffect(() => {
    const anyActive = jobs.some(jobActive);
    if (!anyActive) return;
    pollRef.current = window.setInterval(() => void refreshJobs(), 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobs, refreshJobs]);

  /* initial fetch when configured */
  useEffect(() => {
    if (configured) void refreshJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  const test = async () => {
    setLink("checking");
    setLinkNote("");
    try {
      const q = await checkCloud(cfg);
      setLink("online");
      setLinkNote(`VERBUNDEN · QUEUE ${q.queued + q.running}`);
      void refreshJobs();
    } catch (e) {
      setLink("offline");
      setLinkNote(String((e as Error).message ?? e));
    }
  };

  const blockers: string[] = [];
  if (!configured) blockers.push("BACKEND-URL + API-KEY EINTRAGEN");
  if (filledIdeas.length === 0) blockers.push("MINDESTENS 1 IDEE IN 01");
  if (!source) blockers.push("QUELLE IN 02 WÄHLEN (1 SOURCE → 10)");

  const send = async () => {
    if (blockers.length > 0 || sending || !source) return;
    setSending(true);
    setSendError(null);
    try {
      let videoUrl: string | undefined;
      let uploadId: string | undefined;
      if (source.origin === "url") {
        videoUrl = source.url;
      } else if (source.file) {
        setSendNote("VIDEO-UPLOAD 0%");
        uploadId = await uploadToCloud(cfg, source.file, (f) =>
          setSendNote(`VIDEO-UPLOAD ${Math.round(f * 100)}%`)
        );
      } else {
        throw new Error("Quelle hat keine Datei — bitte in 02 neu wählen.");
      }

      let musicUploadId: string | undefined;
      if (selectedTrack) {
        setSendNote("MUSIK-UPLOAD 0%");
        musicUploadId = await uploadToCloud(cfg, selectedTrack.file, (f) =>
          setSendNote(`MUSIK-UPLOAD ${Math.round(f * 100)}%`)
        );
      }

      setSendNote("JOB WIRD ANGELEGT…");
      const job = await submitCloudJob(cfg, {
        videoUrl,
        uploadId,
        musicUploadId,
        count: filledIdeas.length,
        ideas: filledIdeas,
        settings: cloudSettings(settings),
      });
      setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
      setSendNote("");
    } catch (e) {
      setSendError(String((e as Error).message ?? e));
      setSendNote("");
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    try {
      await deleteCloudJob(cfg, id);
    } catch {
      /* noop */
    }
  };

  return (
    <Section
      index="07"
      title="Cloud-Fabrik · Server"
      hint="KNOPF DRÜCKEN · TAB ZU · SPÄTER DOWNLOADEN"
      complete={jobs.some((j) => j.status === "done")}
      active={jobs.some(jobActive)}
      aside={
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              link === "online"
                ? "bg-volt-400 animate-led"
                : link === "offline"
                  ? "bg-red-500"
                  : "bg-coal-600"
            )}
          />
          <span className="mono-label text-[9px] text-coal-400">
            {link === "online" ? "ONLINE" : link === "offline" ? "OFFLINE" : link === "checking" ? "PRÜFE…" : "CLOUD"}
          </span>
        </span>
      }
    >
      <div className="grid gap-3">
        {/* config */}
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            type="url"
            value={cfg.baseUrl}
            onChange={(e) => updateCfg({ baseUrl: e.target.value })}
            placeholder="https://…up.railway.app"
            spellCheck={false}
            className="w-full border border-coal-600 bg-coal-850/80 px-3 py-2 font-mono text-[11px] tracking-wider text-coal-100 placeholder:text-coal-500 focus:border-volt-400 focus:outline-none"
          />
          <input
            type="password"
            value={cfg.apiKey}
            onChange={(e) => updateCfg({ apiKey: e.target.value })}
            placeholder="sfk_… (API-Key vom Backend)"
            spellCheck={false}
            className="w-full border border-coal-600 bg-coal-850/80 px-3 py-2 font-mono text-[11px] tracking-wider text-coal-100 placeholder:text-coal-500 focus:border-volt-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void test()}
            disabled={!configured || link === "checking"}
            className="flex items-center justify-center gap-2 border border-coal-500 px-4 py-2 font-display text-[11px] font-black tracking-[0.14em] text-coal-200 uppercase transition-colors hover:border-volt-400 hover:text-volt-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {link === "checking" ? <Loader2 className="size-3.5 animate-spin" /> : <Satellite className="size-3.5" />}
            Test
          </button>
        </div>
        {linkNote && (
          <p className={cn("mono-label text-[9px]", link === "offline" ? "text-red-400" : "text-volt-300")}>
            {linkNote}
          </p>
        )}

        {/* send */}
        <button
          type="button"
          onClick={() => void send()}
          disabled={disabled || sending || blockers.length > 0}
          className={cn(
            "flex w-full items-center justify-center gap-2.5 border px-4 py-3.5 font-display text-sm font-black tracking-[0.14em] uppercase transition-all",
            blockers.length === 0 && !sending
              ? "border-volt-400 bg-volt-400/15 text-volt-300 hover:bg-volt-400/25"
              : "border-coal-600 text-coal-500",
            (disabled || sending || blockers.length > 0) && "cursor-not-allowed opacity-60"
          )}
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
          {sending ? sendNote || "SENDET…" : `${filledIdeas.length || "–"} VIDEOS IN DER CLOUD RENDERN`}
        </button>
        <p className="mono-label text-[9px] leading-relaxed text-coal-400">
          {blockers.length > 0
            ? `FEHLT: ${blockers.join(" · ")}`
            : "SOBALD DER JOB ANGENOMMEN IST, DARF DIESER TAB GESCHLOSSEN WERDEN — GERENDERT WIRD AUF DEM SERVER (FFMPEG). INTRO-KARTE IN DER CLOUD: VEREINFACHTE VERSION OHNE FLUG-ANIMATION."}
        </p>
        {sendError && <p className="mono-label text-[9px] text-red-400">{sendError}</p>}

        {/* job list */}
        {jobs.length > 0 && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="mono-label text-[9px] text-coal-400">CLOUD-JOBS</span>
              <button
                type="button"
                onClick={() => void refreshJobs()}
                className="flex items-center gap-1.5 font-mono text-[9px] tracking-wider text-coal-400 hover:text-volt-300"
              >
                <RefreshCw className="size-3" /> AKTUALISIEREN
              </button>
            </div>
            {jobs.map((job) => (
              <div key={job.id} className="border border-coal-700/80 bg-coal-850/50">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-coal-700/60 px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    {jobActive(job) && <Loader2 className="size-3 animate-spin text-volt-400" />}
                    <span className="font-mono text-[9.5px] tracking-wider text-coal-300">{job.id}</span>
                    <span
                      className={cn(
                        "mono-label text-[9px]",
                        job.status === "done"
                          ? "text-volt-300"
                          : job.status === "failed"
                            ? "text-red-400"
                            : "text-coal-300"
                      )}
                    >
                      {STATUS_LABEL[job.status]} · {job.progress.done}/{job.progress.total}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(job.id)}
                    className="text-coal-500 hover:text-red-400"
                    title="Job löschen"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {job.error && (
                  <p className="px-3 py-1.5 font-mono text-[9px] tracking-wider text-red-400">{job.error}</p>
                )}
                <div className="grid gap-1 px-3 py-2">
                  {job.units.map((u) => (
                    <div key={u.index} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[9.5px] tracking-wider text-coal-400">
                        {String(u.index + 1).padStart(2, "0")} · {u.idea.slice(0, 48)}
                      </span>
                      {u.status === "done" && u.videoPath ? (
                        <a
                          href={cloudVideoUrl(cfg, u.videoPath)}
                          className="flex shrink-0 items-center gap-1.5 border border-volt-400/60 px-2 py-1 font-display text-[9px] font-black tracking-[0.12em] text-volt-300 uppercase hover:bg-volt-400/15"
                        >
                          <Download className="size-3" /> MP4{u.size ? ` · ${formatBytes(u.size)}` : ""}
                        </a>
                      ) : (
                        <span
                          className={cn(
                            "mono-label shrink-0 text-[9px]",
                            u.status === "error" ? "text-red-400" : "text-coal-500"
                          )}
                          title={u.error}
                        >
                          {u.status === "error" ? "FEHLER" : u.status.toUpperCase()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
