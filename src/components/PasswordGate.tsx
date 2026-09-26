import { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Factory,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  fetchGateStatus,
  formatCountdown,
  gateInfo,
  humanizeMinutes,
  unlock,
  type GateStatus,
} from "../lib/gate";

/**
 * The one-page password screen. It is the ONLY thing that renders until the
 * visitor types the correct password.
 *
 * Prüfung + Sperre laufen serverseitig (`/api/auth`): Nach `maxAttempts`
 * Fehlversuchen in Folge wird die **IP** gesperrt — mit eskalierenden
 * Sperrzeiten. Das Token liegt danach nur im Arbeitsspeicher, ein Neuladen
 * der Seite verlangt also wieder das Passwort.
 */
export default function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(false);
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const info = gateInfo(status);

  const refresh = useCallback(async () => {
    const next = await fetchGateStatus();
    setStatus(next);
    setBooting(false);
    return next;
  }, []);

  useEffect(() => {
    void refresh().then(() => inputRef.current?.focus());
  }, [refresh]);

  const locked = Boolean(status?.locked);
  const lockoutLeft = status ? Math.max(0, (status.lockedUntil ?? 0) - now) / 1000 : 0;

  /* Live-Countdown während einer Sperre + automatischer Re-Check danach. */
  useEffect(() => {
    if (!locked) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [locked]);

  useEffect(() => {
    if (!locked || !status?.lockedUntil) return;
    if (status.lockedUntil > now) return;
    void refresh();
  }, [locked, status?.lockedUntil, now, refresh]);

  const flash = () => {
    setShake(true);
    window.setTimeout(() => setShake(false), 500);
  };

  const submit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (checking || locked) return;
      if (!value) {
        setError("BITTE PASSWORT EINGEBEN.");
        flash();
        return;
      }
      setChecking(true);
      setError(null);
      try {
        const result = await unlock(value);
        if (result.ok) {
          setValue("");
          setStatus((prev) => (prev ? { ...prev, locked: false, retryAfterSeconds: 0 } : prev));
          onUnlock();
          return;
        }
        setStatus(result.status);
        setError(result.message.toUpperCase());
        setValue("");
        flash();
        inputRef.current?.focus();
      } catch (e) {
        flash();
        setError(e instanceof Error ? e.message.toUpperCase() : "PRÜFUNG FEHLGESCHLAGEN");
      } finally {
        setChecking(false);
      }
    },
    [checking, locked, value, onUnlock]
  );

  const maxAttempts = status?.maxAttempts ?? 5;
  const schedule = status?.schedule ?? [5, 15, 60, 360, 1440];
  const nextLock = status ? humanizeMinutes(status.nextLockoutMinutes) : "5 min";

  return (
    <div className="grain relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-coal-950 px-4 py-10">
      <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-90" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden">
        <div className="h-14 w-full animate-scan bg-gradient-to-b from-transparent via-ember-500/[0.10] to-transparent" />
      </div>
      <div className="animate-pulse-heat pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,138,31,0.18),transparent_68%)] blur-2xl" />

      <div className="relative z-10 w-full max-w-[470px]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="bg-heat grid size-11 shrink-0 place-items-center text-coal-950 shadow-[0_0_28px_-4px_var(--color-ember-500)]">
            <Factory className="size-6" strokeWidth={2.2} />
          </div>
          <div className="leading-none">
            <div className="font-display text-lg font-black tracking-tight">
              SHORTS<span className="text-heat">FACTORY</span>
            </div>
            <div className="mono-label mt-1.5 text-[9px] text-coal-400">
              LOCAL VIDEO ASSEMBLY · v3
            </div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className={cn("card-bracket border border-coal-700 p-6 sm:p-7", shake && "animate-shake")}
        >
          <div className="mb-5 flex items-center gap-2.5">
            <Lock className="size-4 shrink-0 text-volt-400" />
            <h1 className="font-display text-sm font-black tracking-[0.14em] text-paper-100 uppercase">
              Zugang geschützt
            </h1>
          </div>
          <p className="mb-6 font-mono text-[11px] leading-relaxed text-coal-300">
            Diese Fabrik ist privat. Das Passwort wird auf dem Server geprüft
            {status?.mode === "server" ? (
              <>
                {" "}
                — nach <span className="text-volt-300">{maxAttempts} Fehlversuchen</span> wird die IP
                gesperrt.
              </>
            ) : (
              "."
            )}
          </p>

          <label className="block">
            <span className="mono-label mb-1.5 block text-[9px] text-coal-400">PASSWORT</span>
            <span
              className={cn(
                "flex items-stretch border bg-coal-850 transition-colors focus-within:border-volt-400/70",
                error || locked ? "border-rose-err/70" : "border-coal-600"
              )}
            >
              <span className="grid w-11 place-items-center border-r border-coal-700 text-coal-400">
                <KeyRound className="size-3.5" />
              </span>
              <input
                ref={inputRef}
                type={show ? "text" : "password"}
                value={value}
                disabled={checking || booting || locked}
                onChange={(e) => setValue(e.target.value)}
                placeholder={booting ? "prüfe Sperre…" : "••••••••••"}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-[13px] tracking-wider text-paper-100 placeholder:text-coal-600 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="grid w-11 place-items-center border-l border-coal-700 text-coal-400 hover:text-volt-300"
                aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"}
              >
                {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </span>
          </label>

          <div className="mt-3 flex items-start gap-2 border border-coal-700/80 bg-coal-850/70 px-3 py-2">
            <RefreshCw className="mt-0.5 size-3 shrink-0 text-coal-400" />
            <p className="font-mono text-[9px] leading-relaxed tracking-wider text-coal-400">
              AUS SICHERHEITSGRÜNDEN WIRD DAS PASSWORT BEI <span className="text-volt-300">JEDEM
              NEULADEN</span> ERNEUT VERLANGT — DAS TOKEN LIEGT NUR IM ARBEITSSPEICHER DIESES TABS
              (KEIN LOCALSTORAGE, KEIN COOKIE).
            </p>
          </div>

          {locked && status && (
            <div className="mt-4 flex items-start gap-2 border border-rose-err/60 bg-rose-err/10 px-3 py-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
              <div className="font-mono text-[10.5px] leading-relaxed text-rose-err">
                <p className="font-bold tracking-wider">IP GESPERRT</p>
                <p className="mt-1 text-paper-100">
                  FREI IN <span className="tabular-nums">{formatCountdown(lockoutLeft)}</span>
                </p>
                <p className="mt-1 text-coal-300">
                  {maxAttempts} FEHLVERSUCHE IN FOLGE → {humanizeMinutes(status.nextLockoutMinutes)}{" "}
                  SPERRE. JEDE WEITERE SPERRE WIRD LÄNGER (
                  {schedule.map((m) => humanizeMinutes(m)).join(" → ")}).
                </p>
                {status.store === "memory" && (
                  <p className="mt-1 text-amber-warn">
                    HINWEIS: OHNE VERCEL KV GILT DIE SPERRE PRO SERVER-INSTANZ — GLOBAL WIRD ES MIT
                    KV_REST_API_URL/_TOKEN (SIEHE docs/EINRICHTUNG.md).
                  </p>
                )}
              </div>
            </div>
          )}

          {error && !locked && (
            <div className="mt-4 flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
              <p className="font-mono text-[10.5px] leading-relaxed text-rose-err">
                {error}
                {status && status.mode === "server" && (
                  <span className="mt-1 block text-coal-200">
                    NOCH {status.attemptsLeft} VON {maxAttempts} VERSUCHEN — DANN {nextLock} SPERRE.
                  </span>
                )}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={checking || booting || locked}
            className={cn(
              "glow-volt bg-heat mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 border border-volt-400 font-display text-base font-black tracking-tight text-coal-950 uppercase disabled:opacity-60",
              !checking && !booting && !locked && "hover:opacity-95"
            )}
          >
            {booting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> PRÜFE SPERRE…
              </>
            ) : checking ? (
              "PRÜFE…"
            ) : locked ? (
              `GESPERRT · ${formatCountdown(lockoutLeft)}`
            ) : (
              "Fabrik entsperren"
            )}
          </button>

          <div className="mt-5 flex items-start gap-2 border border-coal-700/70 bg-coal-950/40 px-3 py-2.5">
            {status?.mode === "server" ? (
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-volt-300" />
            ) : (
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-warn" />
            )}
            <p className="font-mono text-[9.5px] leading-relaxed text-coal-400">
              {booting ? "Status wird geprüft…" : info.hint} Passwort ändern: Environment-Variable in
              Vercel anpassen → neu deployen. Schritt für Schritt:{" "}
              <span className="text-volt-300">docs/EINRICHTUNG.md</span>
              {status?.mode === "server" && status.store === "memory" && (
                <span className="mt-1 block text-coal-500">
                  SPERREN GELTEN AKTUELL PRO INSTANZ — MIT VERCEL KV GLOBAL (OPTIONAL, EMPFOHLEN).
                </span>
              )}
            </p>
          </div>
        </form>

        <p className="mt-5 text-center font-mono text-[9px] tracking-[0.18em] text-coal-500">
          KEIN TRACKING · DEINE DATEIEN BLEIBEN AUF DEM GERÄT · {maxAttempts} VERSUCHE PRO IP
        </p>
      </div>
    </div>
  );
}
