import { t } from "./i18n";
import type { Item } from "./types";

export interface Post {
  url: string;
  label: string;
  thumb: string;
  mount: Element | null;
}

const MAX_ITEMS = 200;
const IG_VIDEO_ICONS = /clip|klip|video|reels/i;
const IG_SKIP = new Set([
  "explore",
  "reels",
  "reel",
  "p",
  "direct",
  "stories",
  "accounts",
  "about",
  "web",
  "tv",
  "tags",
  "locations",
  "challenge",
]);
const YT_ENTRIES = [
  "ytd-playlist-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "ytd-video-renderer",
  "ytd-rich-item-renderer",
  "ytd-grid-video-renderer",
].join(",");

const site = location.hostname.replace(/^(www|m|mobile)\./, "");

const canon = (href: string): string => {
  const url = new URL(href, location.href);
  const video = url.searchParams.get("v");
  url.search = video ? `?v=${video}` : "";
  url.hash = "";
  return url.href;
};

export const kindOf = (url: string): string => {
  const path = new URL(url).pathname;
  if (path.startsWith("/shorts/")) return "Short";
  if (/^\/reels?\//.test(path)) return "Reel";
  if (path.includes("/status/")) return "Tweet";
  if (path.startsWith("/p/")) return t("kindPost");
  return t("kindVideo");
};

const ytThumb = (url: string): string => {
  const parsed = new URL(url);
  const id = parsed.searchParams.get("v") || parsed.pathname.split("/")[2];
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "";
};

const text = (el: Element | null): string => el?.textContent?.trim() || "";
const innerText = (el: Element | null | undefined): string => (el instanceof HTMLElement ? el.innerText : "");
const clip = (str: string, max: number): string => (str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str);

const genericLabels = (): string[] => [t("tweetVideo"), t("igVideo"), t("ytVideo"), t("fbVideo")];
export const isGeneric = (label: string): boolean => genericLabels().includes(label);

function xPosts(): Post[] {
  const out: Post[] = [];
  for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
    const player = article.querySelector('[data-testid="videoPlayer"]');
    const link = article.querySelector("time")?.closest("a");
    if (!player || !link) continue;
    out.push({
      url: canon(link.href),
      label: innerText(article.querySelector('[data-testid="tweetText"]')) || t("tweetVideo"),
      thumb: player.querySelector("video")?.poster || "",
      mount: player,
    });
  }
  return out;
}

function mostVisibleVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let area = 0;
  for (const video of document.querySelectorAll("video")) {
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    if (width * height > area) {
      area = width * height;
      best = video;
    }
  }
  return best;
}

function igUser(from: Element | null): string {
  let el = from;
  for (let depth = 0; depth < 8 && el && el !== document.body; depth++, el = el.parentElement) {
    if (el.querySelectorAll("video").length > 1) break;
    for (const anchor of el.querySelectorAll('a[href^="/"]')) {
      const name = anchor.getAttribute("href")?.match(/^\/([A-Za-z0-9._]+)\/$/)?.[1];
      if (name && !IG_SKIP.has(name)) return name;
    }
  }
  return "";
}

function igLabel(user: string, caption: string | undefined): string {
  const body = clip((caption || "").replace(/\s+/g, " ").trim(), 140);
  if (user && body) return `${user}: ${body}`;
  return user || body || t("igVideo");
}

function igPosts(): Post[] {
  const out: Post[] = [];
  const inFeed = new Set<Element>();
  for (const article of document.querySelectorAll("article")) {
    const video = article.querySelector("video");
    const link = article.querySelector<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]');
    if (!video || !link) continue;
    inFeed.add(link);
    out.push({
      url: canon(link.href),
      label: igLabel(igUser(article), innerText(article.querySelector("h1"))),
      thumb: video.poster || "",
      mount: video.parentElement,
    });
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('main a[href*="/reel/"], main a[href*="/p/"]')) {
    if (inFeed.has(link) || link.closest("article")) continue;
    const labelled = [...link.querySelectorAll("svg[aria-label]")].some((icon) =>
      IG_VIDEO_ICONS.test(icon.getAttribute("aria-label") ?? ""),
    );
    if (!link.href.includes("/reel/") && !labelled) continue;
    const img = link.querySelector("img");
    out.push({ url: canon(link.href), label: igLabel("", img?.alt?.split(/\.\s/)[0]), thumb: img?.src || "", mount: null });
  }
  if (!out.length && /^\/(reels?|p)\/[^/]+/.test(location.pathname)) {
    const video = mostVisibleVideo();
    const title = document.title === "Instagram" ? "" : document.title;
    const user = igUser(video);
    out.push({
      url: canon(location.href),
      label: user ? igLabel(user, "") : igLabel("", title),
      thumb: video?.poster || "",
      mount: video,
    });
  }
  return out;
}

function fbPosts(): Post[] {
  const out: Post[] = [];
  const onVideoPage = /^\/(watch|reel)\b|\/videos\//.test(location.pathname);
  for (const video of document.querySelectorAll("video")) {
    const box = video.closest('[role="article"]');
    const link = box?.querySelector<HTMLAnchorElement>('a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/?v="]');
    const url = link ? canon(link.href) : onVideoPage ? canon(location.href) : null;
    if (!url) continue;
    out.push({
      url,
      label: innerText(box?.querySelector('[data-ad-preview="message"]')) || document.title,
      thumb: video.poster || "",
      mount: video.parentElement,
    });
  }
  return out;
}

function ytPosts(): Post[] {
  const out: Post[] = [];
  const path = location.pathname;
  if (path === "/watch" || path.startsWith("/shorts/")) {
    const url = canon(location.href);
    out.push({ url, label: document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube$/, ""), thumb: ytThumb(url), mount: null });
  }
  for (const entry of document.querySelectorAll(YT_ENTRIES)) {
    const link = entry.querySelector<HTMLAnchorElement>('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!link) continue;
    const url = canon(link.href);
    out.push({ url, label: text(entry.querySelector("#video-title")) || link.title || t("ytVideo"), thumb: ytThumb(url), mount: null });
  }
  return out;
}

const COLLECTORS: Record<string, () => Post[]> = {
  "x.com": xPosts,
  "twitter.com": xPosts,
  "instagram.com": igPosts,
  "facebook.com": fbPosts,
  "youtube.com": ytPosts,
};

export function collectPosts(): Post[] {
  const seen = new Set<string>();
  const unique = (COLLECTORS[site]?.() ?? []).filter((post) => !seen.has(post.url) && seen.add(post.url));
  return unique.slice(0, MAX_ITEMS);
}

export const toItems = (posts: Post[]): Item[] =>
  posts.map(({ url, label, thumb }) => ({ url, label, thumb, kind: kindOf(url), generic: isGeneric(label) }));
