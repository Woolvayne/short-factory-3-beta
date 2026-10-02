/**
 * Story engine (server port of src/lib/llm.ts) — Qwen (DashScope
 * compatible-mode) or Mistral when a key is available, otherwise the
 * built-in offline template writer. Keys can come per-job (payload) or
 * from the environment (QWEN_API_KEY / MISTRAL_API_KEY).
 */

const QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

export function styleInstruction(style, customPrompt = "") {
  switch (style) {
    case "revenge":
      return "Sub-genre: petty revenge. A slow-burn setup where the narrator quietly gets even, ending on a satisfying punchline.";
    case "confession":
      return "Sub-genre: raw confession. The narrator admits something they have kept secret, honest and a little uncomfortable.";
    case "creepy":
      return "Sub-genre: unsettling true-ish encounter. Build tension steadily, keep it grounded and eerie, no gore.";
    case "wholesome":
      return "Sub-genre: wholesome. Something small and human that turns out unexpectedly kind, warm ending.";
    case "workplace":
      return "Sub-genre: workplace chaos. Bosses, coworkers, malicious compliance, corporate absurdity.";
    case "custom":
      return (customPrompt || "").trim() || "Sub-genre: general viral Reddit story.";
    case "aita":
    default:
      return "Sub-genre: AITA. Present a moral dilemma and end by asking the internet to judge.";
  }
}

/**
 * Keep the card title and the spoken hook in lockstep. Agent jobs may send a
 * separate title with a full script; legacy jobs use the idea as both.
 */
export function introTitleFor(unit, settings = {}) {
  if (settings.introTitleMode === "custom" && String(settings.introTitle || "").trim()) {
    return String(settings.introTitle).trim();
  }
  return String(unit?.title || unit?.idea || "Reddit Story").replace(/\s+/g, " ").trim() || "Reddit Story";
}

/** The first spoken sentence is exactly the title shown on the intro card. */
export function narrationFor(unit, settings = {}) {
  const story = String(unit?.story || "").replace(/\s+/g, " ").trim();
  if (settings.introOn === false || !story) return story;
  const title = introTitleFor(unit, settings);
  const spokenTitle = /[.!?…]$/.test(title) ? title : `${title}.`;
  return `${spokenTitle} ${story}`.trim();
}

const buildSystem = (cfg) =>
  [
    "You write viral first-person Reddit stories.",
    cfg.styleInstruction,
    `Rules: about ${Math.max(80, Math.round(cfg.words))} words (±20). First person. English only.`,
    "Start mid-action with a punchy hook sentence. Escalate fast, land a satisfying twist or kicker.",
    "Plain spoken language — it will be read aloud by a text-to-speech voice.",
    "Return ONLY the story text. No title, no wrapping quotation marks, no 'EDIT:', no hashtags, no emojis.",
  ].join(" ");

async function callChat(provider, url, model, apiKey, idea, cfg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: cfg.temperature,
        max_tokens: Math.min(1200, Math.round(cfg.words * 3.2) + 200),
        messages: [
          { role: "system", content: buildSystem(cfg) },
          {
            role: "user",
            content: `Story premise: ${idea}\n\nWrite the story now (~${Math.round(cfg.words)} words, first person).`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${provider} returned an empty story`);
    return text.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * cfg: { qwenKey, mistralKey, words, temperature, styleInstruction }
 * → { text, provider: "qwen" | "mistral" | "offline" }
 */
export async function generateStory(idea, cfg) {
  const order = [
    { provider: "qwen", url: QWEN_URL, model: "qwen-turbo", key: (cfg.qwenKey || "").trim() },
    { provider: "mistral", url: MISTRAL_URL, model: "mistral-small-latest", key: (cfg.mistralKey || "").trim() },
  ];
  for (const p of order) {
    if (!p.key) continue;
    try {
      return { text: await callChat(p.provider, p.url, p.model, p.key, idea, cfg), provider: p.provider };
    } catch (e) {
      console.warn(`stories: ${p.provider} failed (${e?.message ?? e}), trying next`);
    }
  }
  return { text: offlineStory(idea, cfg.words), provider: "offline" };
}

/* ------------------------------------------------------------------ */
/*  offline idea + template writer (mirrors src/lib/llm.ts)             */
/* ------------------------------------------------------------------ */

const WHO = [
  "my roommate", "my landlord", "my boss", "my sister", "my neighbour",
  "my coworker", "my gym buddy", "my barista", "my father-in-law", "my best friend",
  "the guy in 4B", "my group project partner", "my dog walker", "my ex",
];
const WHAT = [
  "kept stealing my labelled food",
  "secretly moved into the building's storage room",
  "took credit for a project I built alone",
  "announced huge news at my celebration",
  "trained the local birds to visit only their window",
  "started a passive-aggressive sticky-note war",
  "parked stranger and stranger vehicles in my spot",
  "rewrote the shared calendar to erase my shifts",
  "borrowed my car and returned it detailed and full of glitter",
  "kept scheduling meetings during my lunch on purpose",
  "adopted my old hobby and got weirdly competitive about it",
  "left cryptic notes that turned out to be predictions",
];
const TWIST = [
  "so I fought back in the pettiest way possible",
  "and the security footage told a very different story",
  "until the whole building got involved",
  "and HR called my bluff within an hour",
  "so I documented everything for three months",
  "and then the truth came out at the worst moment",
  "and I have zero regrets about what happened next",
  "until one small detail unravelled everything",
];

export function offlineIdea(existing = []) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const idea = `${pick(WHO)} ${pick(WHAT)}, ${pick(TWIST)}`;
    const sentence = idea.charAt(0).toUpperCase() + idea.slice(1);
    if (!existing.includes(sentence)) return sentence;
  }
  return `${pick(WHO)} ${pick(WHAT)}, ${pick(TWIST)} (${existing.length + 1})`;
}

const HOOKS = [
  "This actually happened and I still cannot fully believe it.",
  "I need to get this off my chest before I explode.",
  "People keep telling me I should post this story, so here goes.",
  "I never thought I would be the person writing one of these.",
  "Grab a snack, because this one is absolutely unhinged.",
  "Three days ago my life was completely normal. Then this happened.",
];

const ESCALATIONS = [
  "At first I tried to be the reasonable one and just let it slide, but every single day it got a little bit worse.",
  "I gave them so many chances to stop, and every time they just smiled and kept going like nothing was wrong.",
  "Everyone around me said I was overreacting, which honestly made me even angrier about the whole situation.",
  "I started documenting everything in a notes app, because I knew nobody would believe me otherwise.",
  "The petty part of me took over at this point, and I decided that two could play this exact game.",
  "Word started spreading, and suddenly other people began telling me I was not the only victim here.",
  "I lost sleep over it, rehearsing arguments in the shower, which is embarrassing to admit out loud.",
  "The situation escalated way past anything I had planned, and frankly I stopped feeling guilty about it.",
];

const TWISTS = [
  "And then came the twist I never saw coming in a million years.",
  "But here is the part that made my jaw hit the actual floor.",
  "That is when everything flipped upside down in the best possible way.",
  "And just when I thought it could not get any stranger, it absolutely did.",
];

const KICKERS = [
  "So tell me, internet, was I out of line here, or was this completely justified?",
  "Anyway, that is where we stand now. Petty? Maybe. Worth it? Absolutely.",
  "I am not saying I am proud of everything, but I would honestly do it again tomorrow.",
  "So yes, I won. And no, I do not regret a single minute of it.",
  "That is the whole story. Judge me if you want, I have zero regrets.",
];

const FILLERS = [
  "Looking back, the warning signs were all there from the very beginning, I just refused to see them because I wanted to believe people are basically decent.",
  "My friends are completely split on this one, half of them think I am a hero and the other half think I took it way too far.",
  "I keep replaying the whole thing in my head, and every single time I land in the exact same place: I did what I had to do.",
  "The most satisfying part is that they still have no idea how it all connects back to that one moment where everything started.",
  "If nothing else, I learned that documenting everything with timestamps and screenshots is the single best habit you can build.",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function offlineStory(idea, targetWords = 185) {
  const setup =
    `For some context: ${String(idea).replace(/\.$/, "")}. ` +
    "I know how that sounds written out, but I promise the reality was ten times worse.";
  const parts = [
    pick(HOOKS),
    setup,
    pick(ESCALATIONS),
    pick(ESCALATIONS),
    pick(ESCALATIONS),
    "I finally confronted the whole thing head on, heart pounding, with every receipt I had collected lined up like a prosecutor.",
    pick(TWISTS),
    "The look on their face when they realized I had seen everything is something I will treasure for the rest of my life.",
    pick(KICKERS),
  ];
  let text = parts.join(" ");
  const floor = Math.max(80, Math.round(targetWords * 0.85));
  let i = 0;
  while (text.split(/\s+/).length < floor && i < FILLERS.length * 2) {
    const filler = FILLERS[i % FILLERS.length];
    if (!text.includes(filler)) text += " " + filler;
    i++;
  }
  return text;
}
