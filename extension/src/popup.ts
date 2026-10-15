const api = (method, path, body) => browser.runtime.sendMessage({ api: { method, path, body } });

const ICONS = {
  down: '<path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3l1.5 1.5h6.5A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
  retry: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2"/>',
  sliders: '<path d="M3.5 6H7M11 6h5.5M3.5 14H10M14 14h2.5"/><circle cx="9" cy="6" r="2"/><circle cx="12" cy="14" r="2"/>',
  back: '<path d="M12 4 6 10l6 6"/>',
  alert: '<circle cx="10" cy="10" r="7.5"/><path d="M10 6.2v4.6M10 13.6v.01"/>',
  film: '<rect x="3.5" y="5" width="13" height="10" rx="2"/><path d="M8.5 8.2v3.6l3-1.8z" fill="currentColor"/>',
};

const RING_LEN = 2 * Math.PI * 11;
const REQUIRED_API = 1;
const RELEASES_URL = "https://github.com/kaanrkaraman/damla/releases/tag";

const S = {
  view: "list",
  items: [],
  jobs: [],
  settings: null,
  ytdlp: "",
  offline: false,
  selecting: false,
  selected: new Set(),
  host: "",
  pending: new Set(),
  about: null,
  inline: true,
  updating: false,
};

let timer = 0;

const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter((k) => k != null && k !== false));
  return n;
};

const svg = (inner, cls = "ic", box = 20) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 0 ${box} ${box}`);
  s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = inner;
  return s;
};
const icon = (name, cls) => svg(ICONS[name], cls);

const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
function ago(at) {
  const d = at - Date.now() / 1000;
  const a = Math.abs(d);
  if (a < 60) return t("justNow");
  if (a < 3600) return rtf.format(Math.round(d / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(d / 3600), "hour");
  return rtf.format(Math.round(d / 86400), "day");
}

const hostOf = (url) => new URL(url).hostname.replace(/^www\./, "");
const jobFor = (url) => S.jobs.find((j) => j.url === url) ?? (S.pending.has(url) ? { id: "", url, state: "queued", percent: 0 } : undefined);
const busy = (j) => j?.state === "queued" || j?.state === "running";
const startable = (i) => !busy(jobFor(i.url)) && jobFor(i.url)?.state !== "done";

const msgText = (m) => (m?.startsWith("@") ? t(`msg_${m.slice(1)}`) : m || "");

function subText(job, kind) {
  switch (job?.state) {
    case "queued": return t("queued");
    case "running": return msgText(job.msg) || `${t("downloading")} · ${job.percent}%`;
    case "done": return `${t("downloadedLabel")} · ${ago(job.finished)}`;
    case "error": return msgText(job.msg) || t("failed");
    case "cancelled": return t("cancelled");
    default: return kind;
  }
}

async function start(list) {
  list.forEach((i) => S.pending.add(i.url));
  render();
  const r = await api("POST", "/jobs", { items: list.map(({ url, label, thumb, generic }) => ({ url, title: generic ? "" : label, thumb })) });
  if (r?.offline) S.offline = true;
  else await poll();
  list.forEach((i) => S.pending.delete(i.url));
  render();
}

async function act(path) {
  await api("POST", path);
  poll();
}

function control(job, item) {
  if (job?.state === "running" || job?.state === "queued") {
    const p = job.state === "running" ? job.percent : 0;
    const spinning = job.state === "running" && p === 0;
    const ring = h("button", { class: `ring${job.state === "queued" ? " waiting" : ""}${spinning ? " spin" : ""}`, type: "button", "aria-label": t("cancel"), onclick: () => job.id && act(`/jobs/${job.id}/cancel`) });
    ring.append(
      svg(
        `<circle class="track" cx="14" cy="14" r="11" fill="none" stroke-width="2"/>` +
          `<g class="arcg"><circle class="arc" cx="14" cy="14" r="11" fill="none" stroke-width="2" transform="rotate(-90 14 14)" stroke-dasharray="${RING_LEN}" stroke-dashoffset="${RING_LEN * (1 - (spinning ? 0.25 : p / 100))}"/></g>` +
          `<rect x="10.5" y="10.5" width="7" height="7" rx="1.6" fill="currentColor"/>`,
        "",
        28,
      ),
    );
    return ring;
  }
  const spec =
    job?.state === "done"
      ? ["folder", t("reveal"), () => act(`/jobs/${job.id}/reveal`)]
      : job?.state === "error" || job?.state === "cancelled"
        ? ["retry", t("retry"), () => start([item])]
        : ["down", t("download"), () => start([item])];
  return h("button", { class: "icon-btn", type: "button", "aria-label": spec[1], title: spec[1], onclick: spec[2] }, icon(spec[0]));
}

function thumb(src) {
  const box = h("div", { class: "thumb" }, icon("film"));
  if (src) {
    const img = h("img", { src, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("load", () => box.replaceChildren(img));
    img.addEventListener("error", () => img.remove());
  }
  return box;
}

const pick = () => svg('<circle cx="10" cy="10" r="9"/><path d="M6 10.5l2.9 2.9L14.2 7.6"/>', "pick");

function toggle(url) {
  S.selected.has(url) ? S.selected.delete(url) : S.selected.add(url);
  render();
}

function row({ title, sub, err, thumbUrl, job, item, selectable }) {
  const picked = selectable && S.selected.has(item.url);
  return h(
    "li",
    {
      "data-state": job?.state,
      class: `row${selectable ? " selectable" : ""}${picked ? " selected" : ""}`,
      title: job?.file,
      onclick: selectable ? () => toggle(item.url) : null,
    },
    selectable && pick(),
    thumb(thumbUrl),
    h("div", { class: "text" }, h("p", { class: "title" }, title), h("p", { class: `sub${err ? " err" : ""}` }, sub)),
    !selectable && control(job, item),
  );
}

function notice(iconName, title, text, ...extra) {
  return h("div", { class: "notice" }, icon(iconName, "ic ic-big"), h("p", { class: "notice-title" }, title), text && h("p", {}, text), ...extra);
}

function topBar() {
  const news = S.about && (S.about.app_update || S.about.ytdlp_update);
  const gear = h("button", { class: `icon-btn${news ? " dot" : ""}`, type: "button", "aria-label": t("settings"), title: news ? t("settingsNew") : t("settings"), onclick: openSettings }, icon("sliders"));
  return h("header", { class: "top" }, h("h1", {}, t("title")), gear);
}

function bar() {
  const eligible = S.items.filter(startable);
  if (S.selecting) {
    const chosen = S.items.filter((i) => S.selected.has(i.url) && startable(i));
    return h("div", { class: "bar" }, h("button", {
      type: "button",
      disabled: chosen.length === 0,
      onclick: () => { start(chosen); S.selecting = false; S.selected.clear(); },
    }, chosen.length ? t("downloadSelected", chosen.length) : t("pickVideos")));
  }
  if (eligible.length < 2) return null;
  return h("div", { class: "bar" }, h("button", { type: "button", onclick: () => start(eligible) }, t("downloadAll", eligible.length)));
}

function pageView() {
  const n = S.items.length;
  const context = n
    ? h(
        "div",
        { class: "context" },
        h("span", {}, tn("count", n, S.host, n)),
        n > 1 && h("button", { class: "text-btn", type: "button", onclick: () => { S.selecting = !S.selecting; S.selected.clear(); render(); } }, S.selecting ? t("finish") : t("select")),
      )
    : null;
  const onPage = new Set(S.items.map((i) => i.url));
  const elsewhere = S.jobs.filter((j) => busy(j) && !onPage.has(j.url));
  const running = elsewhere.length
    ? [
        h("div", { class: "context" }, h("span", {}, t("downloadingNow"))),
        h("ul", { class: "list" }, ...elsewhere.map((job) => row({ title: job.title || job.url, sub: subText(job, hostOf(job.url)), thumbUrl: job.thumb, job, item: { url: job.url, label: job.title, thumb: job.thumb } }))),
      ]
    : null;
  const list = n
    ? h("ul", { class: "list" }, ...S.items.map((item) => {
        const job = jobFor(item.url);
        return row({ title: item.label, sub: subText(job, item.kind), err: job?.state === "error", thumbUrl: item.thumb, job, item, selectable: S.selecting });
      }))
    : notice("film", t("notFound"), t("notFoundHint"));
  return h("main", {}, compatibilityWarning(), running, context, list, bar());
}

function offlineView() {
  return h("main", {}, notice("alert", t("offlineTitle"), t("offlineHint"), h("button", { type: "button", onclick: poll }, t("retryBtn"))));
}

const incompatible = () => S.about !== null && S.about.api !== REQUIRED_API;

const compatibilityWarning = () =>
  incompatible() && h("div", { class: "warning" }, icon("alert"), h("div", {}, h("p", { class: "warning-title" }, t("incompatibleTitle")), h("p", {}, t("incompatibleHint"))));

const setRow = (label, control, { desc, stacked } = {}) =>
  stacked
    ? h("div", { class: "set-row stacked" }, h("p", {}, label), control)
    : h("div", { class: "set-row" }, h("div", {}, h("p", {}, label), desc && h("p", { class: "desc" }, desc)), control);

const group = (caption, ...rows) => [h("p", { class: "caption" }, caption), h("div", { class: "group" }, ...rows)];

async function update(patch) {
  const r = await api("PUT", "/settings", patch);
  if (r?.settings) S.settings = r.settings;
}

const toggleBox = (key) =>
  h("input", { type: "checkbox", role: "switch", switch: true, checked: !!S.settings[key], onchange: (e) => update({ [key]: e.target.checked }) });

const segmented = (key, options) => {
  const index = Math.max(0, options.findIndex(([value]) => String(S.settings[key]) === String(value)));
  const seg = h("div", { class: "seg", role: "radiogroup" });
  seg.style.setProperty("--n", options.length);
  seg.style.setProperty("--i", index);
  options.forEach(([value, name], i) =>
    seg.append(
      h(
        "label",
        {},
        h("input", {
          type: "radio",
          name: key,
          value: String(value),
          checked: i === index,
          onchange: () => {
            seg.style.setProperty("--i", i);
            update({ [key]: value });
          },
        }),
        h("span", {}, name),
      ),
    ),
  );
  return seg;
};

const inlineBox = () =>
  h("input", {
    type: "checkbox",
    role: "switch",
    switch: true,
    checked: S.inline,
    onchange: (e) => {
      S.inline = e.target.checked;
      browser.storage.local.set({ inline: S.inline });
    },
  });

async function updateYtdlp() {
  S.updating = true;
  render();
  await api("POST", "/update-ytdlp");
  S.updating = false;
  await loadAbout();
  await poll();
  render();
}

async function updateApp() {
  if (S.about?.bundled) {
    await api("POST", "/update-app");
    return;
  }
  const url = S.about?.latest_app?.url;
  if (url?.startsWith("https://github.com/")) browser.tabs.create({ url });
}

const openChangelog = () => browser.tabs.create({ url: `${RELEASES_URL}/v${browser.runtime.getManifest().version}` });

function versionFooter() {
  const a = S.about;
  const ext = browser.runtime.getManifest().version;
  const textBtn = (label, onclick, disabled) => h("button", { class: "text-btn", type: "button", disabled, onclick }, label);
  return h(
    "div",
    { class: "foot" },
    h("p", {}, `Damla ${ext}`, a?.app_update && [` · ${t("available", a.latest_app.version)} `, textBtn(a.bundled ? t("update") : t("openRelease"), updateApp)]),
    h("p", {}, `yt-dlp ${a?.ytdlp === null ? "…" : a?.ytdlp || "—"}`, a?.ytdlp_update && [` · ${t("available", a.latest_ytdlp.version)} `, textBtn(S.updating ? t("updating") : t("update"), updateYtdlp, S.updating)]),
    a && a.helper !== ext && h("p", {}, t("outOfSync", a.helper)),
    h("p", {}, textBtn(t("checkUpdates"), updateApp), " · ", textBtn(t("whatsNew"), openChangelog)),
  );
}

function settingsView() {
  const s = S.settings;
  const head = h(
    "header",
    { class: "top settings" },
    h("button", { class: "icon-btn", type: "button", "aria-label": t("back"), onclick: closeSettings }, icon("back")),
    h("h1", {}, t("settings")),
    h("span"),
  );
  if (!s) return [head, h("main", {}, notice("alert", t("loadFailed"), t("unreachable")))];
  const pickFolder = async () => {
    const r = await api("POST", "/pick-folder", { prompt: t("chooseFolder") });
    if (r?.settings) {
      S.settings = r.settings;
      render();
    }
  };
  const body = h(
    "main",
    {},
    ...group(t("saveLocation"), setRow(s.folder_label, h("button", { type: "button", onclick: pickFolder }, t("change")))),
    ...group(
      t("video"),
      setRow(t("resolution"), segmented("quality", [["best", t("best")], ["1080", "1080p"], ["720", "720p"], ["audio", t("audio")]]), { stacked: true }),
      setRow(t("format"), segmented("codec", [["auto", t("formatAuto")], ["compat", t("formatCompat")]])),
    ),
    ...group(
      t("downloadsGroup"),
      setRow(t("atOnce"), segmented("concurrent", [[1, "1"], [2, "2"], [3, "3"], [4, "4"]])),
      setRow(t("bySite"), toggleBox("by_site")),
      setRow(t("revealWhenDone"), toggleBox("reveal")),
      setRow(t("inlineButton"), inlineBox()),
      setRow(t("useSession"), toggleBox("cookies"), { desc: t("useSessionDesc") }),
    ),
    versionFooter(),
  );
  return [head, body];
}

function render() {
  const app = document.getElementById("app");
  const scroll = app.querySelector("main")?.scrollTop ?? 0;
  if (S.view === "settings") app.replaceChildren(...settingsView());
  else if (S.offline) app.replaceChildren(offlineView());
  else app.replaceChildren(topBar(), pageView());
  const main = app.querySelector("main");
  if (main) main.scrollTop = scroll;
}

async function loadAbout() {
  const r = await api("GET", "/about");
  S.about = r?.helper ? r : null;
}

const MIN_SETTINGS_HEIGHT = 530;

async function openSettings() {
  const app = document.getElementById("app");
  app.style.blockSize = `${Math.max(app.offsetHeight, MIN_SETTINGS_HEIGHT)}px`;
  S.view = "settings";
  S.selecting = false;
  render();
  const [r, stored] = await Promise.all([api("GET", "/settings"), browser.storage.local.get({ inline: true }), loadAbout()]);
  S.settings = r?.settings ?? null;
  S.inline = stored.inline;
  render();
}

function closeSettings() {
  document.getElementById("app").style.removeProperty("block-size");
  S.view = "list";
  render();
}

async function poll() {
  clearTimeout(timer);
  const wasOffline = S.offline;
  const r = await api("GET", "/jobs");
  S.offline = !!r?.offline;
  S.jobs = r?.jobs ?? [];
  S.ytdlp = r?.ytdlp ?? S.ytdlp;
  if (S.view !== "settings" || S.offline !== wasOffline) render();
  if (S.jobs.some(busy)) timer = setTimeout(poll, 1000);
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    S.host = hostOf(tab.url);
    S.items = (await browser.tabs.sendMessage(tab.id, { type: "scan" })) ?? [];
  } catch {
    S.items = [];
  }
  await Promise.all([poll(), loadAbout()]);
  render();
}

document.documentElement.lang = LANG;
init();
