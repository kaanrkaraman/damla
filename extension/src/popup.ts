import { api } from "./api";
import { h, type IconName, icon, svg } from "./dom";
import { jobMessage, LANG, t, tn } from "./i18n";
import { type About, type Item, isActive, type Job, type Settings } from "./types";

type View = "list" | "settings";
type Action = () => unknown;

interface State {
  view: View;
  items: Item[];
  jobs: Job[];
  settings: Settings | null;
  offline: boolean;
  selecting: boolean;
  selected: Set<string>;
  host: string;
  pending: Set<string>;
  about: About | null;
  inline: boolean;
  updating: boolean;
}

interface RowSpec {
  title: string;
  sub: string;
  err?: boolean;
  thumbUrl: string;
  job: Job | undefined;
  item: Item;
  selectable?: boolean;
}

const RING_LEN = 2 * Math.PI * 11;
const REQUIRED_API = 1;
const RELEASES_URL = "https://github.com/kaanrkaraman/damla/releases/tag";
const MIN_SETTINGS_HEIGHT = 530;
const POLL_MS = 1000;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

const S: State = {
  view: "list",
  items: [],
  jobs: [],
  settings: null,
  offline: false,
  selecting: false,
  selected: new Set(),
  host: "",
  pending: new Set(),
  about: null,
  inline: true,
  updating: false,
};

let pollTimer = 0;

const appRoot = (): HTMLElement => {
  const app = document.getElementById("app");
  if (!app) throw new Error("#app is missing from popup.html");
  return app;
};

const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });

function ago(at: number): string {
  const delta = at - Date.now() / 1000;
  const seconds = Math.abs(delta);
  if (seconds < MINUTE) return t("justNow");
  if (seconds < HOUR) return rtf.format(Math.round(delta / MINUTE), "minute");
  if (seconds < DAY) return rtf.format(Math.round(delta / HOUR), "hour");
  return rtf.format(Math.round(delta / DAY), "day");
}

const hostOf = (url: string): string => new URL(url).hostname.replace(/^www\./, "");

const pendingJob = (url: string): Job => ({
  id: "",
  url,
  title: "",
  thumb: "",
  state: "queued",
  percent: 0,
  msg: "",
  file: "",
  finished: 0,
});
const jobFor = (url: string): Job | undefined =>
  S.jobs.find((job) => job.url === url) ?? (S.pending.has(url) ? pendingJob(url) : undefined);
const startable = (item: Item): boolean => {
  const job = jobFor(item.url);
  return !(job && isActive(job)) && job?.state !== "done";
};

function subText(job: Job | undefined, kind: string): string {
  switch (job?.state) {
    case "queued":
      return t("queued");
    case "running":
      return jobMessage(job.msg) || `${t("downloading")} · ${job.percent}%`;
    case "done":
      return `${t("downloadedLabel")} · ${ago(job.finished)}`;
    case "error":
      return jobMessage(job.msg) || t("failed");
    case "cancelled":
      return t("cancelled");
    default:
      return kind;
  }
}

async function start(list: Item[]): Promise<void> {
  for (const item of list) S.pending.add(item.url);
  render();
  const items = list.map(({ url, label, thumb, generic }) => ({ url, title: generic ? "" : label, thumb }));
  const reply = await api("POST", "/jobs", { items });
  if (reply?.offline) S.offline = true;
  else await poll();
  for (const item of list) S.pending.delete(item.url);
  render();
}

async function act(path: string): Promise<void> {
  await api("POST", path);
  void poll();
}

function ringButton(job: Job): HTMLButtonElement {
  const percent = job.state === "running" ? job.percent : 0;
  const spinning = job.state === "running" && percent === 0;
  const classes = ["ring", job.state === "queued" ? "waiting" : "", spinning ? "spin" : ""].filter(Boolean).join(" ");
  const offset = RING_LEN * (1 - (spinning ? 0.25 : percent / 100));
  const ring = h("button", {
    class: classes,
    type: "button",
    "aria-label": t("cancel"),
    onclick: () => job.id && act(`/jobs/${job.id}/cancel`),
  });
  ring.append(
    svg(
      `<circle class="track" cx="14" cy="14" r="11" fill="none" stroke-width="2"/>` +
        `<g class="arcg"><circle class="arc" cx="14" cy="14" r="11" fill="none" stroke-width="2" transform="rotate(-90 14 14)" stroke-dasharray="${RING_LEN}" stroke-dashoffset="${offset}"/></g>` +
        `<rect x="10.5" y="10.5" width="7" height="7" rx="1.6" fill="currentColor"/>`,
      "",
      28,
    ),
  );
  return ring;
}

function control(job: Job | undefined, item: Item): HTMLButtonElement {
  if (job && isActive(job)) return ringButton(job);
  let spec: { icon: IconName; label: string; run: Action };
  if (job?.state === "done") spec = { icon: "folder", label: t("reveal"), run: () => act(`/jobs/${job.id}/reveal`) };
  else if (job?.state === "error" || job?.state === "cancelled") spec = { icon: "retry", label: t("retry"), run: () => start([item]) };
  else spec = { icon: "down", label: t("download"), run: () => start([item]) };
  return h(
    "button",
    { class: "icon-btn", type: "button", "aria-label": spec.label, title: spec.label, onclick: spec.run },
    icon(spec.icon),
  );
}

function thumb(src: string): HTMLElement {
  const box = h("div", { class: "thumb" }, icon("film"));
  if (src) {
    const img = h("img", { src, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("load", () => box.replaceChildren(img));
    img.addEventListener("error", () => img.remove());
  }
  return box;
}

const pick = (): SVGSVGElement => svg('<circle cx="10" cy="10" r="9"/><path d="M6 10.5l2.9 2.9L14.2 7.6"/>', "pick");

function toggleSelected(url: string): void {
  if (!S.selected.delete(url)) S.selected.add(url);
  render();
}

function row({ title, sub, err, thumbUrl, job, item, selectable }: RowSpec): HTMLElement {
  const picked = selectable && S.selected.has(item.url);
  return h(
    "li",
    {
      "data-state": job?.state,
      class: `row${selectable ? " selectable" : ""}${picked ? " selected" : ""}`,
      title: job?.file,
      onclick: selectable ? () => toggleSelected(item.url) : null,
    },
    selectable && pick(),
    thumb(thumbUrl),
    h("div", { class: "text" }, h("p", { class: "title" }, title), h("p", { class: `sub${err ? " err" : ""}` }, sub)),
    !selectable && control(job, item),
  );
}

function notice(iconName: IconName, title: string, text?: string, ...extra: HTMLElement[]): HTMLElement {
  return h(
    "div",
    { class: "notice" },
    icon(iconName, "ic ic-big"),
    h("p", { class: "notice-title" }, title),
    text && h("p", {}, text),
    ...extra,
  );
}

function topBar(): HTMLElement {
  const news = S.about !== null && (S.about.app_update || S.about.ytdlp_update);
  const gear = h(
    "button",
    {
      class: `icon-btn${news ? " dot" : ""}`,
      type: "button",
      "aria-label": t("settings"),
      title: news ? t("settingsNew") : t("settings"),
      onclick: openSettings,
    },
    icon("sliders"),
  );
  return h("header", { class: "top" }, h("h1", {}, t("title")), gear);
}

function actionBar(): HTMLElement | null {
  const eligible = S.items.filter(startable);
  if (S.selecting) {
    const chosen = S.items.filter((item) => S.selected.has(item.url) && startable(item));
    const onclick = () => {
      void start(chosen);
      S.selecting = false;
      S.selected.clear();
    };
    const label = chosen.length ? t("downloadSelected", chosen.length) : t("pickVideos");
    return h("div", { class: "bar" }, h("button", { type: "button", disabled: chosen.length === 0, onclick }, label));
  }
  if (eligible.length < 2) return null;
  return h("div", { class: "bar" }, h("button", { type: "button", onclick: () => start(eligible) }, t("downloadAll", eligible.length)));
}

const incompatible = (): boolean => S.about !== null && S.about.api !== REQUIRED_API;

const compatibilityWarning = (): HTMLElement | false =>
  incompatible() &&
  h(
    "div",
    { class: "warning" },
    icon("alert"),
    h("div", {}, h("p", { class: "warning-title" }, t("incompatibleTitle")), h("p", {}, t("incompatibleHint"))),
  );

function contextBar(): HTMLElement | null {
  const count = S.items.length;
  if (!count) return null;
  const toggleSelecting = () => {
    S.selecting = !S.selecting;
    S.selected.clear();
    render();
  };
  return h(
    "div",
    { class: "context" },
    h("span", {}, tn("count", count, S.host, count)),
    count > 1 && h("button", { class: "text-btn", type: "button", onclick: toggleSelecting }, S.selecting ? t("finish") : t("select")),
  );
}

function elsewhereSection(): HTMLElement[] | null {
  const onPage = new Set(S.items.map((item) => item.url));
  const elsewhere = S.jobs.filter((job) => isActive(job) && !onPage.has(job.url));
  if (!elsewhere.length) return null;
  const rows = elsewhere.map((job) =>
    row({
      title: job.title || job.url,
      sub: subText(job, hostOf(job.url)),
      thumbUrl: job.thumb,
      job,
      item: { url: job.url, label: job.title, thumb: job.thumb, kind: "", generic: false },
    }),
  );
  return [h("div", { class: "context" }, h("span", {}, t("downloadingNow"))), h("ul", { class: "list" }, ...rows)];
}

function itemList(): HTMLElement {
  if (!S.items.length) return notice("film", t("notFound"), t("notFoundHint"));
  const rows = S.items.map((item) => {
    const job = jobFor(item.url);
    return row({
      title: item.label,
      sub: subText(job, item.kind),
      err: job?.state === "error",
      thumbUrl: item.thumb,
      job,
      item,
      selectable: S.selecting,
    });
  });
  return h("ul", { class: "list" }, ...rows);
}

function pageView(): HTMLElement {
  return h("main", {}, compatibilityWarning(), elsewhereSection(), contextBar(), itemList(), actionBar());
}

function offlineView(): HTMLElement {
  return h("main", {}, notice("alert", t("offlineTitle"), t("offlineHint"), h("button", { type: "button", onclick: poll }, t("retryBtn"))));
}

interface RowOptions {
  desc?: string;
  stacked?: boolean;
}

function setRow(label: string, control: HTMLElement, { desc, stacked }: RowOptions = {}): HTMLElement {
  if (stacked) return h("div", { class: "set-row stacked" }, h("p", {}, label), control);
  return h("div", { class: "set-row" }, h("div", {}, h("p", {}, label), desc && h("p", { class: "desc" }, desc)), control);
}

const group = (caption: string, ...rows: HTMLElement[]): HTMLElement[] => [
  h("p", { class: "caption" }, caption),
  h("div", { class: "group" }, ...rows),
];

async function update(patch: Partial<Settings>): Promise<void> {
  const reply = await api("PUT", "/settings", patch);
  if (reply?.settings) S.settings = reply.settings;
}

type BooleanSetting = "by_site" | "cookies" | "reveal";

function switchInput(checked: boolean, onchange: (on: boolean) => void): HTMLInputElement {
  return h("input", {
    type: "checkbox",
    role: "switch",
    switch: true,
    checked,
    onchange: (event) => onchange((event.target as HTMLInputElement).checked),
  });
}

const toggleBox = (settings: Settings, key: BooleanSetting): HTMLInputElement =>
  switchInput(settings[key], (on) => void update({ [key]: on }));

const inlineBox = (): HTMLInputElement =>
  switchInput(S.inline, (on) => {
    S.inline = on;
    void browser.storage.local.set({ inline: on });
  });

function segmented<K extends "quality" | "codec" | "concurrent">(
  settings: Settings,
  key: K,
  options: [Settings[K], string][],
): HTMLElement {
  const index = Math.max(
    0,
    options.findIndex(([value]) => value === settings[key]),
  );
  const seg = h("div", { class: "seg", role: "radiogroup" });
  seg.style.setProperty("--n", String(options.length));
  seg.style.setProperty("--i", String(index));
  options.forEach(([value, name], position) => {
    const input = h("input", {
      type: "radio",
      name: key,
      value: String(value),
      checked: position === index,
      onchange: () => {
        seg.style.setProperty("--i", String(position));
        void update({ [key]: value });
      },
    });
    seg.append(h("label", {}, input, h("span", {}, name)));
  });
  return seg;
}

async function updateYtdlp(): Promise<void> {
  S.updating = true;
  render();
  await api("POST", "/update-ytdlp");
  S.updating = false;
  await loadAbout();
  await poll();
  render();
}

async function updateApp(): Promise<void> {
  if (S.about?.bundled) {
    await api("POST", "/update-app");
    return;
  }
  const url = S.about?.latest_app?.url;
  if (url?.startsWith("https://github.com/")) await browser.tabs.create({ url });
}

const openChangelog = (): Promise<unknown> => browser.tabs.create({ url: `${RELEASES_URL}/v${browser.runtime.getManifest().version}` });

const textButton = (label: string, onclick: Action, disabled = false): HTMLButtonElement =>
  h("button", { class: "text-btn", type: "button", disabled, onclick }, label);

function versionFooter(): HTMLElement {
  const about = S.about;
  const version = browser.runtime.getManifest().version;
  const appUpdate = about?.app_update &&
    about.latest_app && [
      ` · ${t("available", about.latest_app.version)} `,
      textButton(about.bundled ? t("update") : t("openRelease"), updateApp),
    ];
  const ytdlpUpdate = about?.ytdlp_update &&
    about.latest_ytdlp && [
      ` · ${t("available", about.latest_ytdlp.version)} `,
      textButton(S.updating ? t("updating") : t("update"), updateYtdlp, S.updating),
    ];
  const ytdlpVersion = about?.ytdlp === null ? "…" : about?.ytdlp || "—";
  return h(
    "div",
    { class: "foot" },
    h("p", {}, `Damla ${version}`, appUpdate),
    h("p", {}, `yt-dlp ${ytdlpVersion}`, ytdlpUpdate),
    about && about.helper !== version && h("p", {}, t("outOfSync", about.helper)),
    h("p", {}, textButton(t("checkUpdates"), updateApp), " · ", textButton(t("whatsNew"), openChangelog)),
  );
}

async function pickFolder(): Promise<void> {
  const reply = await api("POST", "/pick-folder", { prompt: t("chooseFolder") });
  if (!reply?.settings) return;
  S.settings = reply.settings;
  render();
}

function settingsView(): HTMLElement[] {
  const head = h(
    "header",
    { class: "top settings" },
    h("button", { class: "icon-btn", type: "button", "aria-label": t("back"), onclick: closeSettings }, icon("back")),
    h("h1", {}, t("settings")),
    h("span"),
  );
  const settings = S.settings;
  if (!settings) return [head, h("main", {}, notice("alert", t("loadFailed"), t("unreachable")))];
  const body = h(
    "main",
    {},
    ...group(t("saveLocation"), setRow(settings.folder_label, h("button", { type: "button", onclick: pickFolder }, t("change")))),
    ...group(
      t("video"),
      setRow(
        t("resolution"),
        segmented(settings, "quality", [
          ["best", t("best")],
          ["1080", "1080p"],
          ["720", "720p"],
          ["audio", t("audio")],
        ]),
        { stacked: true },
      ),
      setRow(
        t("format"),
        segmented(settings, "codec", [
          ["auto", t("formatAuto")],
          ["compat", t("formatCompat")],
        ]),
      ),
    ),
    ...group(
      t("downloadsGroup"),
      setRow(
        t("atOnce"),
        segmented(settings, "concurrent", [
          [1, "1"],
          [2, "2"],
          [3, "3"],
          [4, "4"],
        ]),
      ),
      setRow(t("bySite"), toggleBox(settings, "by_site")),
      setRow(t("revealWhenDone"), toggleBox(settings, "reveal")),
      setRow(t("inlineButton"), inlineBox()),
      setRow(t("useSession"), toggleBox(settings, "cookies"), { desc: t("useSessionDesc") }),
    ),
    versionFooter(),
  );
  return [head, body];
}

function render(): void {
  const app = appRoot();
  const scroll = app.querySelector("main")?.scrollTop ?? 0;
  if (S.view === "settings") app.replaceChildren(...settingsView());
  else if (S.offline) app.replaceChildren(offlineView());
  else app.replaceChildren(topBar(), pageView());
  const main = app.querySelector("main");
  if (main) main.scrollTop = scroll;
}

async function loadAbout(): Promise<void> {
  const reply = await api("GET", "/about");
  S.about = reply?.helper ? (reply as unknown as About) : null;
}

async function openSettings(): Promise<void> {
  const app = appRoot();
  app.style.blockSize = `${Math.max(app.offsetHeight, MIN_SETTINGS_HEIGHT)}px`;
  S.view = "settings";
  S.selecting = false;
  render();
  const [reply, stored] = await Promise.all([api("GET", "/settings"), browser.storage.local.get({ inline: true }), loadAbout()]);
  S.settings = reply?.settings ?? null;
  S.inline = stored.inline !== false;
  render();
}

function closeSettings(): void {
  appRoot().style.removeProperty("block-size");
  S.view = "list";
  render();
}

async function poll(): Promise<void> {
  clearTimeout(pollTimer);
  const wasOffline = S.offline;
  const reply = await api("GET", "/jobs");
  S.offline = !!reply?.offline;
  S.jobs = reply?.jobs ?? [];
  if (S.view !== "settings" || S.offline !== wasOffline) render();
  if (S.jobs.some(isActive)) pollTimer = window.setTimeout(() => void poll(), POLL_MS);
}

async function init(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    if (tab?.url && tab.id !== undefined) {
      S.host = hostOf(tab.url);
      S.items = ((await browser.tabs.sendMessage(tab.id, { type: "scan" })) as Item[] | undefined) ?? [];
    }
  } catch {
    S.items = [];
  }
  await Promise.all([poll(), loadAbout()]);
  render();
}

document.documentElement.lang = LANG;
void init();
