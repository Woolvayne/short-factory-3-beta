import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  Rocket,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";
import { humanizeMinutes, type GateStatus } from "../lib/gate";
import type { ZernioStatus } from "../lib/zernio";

/**
 * Einrichtungs-Assistent — erscheint direkt nach dem ersten Deploy oben in der
 * Fabrik und zeigt in Klartext, was noch fehlt:
 *
 *   1. Passwortschutz   → `APP_PASSWORD` (serverseitig, mit IP-Sperre)
 *   2. Zernio-Versand   → `ZERNIO_API_KEY`
 *   3. Rate-Limit-Store → optional Vercel KV, damit die IP-Sperre global gilt
 *   4. Sendezeiten      → Standard 06:00 / 20:00, frei anpassbar (Panel 06)
 *
 * Vollständige Anleitung mit Copy-&-Paste-Befehlen: docs/EINRICHTUNG.md
 */
export default function SetupPanel({
  gateStatus,
  zernioStatus,
  onOpenShipPanel,
}: {
  gateStatus: GateStatus | null;
  zernioStatus: ZernioStatus | null;
  onOpenShipPanel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const gateReady = Boolean(gateStatus?.requirePassword);
  const serverGate = gateStatus?.mode === "server";
  const kvReady = gateStatus?.store === "redis";
  const zernioReady = Boolean(zernioStatus?.configured);
  const accounts = zernioStatus?.accounts.length ?? 0;

  const steps = useMemo(
    () => [
      {
        id: "gate",
        ok: gateReady && serverGate,
        title: "PASSWORT-SCHUTZ",
        todo: "APP_PASSWORD in Vercel setzen",
        detail:
          gateReady && serverGate
            ? "Serverseitiges Gate aktiv — jedes Neuladen verlangt das Passwort neu."
            : gateReady
              ? "Nur lokaler Notbetrieb (kein /api/auth erreichbar) — bitte serverseitig setzen."
              : "Offen: jeder kann die Seite aufrufen. APP_PASSWORD fehlt.",
        command: 'npx vercel env add APP_PASSWORD production   # Wert eingeben, dann: vercel --prod',
      },
      {
        id: "rate",
        ok: Boolean(gateReady && gateStatus && gateStatus.maxAttempts > 0),
        title: "RATE LIMIT · IP-SPERRE",
        todo: "Standard aktiv, KV optional",
        detail: gateStatus
          ? `${gateStatus.maxAttempts} Fehlversuche → ${humanizeMinutes(
              gateStatus.schedule[0] ?? 5
            )} Sperre, danach eskalierend (${gateStatus.schedule
              .map((m) => humanizeMinutes(m))
              .join(" → ")}).`
          : "Zähler wird beim ersten Aufruf geladen.",
        command: "Fallback ohne KV: Sperre gilt pro Server-Instanz (funktioniert, ist aber nicht global).",
      },
      {
        id: "kv",
        ok: kvReady,
        title: "SPERRE GLOBAL (OPTIONAL)",
        todo: "Vercel KV / Upstash verbinden",
        detail: kvReady
          ? "Redis verbunden — die IP-Sperre greift über alle Instanzen."
          : "Aktuell In-Memory: bei mehreren warmen Instanzen kann die Sperre wackeln.",
        command:
          "Vercel → Storage → KV anlegen; KV_REST_API_URL + KV_REST_API_TOKEN landen automatisch im Projekt.",
      },
      {
        id: "zernio",
        ok: zernioReady && accounts > 0,
        title: "ZERNIO-VERSAND",
        todo: "ZERNIO_API_KEY + Social-Account",
        detail: !zernioReady
          ? "Kein Key gesetzt — Versand-Panel ist gesperrt."
          : accounts === 0
            ? "Key ok, aber kein Social-Account in Zernio verbunden."
            : `${accounts} Account(s) verbunden und sendebereit.`,
        command: "npx vercel env add ZERNIO_API_KEY production   # sk_… (ohne VITE_!)",
      },
    ],
    [gateReady, serverGate, kvReady, gateStatus, zernioReady, accounts]
  );

  const openSteps = steps.filter((s) => !s.ok && s.id !== "kv").length;
  const allGood = openSteps === 0;
  const maxAttempts = gateStatus?.maxAttempts ?? 5;
  const lockoutSchedule = gateStatus?.schedule?.length
    ? gateStatus.schedule
    : [5, 15, 60, 360, 1440];

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      /* Clipboard verweigert — kein Drama */
    }
  };

  return (
    <Section
      index="--"
      title="Einrichtung · nach dem Deploy"
      hint={allGood ? "ALLES EINGERICHTET" : `${openSteps} SCHRITT(E) OFFEN`}
      complete={allGood}
      aside={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {open ? "ZUKLAPPEN" : "ANLEITUNG"}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {steps.map((step) => (
          <span key={step.id} className="flex items-center gap-2">
            {step.ok ? (
              <BadgeCheck className="size-3.5 text-volt-400" />
            ) : (
              <TriangleAlert className="size-3.5 text-amber-warn" />
            )}
            <span className="mono-label text-[9.5px] text-coal-200">{step.title}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => void onOpenShipPanel?.()}
          className="mono-label text-[9.5px] text-volt-300 underline decoration-dotted hover:text-volt-200"
        >
          → SENDEZEITEN (06:00 / 20:00) IM PANEL 06
        </button>
      </div>

      {open && (
        <div className="mt-4 grid gap-3">
          <p className="border border-coal-700/80 bg-coal-950/50 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-coal-300">
            ANLEITUNG NACH DEM DEPLOYEN: Die Variablen unten in Vercel eintragen (Settings →
            Environment Variables) und danach <span className="text-volt-300">NEU DEPLOYEN</span> —
            Environment-Variablen werden beim Build bzw. beim Start der Function gelesen. Ohne
            <span className="text-volt-300"> APP_PASSWORD</span> ist die Seite offen, ohne
            <span className="text-volt-300"> ZERNIO_API_KEY</span> geht kein Versand raus.
            Ausführlich mit Screenshots-Schritten:{" "}
            <span className="text-volt-300">docs/EINRICHTUNG.md</span>
          </p>

          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "border px-3 py-2.5",
                step.ok ? "border-volt-400/40 bg-volt-400/5" : "border-amber-warn/40 bg-amber-warn/5"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {step.ok ? (
                    <BadgeCheck className="size-3.5 shrink-0 text-volt-400" />
                  ) : (
                    <TriangleAlert className="size-3.5 shrink-0 text-amber-warn" />
                  )}
                  <span className="font-mono text-[10px] font-bold tracking-widest text-paper-100">
                    {step.title}
                  </span>
                  <span className="mono-label text-[9px] text-coal-400">{step.todo}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void copy(step.id, step.command)}
                  className="flex items-center gap-1.5 border border-coal-600 px-2 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300"
                >
                  {copied === step.id ? (
                    <>
                      <BadgeCheck className="size-3" /> KOPIERT
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" /> BEFEHL
                    </>
                  )}
                </button>
              </div>
              <p className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-coal-300">
                {step.detail}
              </p>
              <p className="mt-1.5 overflow-x-auto border border-coal-800 bg-coal-950/70 px-2 py-1.5 font-mono text-[9.5px] whitespace-pre text-volt-300">
                {step.command}
              </p>
            </div>
          ))}

          <div className="grid gap-2 border border-coal-700/80 bg-coal-850/60 px-3 py-2.5 sm:grid-cols-2">
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              PASSWORT WECHSELN: neuen Wert in Vercel setzen → Redeploy (ohne Build-Cache). Sperren
              laufen dann so: {maxAttempts} VERSUCHE →{" "}
              {lockoutSchedule.map((m) => humanizeMinutes(m)).join(" → ")}.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              ZERNIO-BEFEHLE: `npx vercel env add ZERNIO_API_KEY production` · danach Panel 06 prüfen
              (Button <span className="text-volt-300">API</span>).
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <ServerCog className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              KEIN VERCEL? `npm run build` → `dist/` ist eine einzige HTML-Datei. Gate + Rate-Limit
              brauchen aber `/api/auth`, also Vercel (oder Netlify Functions) nutzen.
            </p>
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300">
              <Rocket className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
              SENDEZEITEN: Panel 06 → <span className="text-volt-300">06 &amp; 20 UHR</span>{" "}
              (Standard), <span className="text-volt-300">EIGENE ZEIT</span> pro Video oder{" "}
              <span className="text-volt-300">FLEXIBEL</span> mit Abstand.
            </p>
          </div>

          <p className="flex items-start gap-2 font-mono text-[9px] leading-relaxed text-coal-500">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            SICHERHEITSHINWEIS: Das Gate ist ein Sichtschutz plus serverseitige Sperre — kein
            Bank-Login. Nimm ein langes Passwort und (empfohlen) den KV-Store, damit die IP-Sperre
            global greift.
          </p>
        </div>
      )}
    </Section>
  );
}
