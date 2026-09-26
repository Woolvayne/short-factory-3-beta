#!/usr/bin/env node
/**
 * Passwort-Hash für den Onepage-Schutz erzeugen — ohne Backend, ohne Datenbank.
 *
 *   npm run password:hash -- "meinPasswort"
 *   npm run password:hash            (interaktiv, Eingabe bleibt unsichtbar)
 *
 * Ausgabe: der SHA-256-Hash für APP_PASSWORD_HASH plus die fertigen Kommandos
 * für Vercel (Dashboard + CLI) und für die lokale .env.local.
 * Empfohlen ist allerdings `APP_PASSWORD` (Klartext, nur serverseitig) — auch
 * dieser Befehl erklärt das in seiner Ausgabe. Das Gate prüft in beiden Fällen
 * serverseitig (api/auth.js) und sperrt nach 5 Fehlversuchen die IP.
 * Anleitung: docs/EINRICHTUNG.md · docs/ANLEITUNG.md
 */

import crypto from "node:crypto";
import readline from "node:readline";

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

const askHidden = (question) =>
  new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const plain = readline.createInterface({ input: stdin, output: process.stdout });
      plain.question(question, (answer) => {
        plain.close();
        resolve(answer);
      });
      return;
    }
    const rl = readline.createInterface({ input: stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    let value = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl+C
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
      // overwrite whatever echo the terminal produced
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question + "•".repeat(value.length));
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });

const line = (text = "") => process.stdout.write(text + "\n");

const password = process.argv.slice(2).join(" ").trim() || (await askHidden("Passwort: ")).trim();

if (!password) {
  line("\n✖ Kein Passwort übergeben. Beispiel:  npm run password:hash -- \"meinPasswort\"");
  process.exit(1);
}

const hash = sha256(password);

line("");
line("┌─ SHORTSFACTORY · PASSWORT-SCHUTZ ────────────────────────────────");
line(`│ Passwort-Länge : ${password.length} Zeichen`);
line(`│ SHA-256        : ${hash}`);
line("└──────────────────────────────────────────────────────────────────");
line("");
line("1) VERCEL (Dashboard) — empfohlen: Klartext, nur serverseitig");
line("   Projekt → Settings → Environment Variables → Add");
line("     Name : APP_PASSWORD");
line(`     Value: (das Passwort selbst, NICHT der Hash)`);
line("     Environments: Production + Preview (+ Development, falls gewünscht)");
line("");
line("   Alternative mit Hash statt Klartext:");
line("     Name : APP_PASSWORD_HASH");
line(`     Value: ${hash}`);
line("   Beide Varianten wirken gleich — der Hash liegt nur nicht im Klartext vor.");
line("");
line("   Zwingend danach REDEPLOYEN (Deployments → ⋯ → Redeploy ohne Build-Cache).");
line("   Rate Limit ist automatisch aktiv: 5 Fehlversuche pro IP → 5 min, dann");
line("   15 min, 1 h, 6 h, 24 h. Anpassen: APP_MAX_ATTEMPTS, APP_LOCKOUT_MINUTES.");
line("");
line("2) VERCEL (CLI, alternativ)");
line(`   npx vercel env add APP_PASSWORD_HASH production <<< "${hash}"`);
line(`   npx vercel env add APP_PASSWORD_HASH preview    <<< "${hash}"`);
line(`   # oder direkt das Passwort:  npx vercel env add APP_PASSWORD production`);
line("");
line("3) LOKAL (optional, .env.local — steht in .gitignore)");
line(`   echo 'APP_PASSWORD_HASH=${hash}' >> .env.local`);
line("   Danach `npx vercel dev` starten (führt /api/auth wirklich aus).");
line("");
line("Hinweis: Geprüft wird serverseitig in api/auth.js (timing-safe). Nach 5");
line("Fehlversuchen in Folge wird die IP gesperrt — eskalierend bis 24 h. Das");
line("Sitzungs-Token liegt nur im Arbeitsspeicher des Tabs: Nach jedem Neuladen");
line("wird das Passwort erneut verlangt. Global gilt die Sperre mit Vercel KV.");
line("");
