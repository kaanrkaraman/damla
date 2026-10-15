const site = location.hostname.replace(/^(www|m|mobile)\./, "");
const MAX_ITEMS = 200;

const call = (method, path, body) => browser.runtime.sendMessage({ api: { method, path, body } });

const canon = (href) => {
  const u = new URL(href, location.href);
  const v = u.searchParams.get("v");
  u.search = v ? `?v=${v}` : "";
  u.hash = "";
  return u.href;
};

const kindOf = (url) => {
  const p = new URL(url).pathname;
  if (p.startsWith("/shorts/")) return "Short";
  if (/^\/reels?\//.test(p)) return "Reel";
  if (p.includes("/status/")) return "Tweet";
  if (p.startsWith("/p/")) return t("kindPost");
  return t("kindVideo");
};

const ytThumb = (url) => {
  const u = new URL(url);
  const id = u.searchParams.get("v") || u.pathname.split("/")[2];
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "";
};

const text = (el) => el?.textContent?.trim() || "";

function xPosts() {
  const out = [];
  for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
    const player = a.querySelector('[data-testid="videoPlayer"]');
    const link = a.querySelector("time")?.closest("a");
    if (!player || !link) continue;
    out.push({
      url: canon(link.href),
      label: a.querySelector('[data-testid="tweetText"]')?.innerText || t("tweetVideo"),
      thumb: player.querySelector("video")?.poster || "",
      mount: player,
    });
  }
  return out;
}

function mostVisibleVideo() {
  let best = null;
  let area = 0;
  for (const v of document.querySelectorAll("video")) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (w * h > area) {
      area = w * h;
      best = v;
    }
  }
  return best;
}

const IG_VIDEO_ICONS = /clip|klip|video|reels/i;

const IG_SKIP = new Set(["explore", "reels", "reel", "p", "direct", "stories", "accounts", "about", "web", "tv", "tags", "locations", "challenge"]);
const clip = (str, n) => (str.length > n ? `${str.slice(0, n - 1).trimEnd()}…` : str);

function igUser(from) {
  let el = from;
  for (let i = 0; i < 8 && el && el !== document.body; i++, el = el.parentElement) {
    if (el.querySelectorAll("video").length > 1) break;
    for (const a of el.querySelectorAll('a[href^="/"]')) {
      const name = a.getAttribute("href").match(/^\/([A-Za-z0-9._]+)\/$/)?.[1];
      if (name && !IG_SKIP.has(name)) return name;
    }
  }
  return "";
}

function igLabel(user, caption) {
  const text = clip((caption || "").replace(/\s+/g, " ").trim(), 140);
  if (user && text) return `${user}: ${text}`;
  return user || text || t("igVideo");
}

function igPosts() {
  const out = [];
  const inFeed = new Set();
  for (const a of document.querySelectorAll("article")) {
    const video = a.querySelector("video");
    const link = a.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    if (!video || !link) continue;
    inFeed.add(link);
    out.push({ url: canon(link.href), label: igLabel(igUser(a), a.querySelector("h1")?.innerText), thumb: video.poster || "", mount: video.parentElement });
  }
  for (const link of document.querySelectorAll('main a[href*="/reel/"], main a[href*="/p/"]')) {
    if (inFeed.has(link) || link.closest("article")) continue;
    const isVideo = link.href.includes("/reel/") || [...link.querySelectorAll("svg[aria-label]")].some((s) => IG_VIDEO_ICONS.test(s.getAttribute("aria-label")));
    if (!isVideo) continue;
    const img = link.querySelector("img");
    out.push({ url: canon(link.href), label: igLabel("", img?.alt?.split(/\.\s/)[0]), thumb: img?.src || "", mount: null });
  }
  if (!out.length && /^\/(reels?|p)\/[^/]+/.test(location.pathname)) {
    const video = mostVisibleVideo();
    const title = document.title === "Instagram" ? "" : document.title;
    const user = igUser(video);
    out.push({ url: canon(location.href), label: user ? igLabel(user, "") : igLabel("", title), thumb: video?.poster || "", mount: video });
  }
  return out;
}

function fbPosts() {
  const out = [];
  for (const v of document.querySelectorAll("video")) {
    const box = v.closest('[role="article"]');
    const link = box?.querySelector('a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/?v="]');
    const onVideoPage = /^\/(watch|reel)\b|\/videos\//.test(location.pathname);
    const url = link ? canon(link.href) : onVideoPage ? canon(location.href) : null;
    if (url) out.push({ url, label: box?.querySelector('[data-ad-preview="message"]')?.innerText || document.title, thumb: v.poster || "", mount: v.parentElement });
  }
  return out;
}

const YT_ENTRIES = [
  "ytd-playlist-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "ytd-video-renderer",
  "ytd-rich-item-renderer",
  "ytd-grid-video-renderer",
].join(",");

function ytPosts() {
  const out = [];
  const p = location.pathname;
  if (p === "/watch" || p.startsWith("/shorts/")) {
    const url = canon(location.href);
    out.push({ url, label: document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube$/, ""), thumb: ytThumb(url), mount: null });
  }
  for (const el of document.querySelectorAll(YT_ENTRIES)) {
    const link = el.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!link) continue;
    const url = canon(link.href);
    out.push({ url, label: text(el.querySelector("#video-title")) || link.title || t("ytVideo"), thumb: ytThumb(url), mount: null });
  }
  return out;
}

const collectors = { "x.com": xPosts, "twitter.com": xPosts, "instagram.com": igPosts, "facebook.com": fbPosts, "youtube.com": ytPosts };

const msgText = (m) => (m?.startsWith("@") ? t(m) : m || "");
const isGeneric = (label) => [t("tweetVideo"), t("igVideo"), t("ytVideo"), t("fbVideo")].includes(label);

function posts() {
  const seen = new Set();
  return (collectors[site]?.() ?? []).filter((p) => !seen.has(p.url) && seen.add(p.url)).slice(0, MAX_ITEMS);
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "scan") {
    return Promise.resolve(posts().map(({ url, label, thumb }) => ({ url, label, thumb, kind: kindOf(url), generic: isGeneric(label) })));
  }
});

const STYLE = `
:host { all: initial; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font: 600 13px/1 -apple-system, system-ui, sans-serif; }
[hidden] { display: none !important; }
.pin { position: absolute; inset: 0 auto auto 0; pointer-events: auto; will-change: transform; }
.glass { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 12px 0 9px; color: #fff;
  background: rgb(28 28 30 / 0.62); -webkit-backdrop-filter: blur(20px) saturate(1.8); backdrop-filter: blur(20px) saturate(1.8);
  border: 0; border-radius: 999px; box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.2); font: inherit; }
button.glass { cursor: pointer; transition: background-color .12s, opacity .12s; }
button.glass:hover { background: rgb(58 58 60 / 0.72); }
button.glass:active { opacity: 0.7; }
button.glass:focus-visible { outline: 2px solid rgb(255 255 255 / 0.8); outline-offset: 2px; }
button.glass:disabled { opacity: 0.85; cursor: progress; }
svg { flex: none; inline-size: 14px; block-size: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-state="error"] svg { stroke: #ff6961; }
.spin { animation: spin 0.9s linear infinite; transform-origin: 50% 50%; }
@keyframes spin { to { transform: rotate(360deg); } }
.tray { position: absolute; inset: auto 0 22px 0; display: flex; justify-content: center; }
.tray .glass { min-height: 34px; padding: 0 16px 0 12px; }
@media (prefers-reduced-motion: reduce) { button.glass { transition: none; } .spin { animation: none; } }
`;

const ICON = {
  idle: '<path d="M8 2v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  queued: '<circle cx="8" cy="8" r="5.5" stroke-opacity=".35"/>',
  running: '<g class="spin"><circle cx="8" cy="8" r="5.5" stroke-opacity=".3"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"/></g>',
  done: '<path d="M3.5 8.5l3 3 6-6.5"/>',
  error: '<path d="M8 3v6M8 12.5v.01"/>',
};
const LABEL = () => ({ idle: t("download"), queued: t("queued"), running: t("downloading"), done: t("downloadedLabel"), error: t("retry") });
const POLL_MS = 700;
const TRAY_MS = 3500;

const jobs = new Map();
const pins = new Set();
const attached = new WeakMap();
let offline = false;
let inlineOn = true;
let timer = 0;
let frame = 0;
let trayTimer = 0;
let tracked = new Set();

const host = document.createElement("damla-layer");
const root = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = STYLE;
const layer = document.createElement("div");
layer.className = "root";
const tray = document.createElement("div");
tray.className = "tray";
tray.hidden = true;
layer.append(tray);
root.append(style, layer);
document.documentElement.append(host);

const icon = (state) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[state]}</svg>`;
const isActive = (j) => j.state === "queued" || j.state === "running";

function place() {
  frame = 0;
  for (const pin of pins) {
    if (!pin.mount.isConnected) {
      pin.el.remove();
      pins.delete(pin);
      continue;
    }
    const r = pin.mount.getBoundingClientRect();
    const visible = inlineOn && r.width > 120 && r.height > 80 && r.bottom > 40 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    pin.el.hidden = !visible;
    if (visible) pin.el.style.transform = `translate(${Math.round(Math.max(r.left, 0) + 10)}px, ${Math.round(Math.max(r.top, 0) + 10)}px)`;
  }
}
const schedule = () => {
  if (!frame) frame = requestAnimationFrame(place);
};
addEventListener("scroll", schedule, { capture: true, passive: true });
addEventListener("resize", schedule);
setInterval(schedule, 400);

function showTray(state, text, ms) {
  clearTimeout(trayTimer);
  tray.hidden = false;
  tray.replaceChildren();
  const pill = document.createElement("div");
  pill.className = "glass";
  pill.dataset.state = state;
  pill.innerHTML = icon(state);
  pill.append(text);
  tray.append(pill);
  if (ms) trayTimer = setTimeout(() => (tray.hidden = true), ms);
}

function updateTray(list) {
  const active = list.filter(isActive);
  if (active.length) {
    active.forEach((j) => tracked.add(j.id));
    const avg = Math.round(active.reduce((n, j) => n + (j.state === "running" ? j.percent : 0), 0) / active.length);
    showTray("running", active.length === 1 ? t("trayDownloading", avg) : t("trayMany", active.length, avg));
  } else if (tracked.size) {
    const finished = list.filter((j) => tracked.has(j.id) && (j.state === "done" || j.state === "error"));
    tracked = new Set();
    if (!finished.length) tray.hidden = true;
    else if (finished.some((j) => j.state === "error")) showTray("error", t("trayFailed"), TRAY_MS);
    else showTray("done", finished.length === 1 ? t("trayDone") : t("trayDoneMany", finished.length), TRAY_MS);
  }
}

function applyJobs(list) {
  jobs.clear();
  for (const j of list) if (!jobs.has(j.url)) jobs.set(j.url, j);
  pins.forEach((p) => p.paint());
  updateTray(list);
  clearTimeout(timer);
  if (list.some(isActive)) timer = setTimeout(pull, POLL_MS);
}

async function pull() {
  const r = await call("GET", "/jobs");
  offline = !!r?.offline;
  applyJobs(r?.jobs ?? []);
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "scan") {
    return Promise.resolve(posts().map(({ url, label, thumb }) => ({ url, label, thumb, kind: kindOf(url) })));
  }
  if (msg.type === "jobs") applyJobs(msg.jobs ?? []);
});

function attach(mount, post) {
  const known = attached.get(mount);
  if (known) {
    Object.assign(known, { url: post.url, label: post.label, thumb: post.thumb });
    known.paint();
    schedule();
    return;
  }
  const el = document.createElement("div");
  el.className = "pin";
  el.hidden = true;
  const btn = document.createElement("button");
  btn.className = "glass";
  el.append(btn);
  const pin = {
    mount,
    el,
    url: post.url,
    label: post.label,
    thumb: post.thumb,
    clicked: false,
    pending: false,
    paint() {
      const job = jobs.get(this.url);
      if (job) this.pending = false;
      const failed = this.clicked && offline && !job;
      const raw = failed ? "error" : (job?.state ?? (this.pending ? "queued" : "idle"));
      const state = raw === "cancelled" ? "idle" : raw;
      btn.dataset.state = state;
      btn.disabled = state === "running" || state === "queued";
      btn.innerHTML = icon(state);
      btn.append(failed ? t("helperOff") : state === "running" && job.percent ? t("downloadingPct", job.percent) : LABEL()[state]);
      btn.title = state === "done" ? t("reveal") : msgText(job?.msg);
    },
  };
  for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
    btn.addEventListener(ev, (e) => e.stopPropagation());
  }
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const job = jobs.get(pin.url);
    if (job?.state === "done") {
      call("POST", `/jobs/${job.id}/reveal`);
      return;
    }
    pin.clicked = true;
    pin.pending = true;
    pin.paint();
    const r = await call("POST", "/jobs", { items: [{ url: pin.url, title: isGeneric(pin.label) ? "" : pin.label, thumb: pin.thumb }] });
    if (r?.offline) {
      pin.pending = false;
      offline = true;
    }
    pull();
  });
  attached.set(mount, pin);
  pins.add(pin);
  layer.append(el);
  pin.paint();
  schedule();
}

function sweep() {
  if (!inlineOn) return;
  for (const p of posts()) if (p.mount) attach(p.mount, p);
}

let queued = 0;
new MutationObserver(() => {
  clearTimeout(queued);
  queued = setTimeout(sweep, 300);
}).observe(document.body, { childList: true, subtree: true });
setInterval(sweep, 1500);

browser.storage.local.get({ inline: true }).then(({ inline }) => {
  inlineOn = inline;
  sweep();
  schedule();
  pull();
});
browser.storage.onChanged.addListener((changes) => {
  if (!changes.inline) return;
  inlineOn = changes.inline.newValue !== false;
  if (inlineOn) sweep();
  schedule();
});
