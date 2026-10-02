/**
 * ASS subtitle builder — burns word-synced captions (and a simplified
 * Reddit-intro card) into the video via ffmpeg's `subtitles` filter.
 *
 * Mirrors the browser renderer's caption behaviour: WordBoundary
 * timestamps grouped into N-word cues, bold uppercase text with a heavy
 * outline, positioned at `captionY` of the frame height.
 */

const assTime = (s) => {
  const t = Math.max(0, s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

/** "#rrggbb" → ASS "&HAABBGGRR" (AA = 00 opaque). */
function assColor(hex, alpha = "00") {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  const rgb = m ? m[1] : "ffffff";
  const r = rgb.slice(0, 2);
  const g = rgb.slice(2, 4);
  const b = rgb.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

const escText = (s) =>
  String(s).replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");

/** Group WordBoundary timestamps into cues of `wordsPerCue` words. */
export function buildCues(words, wordsPerCue = 3) {
  const cues = [];
  for (let i = 0; i < words.length; i += wordsPerCue) {
    const group = words.slice(i, i + wordsPerCue);
    const start = group[0].offset;
    const last = group[group.length - 1];
    const next = words[i + wordsPerCue];
    const end = next ? next.offset : last.offset + Math.max(0.35, last.duration + 0.25);
    cues.push({ start, end, text: group.map((w) => w.text).join(" ") });
  }
  return cues;
}

function wrapTitle(title, maxChars = 26, maxLines = 4) {
  const words = String(title).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, " …");
  }
  return lines;
}

const fmtUpvotes = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

/** ASS vector path for a small circular, embedded Reddit/Snoo avatar. */
function vectorCircle(cx, cy, radius, segments = 18) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    points.push(`${Math.round(cx + Math.cos(angle) * radius)} ${Math.round(cy + Math.sin(angle) * radius)}`);
  }
  return `m ${points[0]} l ${points.slice(1).join(" ")} ${points[0]}`;
}

/**
 * Build the complete .ass document.
 *
 * opts: {
 *   width, height,
 *   captionsOn, wordsPerCue, captionScale, captionY, captionColor,
 *   outlineWidth, uppercase, captionShadow,
 *   intro: null | { title, subreddit, author, ageLabel, upvotes, duration, theme, posY, showStats }
 * }
 */
export function buildAss(words, opts) {
  const W = opts.width;
  const H = opts.height;
  const fontSize = Math.round((opts.captionScale ?? 0.074) * W * 1.06);
  const outline = Math.max(0, Math.round((opts.outlineWidth ?? 0.16) * fontSize));
  const shadow = opts.captionShadow ? Math.max(2, Math.round(fontSize * 0.06)) : 0;
  const marginV = Math.round(H * (1 - (opts.captionY ?? 0.6)) - fontSize / 2);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,DejaVu Sans,${fontSize},${assColor(opts.captionColor ?? "#ffffff")},&H000000FF,&H00000000,&H7F000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,${Math.round(W * 0.06)},${Math.round(W * 0.06)},${Math.max(10, marginV)},1`,
    `Style: IntroMeta,DejaVu Sans,${Math.round(W * 0.032)},&H00E6E6E6,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: IntroTitle,DejaVu Sans,${Math.round(W * 0.052)},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: IntroStats,DejaVu Sans,${Math.round(W * 0.03)},&H00B4B4B4,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Card,DejaVu Sans,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = [];

  /* ---- simplified Reddit intro card (first N seconds) ---- */
  if (opts.intro) {
    const it = opts.intro;
    const dur = Math.max(1, Math.min(8, it.duration ?? 3));
    const dark = (it.theme ?? "dark") !== "light";
    const cardBg = dark ? "\\1c&H1B1A1A&" : "\\1c&HFFFFFF&"; // BGR
    const metaCol = dark ? "\\1c&HC8C8C8&" : "\\1c&H575757&";
    const titleCol = dark ? "\\1c&HFFFFFF&" : "\\1c&H1B1A1A&";
    const statsCol = dark ? "\\1c&HB4B4B4&" : "\\1c&H6E6E6E&";

    const pad = Math.round(W * 0.055);
    const cardX = Math.round(W * 0.07);
    const cardW = W - cardX * 2;
    const metaSize = Math.round(W * 0.032);
    const titleSize = Math.round(W * 0.052);
    const lineH = Math.round(titleSize * 1.32);
    const lines = wrapTitle(it.title || "Untitled story", 26, 4);
    const avatarR = Math.round(W * 0.031);
    const headerH = Math.max(Math.round(metaSize * 1.7), avatarR * 2);
    const statsH = it.showStats === false ? 0 : Math.round(W * 0.03 * 1.9);
    const cardH = pad * 2 + headerH + lines.length * lineH + statsH;
    const cardY = Math.round(H * (it.posY ?? 0.36) - cardH / 2);

    const t0 = "0:00:00.00";
    const t1 = assTime(dur);
    const fad = "\\fad(220,260)";

    // backdrop dim + card rectangle (ASS vector drawing)
    events.push(
      `Dialogue: 0,${t0},${t1},Card,,0,0,0,,{\\an7\\pos(0,0)\\1c&H000000&\\1a&H73&\\bord0\\shad0${fad}\\p1}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`
    );
    events.push(
      `Dialogue: 1,${t0},${t1},Card,,0,0,0,,{\\an7\\pos(${cardX},${cardY})${cardBg}\\1a&H14&\\bord0\\shad4\\4a&H96&${fad}\\p1}m 0 0 l ${cardW} 0 ${cardW} ${cardH} 0 ${cardH}{\\p0}`
    );

    const textX = cardX + pad;
    const avatarCx = textX + avatarR;
    const avatarCy = cardY + pad + avatarR;
    const metaX = avatarCx + avatarR + Math.round(W * 0.02);
    let y = cardY + pad;

    /* A vector-drawn Snoo-style profile image keeps the card self-contained:
       ffmpeg never needs to fetch an external Reddit asset. */
    events.push(
      `Dialogue: 2,${t0},${t1},Card,,0,0,0,,{\\an7\\pos(0,0)\\1c&H000045FF&\\1a&H00\\bord0\\shad0${fad}\\p1}${vectorCircle(avatarCx, avatarCy, avatarR)}{\\p0}`
    );
    events.push(
      `Dialogue: 2,${t0},${t1},Card,,0,0,0,,{\\an7\\pos(0,0)\\1c&H00FFFFFF&\\1a&H00\\bord0\\shad0${fad}\\p1}${vectorCircle(avatarCx, avatarCy + Math.round(avatarR * 0.05), Math.round(avatarR * 0.58))}{\\p0}`
    );
    events.push(
      `Dialogue: 2,${t0},${t1},Card,,0,0,0,,{\\an7\\pos(0,0)\\1c&H001B1A1A&\\1a&H00\\bord0\\shad0${fad}\\p1}${vectorCircle(avatarCx - Math.round(avatarR * 0.2), avatarCy, Math.max(1, Math.round(avatarR * 0.1)))}${vectorCircle(avatarCx + Math.round(avatarR * 0.2), avatarCy, Math.max(1, Math.round(avatarR * 0.1)))}{\\p0}`
    );

    const author = it.author || "u/anon";
    const meta = `${author}  ·  ${it.subreddit || "r/stories"}  ·  ${it.ageLabel || "12h"}`;
    events.push(
      `Dialogue: 2,${t0},${t1},IntroMeta,,0,0,0,,{\\an7\\pos(${metaX},${y})${metaCol}\\bord0\\shad0${fad}}${escText(meta)}`
    );
    y += headerH;
    for (const [i, ln] of lines.entries()) {
      events.push(
        `Dialogue: 2,${t0},${t1},IntroTitle,,0,0,0,,{\\an7\\pos(${textX},${y + i * lineH})${titleCol}\\bord0\\shad0\\fad(${260 + i * 90},260)}${escText(ln)}`
      );
    }
    if (it.showStats !== false) {
      y += lines.length * lineH + Math.round(W * 0.012);
      const stats = `▲ ${fmtUpvotes(it.upvotes ?? 15400)}   ·   ${fmtUpvotes(Math.round((it.upvotes ?? 15400) / 12))} comments   ·   share`;
      events.push(
        `Dialogue: 2,${t0},${t1},IntroStats,,0,0,0,,{\\an7\\pos(${textX},${y})${statsCol}\\bord0\\shad0${fad}}${escText(stats)}`
      );
    }
  }

  /* ---- word-synced captions ---- */
  if (opts.captionsOn !== false && Array.isArray(words) && words.length > 0) {
    const introEnd = opts.intro ? Math.max(0, Math.min(8, opts.intro.duration ?? 3)) : 0;
    for (const cue of buildCues(words, opts.wordsPerCue ?? 3)) {
      if (cue.end <= introEnd) continue; // card covers the screen — skip
      const start = Math.max(cue.start, introEnd);
      const text = opts.uppercase === false ? cue.text : cue.text.toUpperCase();
      events.push(`Dialogue: 3,${assTime(start)},${assTime(cue.end)},Cap,,0,0,0,,${escText(text)}`);
    }
  }

  return header.concat(events).join("\n") + "\n";
}
