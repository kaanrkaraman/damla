import { api } from "./api";
import { jobMessage, t, tn } from "./i18n";
import { isGeneric, type Post } from "./scrape";
import { isActive, type Job } from "./types";

type PinState = "idle" | "queued" | "running" | "done" | "error";

interface Pin {
  mount: Element;
  el: HTMLElement;
  url: string;
  label: string;
  thumb: string;
  clicked: boolean;
  pending: boolean;
  paint(): void;
}

const POLL_MS = 700;
const TRAY_MS = 3500;
const PIN_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"];

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

const ICON: Record<PinState, string> = {
  idle: '<path d="M8 2v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  queued: '<circle cx="8" cy="8" r="5.5" stroke-opacity=".35"/>',
  running: '<g class="spin"><circle cx="8" cy="8" r="5.5" stroke-opacity=".3"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"/></g>',
  done: '<path d="M3.5 8.5l3 3 6-6.5"/>',
  error: '<path d="M8 3v6M8 12.5v.01"/>',
};

const icon = (state: PinState): string => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[state]}</svg>`;

const labelFor = (state: PinState): string => {
  switch (state) {
    case "idle":
      return t("download");
    case "queued":
      return t("queued");
    case "running":
      return t("downloading");
    case "done":
      return t("downloadedLabel");
    case "error":
      return t("retry");
  }
};

const doneLabel = (count: number): string => (count === 1 ? t("trayDone") : tn("trayDoneMany", count, count));

function trayLabel(count: number, percent: number): string {
  if (count === 1) return percent ? t("trayDownloadingPct", percent) : t("trayDownloading");
  return percent ? tn("trayManyPct", count, count, percent) : tn("trayMany", count, count);
}

export class Overlay {
  private readonly jobs = new Map<string, Job>();
  private readonly pins = new Set<Pin>();
  private readonly attached = new WeakMap<Element, Pin>();
  private readonly layer = document.createElement("div");
  private readonly tray = document.createElement("div");
  private offline = false;
  private inline = true;
  private pollTimer = 0;
  private frame = 0;
  private trayTimer = 0;
  private tracked = new Set<string>();

  constructor() {
    for (const stale of document.querySelectorAll("damla-layer")) stale.remove();
    const host = document.createElement("damla-layer");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.layer.className = "root";
    this.tray.className = "tray";
    this.tray.hidden = true;
    this.layer.append(this.tray);
    root.append(style, this.layer);
    document.documentElement.append(host);
    addEventListener("scroll", () => this.schedule(), { capture: true, passive: true });
    addEventListener("resize", () => this.schedule());
    setInterval(() => this.schedule(), 400);
  }

  get enabled(): boolean {
    return this.inline;
  }

  setInline(on: boolean): void {
    this.inline = on;
    this.schedule();
  }

  applyJobs(list: Job[]): void {
    this.jobs.clear();
    for (const job of list) if (!this.jobs.has(job.url)) this.jobs.set(job.url, job);
    for (const pin of this.pins) pin.paint();
    this.updateTray(list);
    clearTimeout(this.pollTimer);
    if (list.some(isActive)) this.pollTimer = window.setTimeout(() => void this.pull(), POLL_MS);
  }

  async pull(): Promise<void> {
    const reply = await api("GET", "/jobs");
    this.offline = !!reply?.offline;
    this.applyJobs(reply?.jobs ?? []);
  }

  attach(mount: Element, post: Post): void {
    const known = this.attached.get(mount);
    if (known) {
      Object.assign(known, { url: post.url, label: post.label, thumb: post.thumb });
      known.paint();
      this.schedule();
      return;
    }
    const pin = this.createPin(mount, post);
    this.attached.set(mount, pin);
    this.pins.add(pin);
    this.layer.append(pin.el);
    pin.paint();
    this.schedule();
  }

  private createPin(mount: Element, post: Post): Pin {
    const el = document.createElement("div");
    el.className = "pin";
    el.hidden = true;
    const button = document.createElement("button");
    button.className = "glass";
    el.append(button);
    const pin: Pin = {
      mount,
      el,
      url: post.url,
      label: post.label,
      thumb: post.thumb,
      clicked: false,
      pending: false,
      paint: () => this.paintPin(pin, button),
    };
    for (const name of PIN_EVENTS) button.addEventListener(name, (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.onClick(pin);
    });
    return pin;
  }

  private paintPin(pin: Pin, button: HTMLButtonElement): void {
    const job = this.jobs.get(pin.url);
    if (job) pin.pending = false;
    const failed = pin.clicked && this.offline && !job;
    const state = this.stateOf(job, failed, pin.pending);
    button.dataset.state = state;
    button.disabled = state === "running" || state === "queued";
    button.innerHTML = icon(state);
    button.append(this.buttonText(state, job, failed));
    button.title = state === "done" ? t("reveal") : jobMessage(job?.msg);
  }

  private stateOf(job: Job | undefined, failed: boolean, pending: boolean): PinState {
    if (failed) return "error";
    const state = job?.state ?? (pending ? "queued" : "idle");
    return state === "cancelled" ? "idle" : state;
  }

  private buttonText(state: PinState, job: Job | undefined, failed: boolean): string {
    if (failed) return t("helperOff");
    if (state === "running" && job?.percent) return t("downloadingPct", job.percent);
    return labelFor(state);
  }

  private async onClick(pin: Pin): Promise<void> {
    const job = this.jobs.get(pin.url);
    if (job?.state === "done") {
      void api("POST", `/jobs/${job.id}/reveal`);
      return;
    }
    pin.clicked = true;
    pin.pending = true;
    pin.paint();
    const title = isGeneric(pin.label) ? "" : pin.label;
    const reply = await api("POST", "/jobs", { items: [{ url: pin.url, title, thumb: pin.thumb }] });
    if (reply?.offline) {
      pin.pending = false;
      this.offline = true;
    }
    void this.pull();
  }

  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.place());
  }

  private place(): void {
    this.frame = 0;
    for (const pin of this.pins) {
      if (!pin.mount.isConnected) {
        pin.el.remove();
        this.pins.delete(pin);
        continue;
      }
      const rect = pin.mount.getBoundingClientRect();
      const visible =
        this.inline &&
        rect.width > 120 &&
        rect.height > 80 &&
        rect.bottom > 40 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth;
      pin.el.hidden = !visible;
      if (visible)
        pin.el.style.transform = `translate(${Math.round(Math.max(rect.left, 0) + 10)}px, ${Math.round(Math.max(rect.top, 0) + 10)}px)`;
    }
  }

  private showTray(state: PinState, label: string, hideAfter?: number): void {
    clearTimeout(this.trayTimer);
    this.tray.hidden = false;
    this.tray.replaceChildren();
    const pill = document.createElement("div");
    pill.className = "glass";
    pill.dataset.state = state;
    pill.innerHTML = icon(state);
    pill.append(label);
    this.tray.append(pill);
    if (hideAfter) this.trayTimer = window.setTimeout(() => (this.tray.hidden = true), hideAfter);
  }

  private updateTray(list: Job[]): void {
    const active = list.filter(isActive);
    if (active.length) {
      for (const job of active) this.tracked.add(job.id);
      const total = active.reduce((sum, job) => sum + (job.state === "running" ? job.percent : 0), 0);
      this.showTray("running", trayLabel(active.length, Math.round(total / active.length)));
      return;
    }
    if (!this.tracked.size) return;
    const finished = list.filter((job) => this.tracked.has(job.id) && (job.state === "done" || job.state === "error"));
    this.tracked = new Set();
    if (!finished.length) this.tray.hidden = true;
    else if (finished.some((job) => job.state === "error")) this.showTray("error", t("trayFailed"), TRAY_MS);
    else this.showTray("done", doneLabel(finished.length), TRAY_MS);
  }
}
