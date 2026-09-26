import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ArrowDown,
  Captions,
  Clapperboard,
  Cpu,
  FileArchive,
  HardDrive,
  Loader2,
  Mic,
  MessageSquare,
  Radio,
  Rocket,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import Header from "./components/Header";
import IdeasPanel from "./components/IdeasPanel";
import SettingsPanel from "./components/SettingsPanel";
import ClipMill, { type FetchState, type SourceMode } from "./components/ClipMill";
import { MusicPanel } from "./components/Uploaders";
import {
  AssemblyPanel,
  OutputPanel,
  videoFileName,
  type ZipState,
} from "./components/MissionControl";
import type { BgFile, LocalRenderItem, MusicFile, Phase, VoiceTake } from "./lib/types";
import {
  formatClock,
  isPortrait916,
  probeAudio,
  probeVideo,
  shuffle,
  sleep,
  uid,
} from "./lib/media";
import {
  hasAnyLLMKey,
  loadSettings,
  resolveDimensions,
  saveSettings,
  styleInstruction,
  type Settings,
} from "./lib/settings";
import { generateIdeas, generateStory } from "./lib/llm";
import { synthesizeSpeech } from "./lib/tts";
import { recorderSupported, renderLocal } from "./lib/renderer";
import {
  detectPlatform,
  fetchRemoteVideo,
  planClips,
  probeUrl,
  rerollClip,
  type ClipPlan,
  type ClipSource,
} from "./lib/clips";
import { introOptionsFor, introTitleFor } from "./lib/intro";
import {
  GATE_EXPIRED_EVENT,
  fetchGateStatus,
  isUnlocked,
  lock as lockGate,
  type GateStatus,
} from "./lib/gate";
import {
  SHIP_GAP_MS,
  fetchZernioStatus,
  fillCustomTimes,
  loadShipConfig,
  saveShipConfig,
  shipFileName,
  shipGap,
  shipVideo,
  type ShipConfig,
  type ZernioStatus,
} from "./lib/zernio";
import {
  avoidSlotCollisions,
  configForPlan,
  defaultPlanFor,
  slotsForPlan,
  type ShipPlan,
  type ShipQueueEntry,
} from "./lib/shipPlan";
import PasswordGate from "./components/PasswordGate";
import SetupPanel from "./components/SetupPanel";
import ShipDialog from "./components/ShipDialog";
import ShipPanel, { IDLE_SHIP_RUN, type ShipRun } from "./components/ShipPanel";
import type { ShipLogEntry, ShipState } from "./lib/types";

const INITIAL_IDEAS = Array.from({ length: 10 }, () => "");
const IDLE_ZIP: ZipState = {
  active: false,
  done: 0,
  total: 0,
  url: null,
  name: null,
  size: 0,
  error: null,
};
const IDLE_FETCH: FetchState = {
  active: false,
  received: 0,
  total: 0,
  error: null,
  platform: null,
};

type AnyAudioContext = typeof AudioContext;

function Factory({ onLock, gateStatus }: { onLock?: () => void; gateStatus?: GateStatus | null }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [ideas, setIdeas] = useState<string[]>(INITIAL_IDEAS);

  /* clip mill */
  const [mode, setMode] = useState<SourceMode>("single");
  const [source, setSource] = useState<ClipSource | null>(null);
  const [clips, setClips] = useState<ClipPlan[]>([]);
  const [link, setLink] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>(IDLE_FETCH);
  const [bgs, setBgs] = useState<BgFile[]>([]);

  const [tracks, setTracks] = useState<MusicFile[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<LocalRenderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zip, setZip] = useState<ZipState>(IDLE_ZIP);
  const [elapsed, setElapsed] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeProgress, setActiveProgress] = useState(0);
  const [ideaGenAll, setIdeaGenAll] = useState(false);
  const [ideaGenIndex, setIdeaGenIndex] = useState<number | null>(null);

  /* zernio versand */
  const [shipCfg, setShipCfg] = useState<ShipConfig>(() => loadShipConfig());
  const [shipStatus, setShipStatus] = useState<ZernioStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [shipStates, setShipStates] = useState<Record<number, ShipState>>({});
  const [shipRun, setShipRun] = useState<ShipRun>(IDLE_SHIP_RUN);
  const [shipLog, setShipLog] = useState<ShipLogEntry[]>([]);
  /** offener Sendeplan-Dialog (ein Video oder der ganze Stapel) */
  const [shipDialog, setShipDialog] = useState<{
    scope: "single" | "batch";
    indices: number[];
  } | null>(null);

  const bgsRef = useRef(bgs);
  bgsRef.current = bgs;
  const itemsRef = useRef<LocalRenderItem[]>([]);
  itemsRef.current = items;
  const voicesRef = useRef<Map<number, VoiceTake>>(new Map());
  const clipsRef = useRef<ClipPlan[]>([]);
  clipsRef.current = clips;
  const sourceRef = useRef<ClipSource | null>(null);
  sourceRef.current = source;
  const zipUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const shipCfgRef = useRef(shipCfg);
  shipCfgRef.current = shipCfg;
  const shipStatesRef = useRef<Record<number, ShipState>>({});
  shipStatesRef.current = shipStates;
  const zernioStatusRef = useRef<ZernioStatus | null>(null);
  const pendingShipRef = useRef<ShipQueueEntry[]>([]);
  const shipRunningRef = useRef(false);
  const cancelShipRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const shipDoneRef = useRef(0);
  const shipTotalRef = useRef(0);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveShipConfig(shipCfg), [shipCfg]);

  const busy = phase === "preparing" || phase === "rendering";

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => {
      if (startedAtRef.current) setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  const ensureAudioCtx = useCallback(async () => {
    if (!audioCtxRef.current) {
      const AC: AnyAudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: AnyAudioContext }).webkitAudioContext;
      audioCtxRef.current = new AC();
    }
    try {
      await audioCtxRef.current.resume();
    } catch {
      /* best effort */
    }
    return audioCtxRef.current;
  }, []);

  /* ------------------------------------------------------------ */
  /*  clip mill — one source → 10 windows                          */
  /* ------------------------------------------------------------ */

  const adoptSource = useCallback(
    async (file: File, origin: "file" | "url", displayName?: string) => {
      const url = URL.createObjectURL(file);
      try {
        const meta = await probeVideo(file);
        const src: ClipSource = {
          id: uid(),
          name: displayName ?? file.name,
          origin,
          file,
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          size: file.size,
          portrait: isPortrait916(meta.width, meta.height),
        };
        setSource((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return src;
        });
        setClips(planClips(src, settings));
        setFetchState(IDLE_FETCH);
      } catch (e) {
        URL.revokeObjectURL(url);
        setFetchState({
          ...IDLE_FETCH,
          error: e instanceof Error ? e.message : "Could not read that video",
        });
      }
    },
    [settings]
  );

  const loadLink = useCallback(async () => {
    const url = link.trim();
    if (!url) return;

    const platform = detectPlatform(url);
    if (platform) {
      setFetchState({ ...IDLE_FETCH, platform });
      return;
    }

    setFetchState({ active: true, received: 0, total: 0, error: null, platform: null });
    try {
      await probeUrl(url); // fail fast on CORS / wrong content
      const { blob, name } = await fetchRemoteVideo(url, (received, total) =>
        setFetchState((s) => ({ ...s, received, total }))
      );
      const file = new File([blob], name, { type: blob.type || "video/mp4" });
      await adoptSource(file, "url", name);
      setLink("");
    } catch (e) {
      setFetchState({
        ...IDLE_FETCH,
        error:
          (e instanceof Error ? e.message : "Download failed") +
          " — the host must allow cross-origin requests. Download the file and pick it on the left instead.",
      });
    }
  }, [link, adoptSource]);

  const clearSource = useCallback(() => {
    setSource((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setClips([]);
    setFetchState(IDLE_FETCH);
  }, []);

  const reslice = useCallback(() => {
    if (source) setClips(planClips(source, settings));
  }, [source, settings]);

  const reroll = useCallback(
    (id: string) => {
      if (!source) return;
      setClips((prev) => prev.map((c) => (c.id === id ? rerollClip(c, source, settings) : c)));
    },
    [source, settings]
  );

  /* ------------------------------------------------------------ */
  /*  multi-file intake                                            */
  /* ------------------------------------------------------------ */

  const patchBg = useCallback((id: string, patch: Partial<BgFile>) => {
    setBgs((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const addBackgrounds = useCallback(
    async (files: File[]) => {
      const remaining = 10 - bgsRef.current.length;
      const picked = files
        .filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(f.name))
        .slice(0, Math.max(0, remaining));
      for (const file of picked) {
        const entry: BgFile = {
          id: uid(),
          file,
          width: 0,
          height: 0,
          duration: 0,
          status: "validating",
        };
        setBgs((prev) => (prev.length < 10 ? [...prev, entry] : prev));
        try {
          const meta = await probeVideo(file);
          if (!isPortrait916(meta.width, meta.height)) {
            patchBg(entry.id, {
              ...meta,
              status: "error",
              reason: `NOT 9:16 — ${meta.width}×${meta.height}`,
            });
            continue;
          }
          patchBg(entry.id, { ...meta, status: "ready" });
        } catch (e) {
          patchBg(entry.id, {
            status: "error",
            reason: e instanceof Error ? e.message.slice(0, 60).toUpperCase() : "UNREADABLE",
          });
        }
      }
    },
    [patchBg]
  );

  const addTracks = useCallback(async (files: File[]) => {
    const audios = files.filter(
      (f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav)$/i.test(f.name)
    );
    for (const file of audios) {
      const duration = await probeAudio(file);
      setTracks((prev) => [
        ...prev,
        { id: uid(), file, duration, selected: prev.length === 0 },
      ]);
    }
  }, []);

  /* ------------------------------------------------------------ */
  /*  idea engine — AI-written story titles                        */
  /* ------------------------------------------------------------ */

  const storyCfg = useCallback(
    () => ({
      qwenKey: settings.qwenKey,
      mistralKey: settings.mistralKey,
      words: settings.storyWords,
      temperature: settings.temperature,
      styleInstruction: styleInstruction(settings),
    }),
    [settings]
  );

  const generateAllIdeas = useCallback(async () => {
    if (ideaGenAll || ideaGenIndex !== null) return;
    setIdeaGenAll(true);
    setError(null);
    try {
      const { ideas: fresh } = await generateIdeas(10, storyCfg());
      setIdeas((prev) => prev.map((old, i) => fresh[i] ?? old));
    } catch (e) {
      setError(
        `Could not write titles: ${e instanceof Error ? e.message : e}. Try the SAMPLES button.`
      );
    } finally {
      setIdeaGenAll(false);
    }
  }, [ideaGenAll, ideaGenIndex, storyCfg]);

  const generateOneIdea = useCallback(
    async (index: number) => {
      if (ideaGenAll || ideaGenIndex !== null) return;
      setIdeaGenIndex(index);
      setError(null);
      try {
        const { ideas: fresh } = await generateIdeas(3, storyCfg());
        const taken = new Set(ideas.filter((_, i) => i !== index));
        const pick = fresh.find((f) => !taken.has(f)) ?? fresh[0];
        if (pick) setIdeas((prev) => prev.map((old, i) => (i === index ? pick : old)));
      } catch (e) {
        setError(`Could not write that title: ${e instanceof Error ? e.message : e}`);
      } finally {
        setIdeaGenIndex(null);
      }
    },
    [ideaGenAll, ideaGenIndex, ideas, storyCfg]
  );

  /* ------------------------------------------------------------ */
  /*  readiness                                                    */
  /* ------------------------------------------------------------ */

  const readyBgs = useMemo(() => bgs.filter((b) => b.status === "ready"), [bgs]);
  const musicFile = useMemo(() => tracks.find((t) => t.selected)?.file ?? null, [tracks]);
  const ideasReady = ideas.every((i) => i.trim().length > 2);
  const footageReady = mode === "single" ? !!source && clips.length === 10 : readyBgs.length === 10;

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!ideasReady) out.push("FILL ALL 10 IDEAS");
    if (!footageReady)
      out.push(mode === "single" ? "LOAD A SOURCE VIDEO" : `${readyBgs.length}/10 CLIPS LOADED`);
    if (!recorderSupported()) out.push("BROWSER CANNOT RECORD VIDEO");
    return out;
  }, [ideasReady, footageReady, mode, readyBgs.length]);

  const canPrepare = blockers.length === 0;

  const patchItem = useCallback((index: number, patch: Partial<LocalRenderItem>) => {
    setItems((prev) => prev.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  }, []);

  /* ------------------------------------------------------------ */
  /*  STEP ① prepare — scripts + voices only                       */
  /* ------------------------------------------------------------ */

  const prepare = useCallback(async () => {
    if (!canPrepare || busy) return;
    setError(null);
    setZip(IDLE_ZIP);
    for (const it of itemsRef.current) if (it.blobUrl) URL.revokeObjectURL(it.blobUrl);
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = null;
    }
    voicesRef.current.clear();
    cancelRef.current = { cancelled: false };
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("preparing");

    const seeded: LocalRenderItem[] = ideas.map((idea, index) => ({
      index,
      idea: idea.trim(),
      status: "script",
    }));
    setItems(seeded);
    /* neuer Durchlauf → alte Versand-Stände verwerfen */
    cancelShipRef.current.cancelled = true;
    pendingShipRef.current = [];
    shipDoneRef.current = 0;
    shipTotalRef.current = 0;
    setShipStates({});
    setShipLog([]);
    setShipRun(IDLE_SHIP_RUN);
    await ensureAudioCtx();

    const cfg = {
      qwenKey: settings.qwenKey,
      mistralKey: settings.mistralKey,
      words: settings.storyWords,
      temperature: settings.temperature,
      styleInstruction: styleInstruction(settings),
    };

    const queue = seeded.map((_, i) => i);
    const worker = async (lane: number) => {
      if (lane) await sleep(600);
      while (queue.length > 0) {
        if (cancelRef.current.cancelled) return;
        const index = queue.shift()!;
        try {
          patchItem(index, { status: "script" });
          const story = await generateStory(seeded[index].idea, index % 2 === 0, cfg);
          patchItem(index, { story: story.text, provider: story.provider, status: "voice" });

          /* The intro card and its title must be the hook: speak the exact
           * title first, then continue with the generated story. Keep the
           * card setting as the switch so disabling the intro preserves the
           * previous story-only narration. */
          const narration = settings.introOn
            ? `${introTitleFor(seeded[index], settings)}. ${story.text}`
            : story.text;
          const take = await synthesizeSpeech(
            narration,
            settings.voice,
            settings.rate,
            settings.pitch
          );
          if (!take.audio.byteLength) throw new Error("voice engine returned no audio");
          voicesRef.current.set(index, take);
          patchItem(index, { status: "staged", voiceDuration: take.duration });
        } catch (e) {
          patchItem(index, {
            status: "error",
            error: String(e instanceof Error ? e.message : e).slice(0, 220),
          });
        }
      }
    };
    await Promise.all([worker(0), worker(1)]);

    /* re-slice with the real voice lengths so clips match the stories */
    const src = sourceRef.current;
    if (src && settings.clipLengthMode === "auto") {
      const lengths = itemsRef.current.map((it) => it.voiceDuration ?? 35);
      setClips(planClips(src, settings, 10, lengths));
    }

    const staged = itemsRef.current.filter((i) => i.status === "staged").length;
    setPhase(staged > 0 ? "staged" : "failed");
    if (staged === 0)
      setError("Nothing could be prepared — voice synthesis needs an internet connection.");
  }, [canPrepare, busy, ideas, settings, patchItem, ensureAudioCtx]);

  /* ------------------------------------------------------------ */
  /*  STEP ② render — explicit, per unit or all                    */
  /* ------------------------------------------------------------ */

  const renderIndexes = useCallback(
    async (indexes: number[]) => {
      if (indexes.length === 0 || busy) return;
      setError(null);
      cancelRef.current = { cancelled: false };
      if (!startedAtRef.current) startedAtRef.current = Date.now();
      setPhase("rendering");

      const ac = await ensureAudioCtx();
      const { width, height } = resolveDimensions(settings.quality);
      const dealt = mode === "files" ? shuffle([...readyBgs]).map((b) => b.file) : [];

      for (const index of indexes) {
        if (cancelRef.current.cancelled) break;
        const take = voicesRef.current.get(index);
        if (!take) continue;

        const clip = clipsRef.current.find((c) => c.index === index);
        const src = sourceRef.current;
        const bgUrl = mode === "single" ? src?.url : undefined;
        const fileForIndex = mode === "files" ? dealt[index] : undefined;
        let tempUrl: string | null = null;
        if (!bgUrl && fileForIndex) tempUrl = URL.createObjectURL(fileForIndex);

        const useUrl = bgUrl ?? tempUrl;
        if (!useUrl) continue;

        setActiveIndex(index);
        setActiveProgress(0);
        patchItem(index, { status: "rendering", error: undefined });

        try {
          const ideaForUnit = itemsRef.current.find((i) => i.index === index)?.idea ?? "";
          const result = await renderLocal({
            bgUrl: useUrl,
            clipStart: mode === "single" ? (clip?.start ?? 0) : Math.random() * 3,
            voiceMp3: take.audio,
            words: take.words,
            musicFile,
            width,
            height,
            audioCtx: ac,
            settings,
            /* Reddit-Story-Intro: fliegt in den ersten Sekunden ein */
            intro: introOptionsFor({ idea: ideaForUnit }, settings),
            signal: cancelRef.current,
            onProgress: setActiveProgress,
          });
          const prevUrl = itemsRef.current.find((i) => i.index === index)?.blobUrl;
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          patchItem(index, {
            status: "done",
            blob: result.blob,
            blobUrl: URL.createObjectURL(result.blob),
            mime: result.mimeType,
            size: result.blob.size,
            duration: result.duration,
            clipStart: clip?.start,
          });
        } catch (e) {
          patchItem(index, {
            status: "error",
            error: String(e instanceof Error ? e.message : e).slice(0, 220),
          });
        } finally {
          if (tempUrl) URL.revokeObjectURL(tempUrl);
        }
      }

      setActiveIndex(null);
      setActiveProgress(0);

      const snapshot = itemsRef.current;
      const done = snapshot.filter((i) => i.status === "done").length;
      const stagedLeft = snapshot.filter((i) => i.status === "staged").length;
      setPhase(
        done === 10
          ? "ready"
          : stagedLeft > 0
            ? "staged"
            : done > 0
              ? "partial"
              : "failed"
      );
    },
    [busy, ensureAudioCtx, settings, mode, readyBgs, musicFile, patchItem]
  );

  const renderAll = useCallback(() => {
    const targets = itemsRef.current
      .filter((i) => i.status === "staged")
      .map((i) => i.index);
    void renderIndexes(targets);
  }, [renderIndexes]);

  const renderOne = useCallback(
    (index: number) => {
      void renderIndexes([index]);
    },
    [renderIndexes]
  );

  const cancel = useCallback(() => {
    cancelRef.current.cancelled = true;
  }, []);

  /* ------------------------------------------------------------ */
  /*  zip dispatch                                                 */
  /* ------------------------------------------------------------ */

  const buildZip = useCallback(async () => {
    const dones = itemsRef.current.filter((r) => r.status === "done" && r.blob);
    if (dones.length === 0 || zip.active) return;
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = null;
    }
    setZip({ ...IDLE_ZIP, active: true, total: dones.length });

    try {
      const zipFile = new JSZip();
      for (let i = 0; i < dones.length; i++) {
        zipFile.file(videoFileName(dones[i]), dones[i].blob!);
        setZip((z) => ({ ...z, done: i + 1 }));
        await sleep(0);
      }
      const blob = await zipFile.generateAsync({ type: "blob", compression: "STORE" });
      const url = URL.createObjectURL(blob);
      zipUrlRef.current = url;
      const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
      const name = `shortsfactory_${stamp}.zip`;
      setZip({
        active: false,
        done: dones.length,
        total: dones.length,
        url,
        name,
        size: blob.size,
        error: null,
      });

      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setZip((z) => ({
        ...z,
        active: false,
        error: String(e instanceof Error ? e.message : e),
      }));
    }
  }, [zip.active]);

  /* ------------------------------------------------------------ */
  /*  Zernio-Versandweg — einzeln oder alle 10, immer 3 s Takt     */
  /* ------------------------------------------------------------ */

  const patchShip = useCallback((index: number, patch: Partial<ShipState>) => {
    setShipStates((prev) => {
      const base: ShipState = prev[index] ?? { status: "idle", progress: 0 };
      return { ...prev, [index]: { ...base, ...patch } };
    });
  }, []);

  const pushShipRun = useCallback((extra?: Partial<ShipRun>) => {
    setShipRun((r) => ({
      ...r,
      done: shipDoneRef.current,
      total: Math.max(shipTotalRef.current, shipDoneRef.current + pendingShipRef.current.length),
      pending: pendingShipRef.current.length,
      ...extra,
    }));
  }, []);

  const refreshZernioStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await fetchZernioStatus();
      zernioStatusRef.current = status;
      setShipStatus(status);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  /* einmal beim Start: ist der Key gesetzt, welche Accounts sind verbunden? */
  useEffect(() => {
    void refreshZernioStatus();
  }, [refreshZernioStatus]);

  const runShipQueue = useCallback(async () => {
    if (shipRunningRef.current) return;
    shipRunningRef.current = true;
    cancelShipRef.current = { cancelled: false };
    shipDoneRef.current = 0;
    shipTotalRef.current = pendingShipRef.current.length;
    pushShipRun({ active: true, currentIndex: null, waitMs: 0, error: null });

    let dispatched = 0;

    try {
      let status = zernioStatusRef.current;
      if (!status || !status.ok || !status.configured) {
        status = await fetchZernioStatus();
        zernioStatusRef.current = status;
        setShipStatus(status);
      }
      if (!status.configured) {
        throw new Error(
          status.error ??
            "ZERNIO_API_KEY fehlt — in Vercel setzen und neu deployen (siehe docs/ANLEITUNG.md)."
        );
      }
      if (status.accounts.length === 0) {
        throw new Error(
          "Zernio-Key ist gesetzt, aber kein Social-Account verbunden → zernio.com/dashboard → Accounts verbinden."
        );
      }

      while (pendingShipRef.current.length > 0) {
        if (cancelShipRef.current.cancelled) break;
        const entry = pendingShipRef.current.shift()!;
        /* Slot + Config hängen am Queue-Eintrag (Sendeplan-Dialog) und nicht
           mehr global am Panel — so bekommt jeder Post seinen eigenen Zeitpunkt. */
        const { slot, cfg } = entry;
        /* Wurde das Unit nach dem Einreihen neu gerendert, zählt die frische Blob-Version. */
        const fresher = itemsRef.current.find((i) => i.index === entry.item.index);
        const item = fresher?.status === "done" && fresher.blob ? fresher : entry.item;
        pushShipRun({ active: true, currentIndex: item.index });

        /* Pflicht-Pause: zwischen JEDEM Video exakt 3 Sekunden warten */
        if (dispatched > 0) {
          patchShip(item.index, { status: "waiting" });
          const cancelled = await shipGap(
            SHIP_GAP_MS,
            (ms) => pushShipRun({ waitMs: ms }),
            () => cancelShipRef.current.cancelled
          );
          pushShipRun({ waitMs: 0 });
          if (cancelled) {
            patchShip(item.index, { status: "idle", progress: 0 });
            break;
          }
        }

        dispatched += 1;

        patchShip(item.index, {
          status: "uploading",
          progress: 0,
          error: undefined,
          slotLabel: slot.label,
        });

        try {
          const result = await shipVideo(item, cfg, {
            slot,
            onStage: (stage) => patchShip(item.index, { status: stage }),
            onProgress: (ratio) => patchShip(item.index, { progress: ratio }),
          });
          patchShip(item.index, {
            status: "sent",
            progress: 1,
            postId: result.postId,
            zernioStatus: result.status,
            scheduledFor: result.scheduledFor,
            slotLabel: slot.label,
            sentAt: new Date().toISOString(),
            error: undefined,
          });
          setShipLog((prev) =>
            [
              {
                index: item.index,
                idea: item.idea,
                filename: shipFileName(item),
                slotLabel: slot.label,
                postId: result.postId,
                zernioStatus: result.status,
                at: new Date().toISOString(),
              },
              ...prev,
            ].slice(0, 30)
          );
        } catch (e) {
          patchShip(item.index, {
            status: "error",
            error: String(e instanceof Error ? e.message : e).slice(0, 220),
            slotLabel: slot.label,
          });
        }

        shipDoneRef.current += 1;
        pushShipRun({ currentIndex: item.index });
      }
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e).slice(0, 240);
      for (const queued of pendingShipRef.current) patchShip(queued.item.index, { status: "error", error: message });
      pendingShipRef.current = [];
      pushShipRun({ error: message });
    } finally {
      shipRunningRef.current = false;
      pushShipRun({
        active: false,
        currentIndex: null,
        waitMs: 0,
        pending: pendingShipRef.current.length,
      });
    }
  }, [patchShip, pushShipRun]);

  /**
   * Reiht Videos mit einem fertigen Sendeplan in die Warteschlange ein.
   * Der Plan (sofort · eigene Zeit · Queue · flexibel) kommt aus dem
   * Sendeplan-Dialog und wird hier EINMAL in konkrete Slots übersetzt —
   * inklusive Kollisionsprüfung gegen Slots, die schon in der Queue liegen.
   */
  const enqueueShip = useCallback(
    (targets: LocalRenderItem[], plan: ShipPlan): number => {
      const inFlight: ShipState["status"][] = ["queued", "uploading", "publishing", "waiting"];
      const ready = targets.filter((t) => t.status === "done" && t.blob);
      const fresh = ready.filter((t) => {
        if (pendingShipRef.current.some((queued) => queued.item.index === t.index)) return false;
        const state = shipStatesRef.current[t.index]?.status;
        return !state || !inFlight.includes(state);
      });
      if (fresh.length === 0) return 0;

      const cfg = shipCfgRef.current;
      const now = Date.now();
      /* Was in der Queue schon verplant ist: keine Doppelbuchung eines Slots,
         und „IN DIE QUEUE" reiht sich hinter den wartenden Queue-Plätzen ein. */
      const scheduled = pendingShipRef.current.filter((e) => e.slot.ms !== null);
      const taken = new Set(scheduled.map((e) => e.slot.ms as number));
      const queuedSlots = scheduled.filter((e) => e.via === "queue").length;
      const effectivePlan: ShipPlan =
        plan.kind === "queue" ? { ...plan, queueOffset: plan.queueOffset + queuedSlots } : plan;

      /* „EIGENE ZEITEN" wählt die Zeit über den Unit-Index, alles andere in Reihenfolge. */
      const byUnitIndex = effectivePlan.kind === "custom";
      const rawSlots = slotsForPlan(effectivePlan, cfg, byUnitIndex ? 10 : fresh.length, now);
      const stepMs =
        effectivePlan.kind === "series" || (effectivePlan.kind === "at" && fresh.length > 1)
          ? Math.max(1, effectivePlan.intervalMinutes) * 60_000
          : 5 * 60_000;
      const slots =
        effectivePlan.kind === "custom" || effectivePlan.kind === "now"
          ? rawSlots
          : avoidSlotCollisions(rawSlots, taken, stepMs);
      const batchCfg = configForPlan(effectivePlan, cfg);
      const sofort = { ms: null, wall: null, label: "SOFORT" } as const;

      const entries: ShipQueueEntry[] = fresh.map((item, position) => ({
        item,
        slot: (byUnitIndex ? slots[item.index] : slots[position]) ?? { ...sofort },
        cfg: batchCfg,
        via: effectivePlan.kind,
      }));

      cancelShipRef.current = { cancelled: false };
      for (const entry of entries) {
        patchShip(entry.item.index, {
          status: "queued",
          progress: 0,
          error: undefined,
          slotLabel: entry.slot.label,
          scheduledFor: entry.slot.wall ?? null,
        });
      }
      pendingShipRef.current.push(...entries);
      shipTotalRef.current += entries.length;
      pushShipRun({ active: true, error: null });
      void runShipQueue();
      return entries.length;
    },
    [patchShip, pushShipRun, runShipQueue]
  );

  /* ------------------------------------------------------------ */
  /*  Sendeplan-Dialog: Einzelversand UND „alle auf einmal"        */
  /* ------------------------------------------------------------ */

  /** Alle gerenderten Units, die noch nicht gesendet sind (sonst alle fertigen). */
  const shippableTargets = useCallback(
    () => {
      const done = itemsRef.current.filter((i) => i.status === "done" && i.blob);
      const notSent = done.filter((i) => shipStatesRef.current[i.index]?.status !== "sent");
      return notSent.length ? notSent : done;
    },
    []
  );

  /** „→ ZERNIO" an einer Unit-Karte / im Einzelversand → Dialog mit dem Sendeplan. */
  const shipOne = useCallback((index: number) => {
    const item = itemsRef.current.find((i) => i.index === index);
    if (!item || item.status !== "done" || !item.blob) return;
    setShipDialog({ scope: "single", indices: [index] });
  }, []);

  /** „Alle → Zernio" → derselbe Dialog, nur für den ganzen Stapel. */
  const shipAll = useCallback(() => {
    const targets = shippableTargets();
    if (targets.length === 0) return;
    setShipDialog({ scope: "batch", indices: targets.map((t) => t.index) });
  }, [shippableTargets]);

  /** Ein Klick, kein Dialog: ALLE auf einmal in die Queue (nächste freie Sendeplätze). */
  const shipAllToQueue = useCallback(() => {
    const targets = shippableTargets();
    if (targets.length === 0) return 0;
    /* bewusst immer `queue` — unabhängig davon, welcher Modus im Panel 06 steht */
    const plan: ShipPlan = {
      ...defaultPlanFor(shipCfgRef.current, "batch"),
      kind: "queue",
      queueOffset: 0,
    };
    return enqueueShip(targets, plan);
  }, [enqueueShip, shippableTargets]);

  /** Dialog bestätigt → Plan in die Queue, Entwurfs-Schalter ins Panel übernehmen. */
  const confirmShipPlan = useCallback(
    (plan: ShipPlan) => {
      const indices = shipDialog?.indices ?? [];
      const targets = itemsRef.current.filter((i) => indices.includes(i.index));
      setShipDialog(null);
      if (targets.length === 0) return;
      setShipCfg((cfg) => (cfg.asDraft === plan.asDraft ? cfg : { ...cfg, asDraft: plan.asDraft }));
      enqueueShip(targets, plan);
    },
    [enqueueShip, shipDialog]
  );

  const closeShipDialog = useCallback(() => setShipDialog(null), []);

  /** Dialog → „EIGENE ZEITEN" im Panel bearbeiten. */
  const editPanelTimes = useCallback(() => {
    setShipDialog(null);
    setShipCfg((cfg) => ({
      ...cfg,
      mode: "custom",
      customTimes: cfg.customTimes.length ? cfg.customTimes : fillCustomTimes(cfg.slotTimes, 10),
    }));
    window.requestAnimationFrame(() =>
      document.getElementById("ship-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, []);

  const cancelShip = useCallback(() => {
    cancelShipRef.current.cancelled = true;
    for (const queued of pendingShipRef.current) {
      patchShip(queued.item.index, { status: "idle", progress: 0, slotLabel: undefined });
    }
    pendingShipRef.current = [];
    pushShipRun({ pending: 0, waitMs: 0 });
  }, [patchShip, pushShipRun]);

  const doneCount = items.filter((r) => r.status === "done").length;
  const errorCount = items.filter((r) => r.status === "error").length;
  const stagedCount = items.filter((r) => r.status === "staged").length;
  const keyed = hasAnyLLMKey(settings);
  const renderProgress = (doneCount + errorCount + activeProgress) / 10;

  /** Die Units, für die der Sendeplan-Dialog gerade offen ist. */
  const shipDialogTargets = useMemo(
    () =>
      shipDialog
        ? shipDialog.indices
            .map((index) => items.find((i) => i.index === index))
            .filter((i): i is LocalRenderItem => Boolean(i && i.status === "done"))
        : [],
    [shipDialog, items]
  );

  /* ------------------------------------------------------------ */

  return (
    <div className="grain relative min-h-dvh bg-coal-950">
      <div className="bg-blueprint pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden">
        <div className="h-14 w-full animate-scan bg-gradient-to-b from-transparent via-ember-500/[0.10] to-transparent" />
      </div>
      <div className="animate-pulse-heat pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,138,31,0.16),transparent_68%)] blur-2xl" />

      <Header
        phase={phase}
        keyed={keyed}
        zernioReady={Boolean(shipStatus?.configured && shipStatus.accounts.length > 0)}
        onLock={onLock}
      />

      <main
        className="relative z-10 mx-auto max-w-[1500px] px-4 pb-16 sm:px-6"
        style={{ paddingBottom: busy ? "calc(6rem + env(safe-area-inset-bottom))" : undefined }}
      >
        {/* hero */}
        <div className="grid gap-6 pt-8 pb-6 sm:pt-10 sm:pb-8 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div className="animate-rise">
            <p className="mono-label mb-4 flex items-center gap-2 text-[10px] text-volt-400">
              <span className="inline-block size-1.5 animate-led rounded-full bg-volt-400 text-volt-400" />
              LINE STATUS: {busy ? "RUNNING" : phase === "staged" ? "LOADED — PRESS RENDER" : "ARMED"}
            </p>
            <h1 className="font-display text-[13vw] leading-[0.86] font-black tracking-[-0.03em] uppercase sm:text-7xl lg:text-[92px]">
              One clip in.
              <br />
              <span className="text-outline">Ten shorts</span>
              <span className="text-heat"> out.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-coal-300">
              Feed it one long background video — it gets sliced into ten different moments, each
              paired with its own AI story, neural voice and word-synced captions. Then you press
              render. Everything happens inside this browser.
            </p>
          </div>

          <div
            className="animate-rise space-y-px border border-coal-700 bg-coal-900/80"
            style={{ animationDelay: "120ms" }}
          >
            {[
              { icon: Cpu, k: "SCRIPT LINES", v: keyed ? "QWEN / MISTRAL · DIRECT" : "OFFLINE WRITER" },
              { icon: Mic, k: "VOICE BENCH", v: "EDGE READ-ALOUD · WEBSOCKET" },
              { icon: Captions, k: "CAPTION JIG", v: "WORD-BOUNDARY TIMINGS" },
              { icon: MessageSquare, k: "STORY INTRO", v: `REDDIT CARD · ${settings.introOn ? `${settings.introDuration.toFixed(1)} s` : "AUS"}` },
              { icon: Clapperboard, k: "RENDER MILL", v: "CANVAS + MEDIARECORDER" },
              { icon: FileArchive, k: "DISPATCH", v: "JSZIP → BLOB ANCHOR" },
              { icon: Rocket, k: "VERSAND", v: shipStatus?.configured ? "ZERNIO API · 3 s TAKT" : "ZERNIO · KEY FEHLT" },
            ].map(({ icon: Icon, k, v }) => (
              <div
                key={k}
                className="flex items-center justify-between gap-3 border-b border-coal-700/60 px-4 py-2.5 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="size-3.5 shrink-0 text-volt-400" />
                  <span className="mono-label text-[9px] text-coal-400">{k}</span>
                </div>
                <span className="text-right font-mono text-[9.5px] font-medium tracking-wider text-coal-200">
                  {v}
                </span>
              </div>
            ))}
            <div className="belt h-2 w-full opacity-60" />
          </div>
        </div>

        <div className="mb-6 flex items-start gap-2 text-coal-500">
          <ArrowDown className="mt-0.5 size-3.5 shrink-0" />
          <span className="mono-label text-[9px] leading-relaxed">
            TUNE 00 · IDEAS 01 · FOOTAGE 02 · MUSIC 03 — THEN PREPARE AND PRESS RENDER
          </span>
        </div>

        {/* Einleitung nach dem Deployen: was fehlt noch? (Panel „--“) */}
        <div className="mb-6">
          <SetupPanel
            gateStatus={gateStatus ?? null}
            zernioStatus={shipStatus}
            onOpenShipPanel={() =>
              document.getElementById("ship-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="grid content-start gap-5">
            <SettingsPanel settings={settings} onChange={setSettings} disabled={busy} />
            <IdeasPanel
              ideas={ideas}
              onChange={setIdeas}
              onGenerateAll={() => void generateAllIdeas()}
              onGenerateOne={(i) => void generateOneIdea(i)}
              generatingAll={ideaGenAll}
              generatingIndex={ideaGenIndex}
              aiLabel={
                keyed
                  ? "TAP AI ×10 TO LET QWEN / MISTRAL INVENT ALL TEN TITLES — OR ✨ ON A SINGLE ROW."
                  : "NO API KEY YET — AI ×10 USES THE BUILT-IN OFFLINE TITLE BUILDER. ADD A KEY UNDER 00 FOR REAL AI."
              }
              disabled={busy}
            />
          </div>
          <div className="grid content-start gap-5">
            <ClipMill
              mode={mode}
              onModeChange={setMode}
              source={source}
              clips={clips}
              fetchState={fetchState}
              linkValue={link}
              onLinkChange={setLink}
              onLoadLink={loadLink}
              onPickSource={(f) => void adoptSource(f, "file")}
              onClearSource={clearSource}
              onReslice={reslice}
              onRerollClip={reroll}
              bgs={bgs}
              onAddFiles={addBackgrounds}
              onRemoveFile={(id) => setBgs((prev) => prev.filter((b) => b.id !== id))}
              onClearFiles={() => setBgs([])}
              disabled={busy}
            />
            <MusicPanel
              tracks={tracks}
              onAdd={addTracks}
              onSelect={(id) =>
                setTracks((prev) => prev.map((t) => ({ ...t, selected: t.id === id })))
              }
              onRemove={(id) => setTracks((prev) => prev.filter((t) => t.id !== id))}
              disabled={busy}
            />
            <AssemblyPanel
              phase={phase}
              canPrepare={canPrepare}
              blockers={blockers}
              stagedCount={stagedCount}
              doneCount={doneCount}
              errorCount={errorCount}
              renderProgress={renderProgress}
              error={error}
              onPrepare={prepare}
              onRenderAll={renderAll}
              onCancel={cancel}
            />
          </div>
        </div>

        <div className="mt-5">
          <OutputPanel
            phase={phase}
            items={items}
            placeholderCount={10}
            zip={zip}
            elapsed={elapsed}
            activeIndex={activeIndex}
            activeProgress={activeProgress}
            onBuildZip={buildZip}
            onRenderOne={renderOne}
            onShipOne={shipOne}
            shipStates={shipStates}
            shipBusy={busy}
          />
        </div>

        <div className="mt-5" id="ship-panel">
          <ShipPanel
            cfg={shipCfg}
            onCfgChange={setShipCfg}
            status={shipStatus}
            statusLoading={statusLoading}
            onRefreshStatus={() => void refreshZernioStatus()}
            items={items}
            shipStates={shipStates}
            run={shipRun}
            onShipAll={shipAll}
            onShipAllToQueue={shipAllToQueue}
            onShipOne={shipOne}
            onCancelShip={cancelShip}
            log={shipLog}
            busy={busy}
          />
        </div>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-coal-700/70 pt-5 pb-[env(safe-area-inset-bottom)]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400">
              <HardDrive className="size-3.5 text-coal-500" /> FILES STAY ON-DEVICE
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400">
              <Radio className="size-3.5 text-coal-500" /> NATIVE TTS WEBSOCKET
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400">
              <Wifi className="size-3.5 text-coal-500" /> NETWORK ONLY FOR VOICE + AI
            </span>
            <span className="hidden items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400 sm:flex">
              <ShieldCheck className="size-3.5 text-coal-500" /> KEYS IN LOCALSTORAGE ONLY
            </span>
          </div>
          <p className="font-mono text-[9.5px] tracking-wider text-coal-500">
            SHORTSFACTORY v3 · CLIP MILL — NO FFMPEG · ZERNIO VERSAND · NO MERCY
          </p>
        </footer>
      </main>

      {/* Sendeplan-Dialog: ein Post (Output Bay / Einzelversand) oder alle auf einmal */}
      {shipDialog && shipDialogTargets.length > 0 && (
        <ShipDialog
          scope={shipDialog.scope}
          targets={shipDialogTargets}
          cfg={shipCfg}
          status={shipStatus}
          pendingScheduled={shipRun.pending}
          running={shipRun.active}
          onClose={closeShipDialog}
          onConfirm={confirmShipPlan}
          onEditPanelTimes={editPanelTimes}
        />
      )}

      {shipRun.active && !busy && (
        <div
          className="fixed bottom-4 left-1/2 z-40 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 border border-volt-400/50 bg-coal-950/95 px-4 py-2.5 shadow-[0_20px_60px_-30px_rgba(239,47,36,0.9)] backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-block size-1.5 animate-led rounded-full bg-volt-400 text-volt-400" />
              <span className="truncate font-mono text-[10px] font-bold tracking-[0.18em] text-volt-300">
                ZERNIO {shipRun.done}/{shipRun.total}
                {shipRun.currentIndex !== null
                  ? ` · UNIT ${String(shipRun.currentIndex + 1).padStart(2, "0")}`
                  : ""}
                {shipRun.waitMs > 0 ? ` · PAUSE ${(shipRun.waitMs / 1000).toFixed(1)}s` : ""}
              </span>
            </span>
            <button
              type="button"
              onClick={cancelShip}
              className="border border-coal-600 px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-300 hover:border-rose-err hover:text-rose-err"
            >
              STOP
            </button>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden bg-coal-800">
            <div
              className="h-full bg-volt-400 transition-[width] duration-300"
              style={{ width: `${shipRun.total ? (shipRun.done / shipRun.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {busy && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-ember-500/50 bg-coal-950/95"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          role="status"
          aria-live="polite"
        >
          <div
            className="h-1 bg-ember-500 transition-[width] duration-500 ease-out"
            style={{
              width:
                phase === "rendering"
                  ? `${Math.min(100, renderProgress * 100)}%`
                  : `${((doneCount + errorCount + stagedCount) / 10) * 100}%`,
            }}
          />
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-block size-1.5 animate-led rounded-full bg-ember-500 text-ember-500" />
              <span className="truncate font-mono text-[10px] font-bold tracking-[0.18em] text-ember-400">
                {phase === "preparing"
                  ? `PREPARING ${stagedCount + errorCount}/10`
                  : `RENDERING ${doneCount + errorCount}/10${
                      activeIndex !== null ? ` · UNIT ${String(activeIndex + 1).padStart(2, "0")}` : ""
                    }`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {phase === "rendering" && (
                <button
                  type="button"
                  onClick={cancel}
                  className="border border-coal-600 px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-300 hover:border-rose-err hover:text-rose-err"
                >
                  STOP
                </button>
              )}
              <span className="font-mono text-[10px] text-coal-300 tabular-nums">
                {formatClock(elapsed)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Onepage Passwort-Schutz (serverseitig, mit IP-Rate-Limit)          */
/*                                                                      */
/*  Ist auf dem Server `APP_PASSWORD` / `APP_PASSWORD_HASH` gesetzt      */
/*  (oder lokal `VITE_APP_PASSWORD_HASH`), rendert die App               */
/*  AUSSCHLIESSLICH die Passwort-Seite, bis das richtige Passwort        */
/*  eingegeben wurde. Die Fabrik dahinter wird gar nicht erst gemountet. */
/*  Geprüft wird über `/api/auth`, gesperrt wird pro IP. Das Token liegt  */
/*  nur im Arbeitsspeicher → jedes Neuladen verlangt das Passwort neu.    */
/*  Anleitung: docs/EINRICHTUNG.md                                      */
/* ------------------------------------------------------------------ */

/** Kurzer Splash, während der Gate-Status vom Server geholt wird. */
function GateBoot() {
  return (
    <div className="grain relative flex min-h-dvh flex-col items-center justify-center gap-4 bg-coal-950">
      <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-90" />
      <Loader2 className="size-5 animate-spin text-volt-400" />
      <p className="mono-label relative z-10 text-[9px] tracking-[0.22em] text-coal-400">
        SICHERHEITSPRÜFUNG LÄUFT…
      </p>
    </div>
  );
}

export default function App() {
  const [stage, setStage] = useState<"checking" | "locked" | "open">("checking");
  const [gateStatus, setGateStatus] = useState<GateStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchGateStatus().then((status) => {
      if (!alive) return;
      setGateStatus(status);
      setStage(!status.requirePassword || isUnlocked() ? "open" : "locked");
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleUnlock = useCallback(() => {
    setStage("open");
    /* Zähler der IP wurde serverseitig zurückgesetzt → Status neu ziehen. */
    void fetchGateStatus().then(setGateStatus);
  }, []);

  const handleLock = useCallback(() => {
    lockGate();
    setStage("locked");
    void fetchGateStatus().then(setGateStatus);
  }, []);

  /* Token abgelaufen (401 aus /api/zernio) → zurück zur Passwort-Seite. */
  useEffect(() => {
    const onExpired = () => {
      lockGate();
      setStage((current) => (current === "open" ? "locked" : current));
    };
    window.addEventListener(GATE_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(GATE_EXPIRED_EVENT, onExpired);
  }, []);

  if (stage === "checking") return <GateBoot />;
  if (stage === "locked") return <PasswordGate onUnlock={handleUnlock} />;
  return (
    <Factory
      onLock={gateStatus?.requirePassword ? handleLock : undefined}
      gateStatus={gateStatus}
    />
  );
}
