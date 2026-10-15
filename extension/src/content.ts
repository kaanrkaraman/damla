import { Overlay } from "./overlay";
import { collectPosts, toItems } from "./scrape";
import type { ContentMessage } from "./types";

const SWEEP_DELAY_MS = 300;
const SWEEP_EVERY_MS = 1500;

const overlay = new Overlay();
let reported: boolean | null = null;
let sweepTimer = 0;

function sweep(): void {
  const posts = collectPosts();
  const found = posts.length > 0;
  if (found !== reported) {
    reported = found;
    void browser.runtime.sendMessage({ type: "found", found });
  }
  if (!overlay.enabled) return;
  for (const post of posts) if (post.mount) overlay.attach(post.mount, post);
}

browser.runtime.onMessage.addListener((message: ContentMessage | { type: "scan" }) => {
  if (message.type === "scan") return Promise.resolve(toItems(collectPosts()));
  if (message.type === "jobs") overlay.applyJobs(message.jobs);
  return undefined;
});

new MutationObserver(() => {
  clearTimeout(sweepTimer);
  sweepTimer = window.setTimeout(sweep, SWEEP_DELAY_MS);
}).observe(document.body, { childList: true, subtree: true });
setInterval(sweep, SWEEP_EVERY_MS);

browser.storage.local.get({ inline: true }).then(({ inline }) => {
  overlay.setInline(inline !== false);
  sweep();
  void overlay.pull();
});

browser.storage.onChanged.addListener((changes) => {
  if (!changes.inline) return;
  overlay.setInline(changes.inline.newValue !== false);
  if (overlay.enabled) sweep();
});
