const HELPER = "http://127.0.0.1:7560";

async function request(method, path, body) {
  try {
    const r = await fetch(HELPER + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return { offline: true };
  }
}

let tracking = false;

async function trackBadge() {
  if (tracking) return;
  tracking = true;
  try {
    for (;;) {
      const r = await request("GET", "/jobs");
      const jobs = r.jobs ?? [];
      const active = jobs.filter((j) => j.state === "queued" || j.state === "running").length;
      await browser.action.setBadgeText({ text: active ? String(active) : "" });
      for (const tab of await browser.tabs.query({})) {
        browser.tabs.sendMessage(tab.id, { type: "jobs", jobs }).catch(() => {});
      }
      if (!active) break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  } catch {
  } finally {
    tracking = false;
  }
}

browser.runtime.onMessage.addListener(async ({ api }) => {
  if (!api) return;
  const r = await request(api.method, api.path, api.body);
  if (api.method === "POST" && api.path === "/jobs" && !r.offline) trackBadge();
  return r;
});

const ICON_ON = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png" };
const ICON_OFF = { 16: "icons/off-16.png", 32: "icons/off-32.png", 48: "icons/off-48.png" };
const setIcon = (tabId, found) => browser.action.setIcon({ tabId, path: found ? ICON_ON : ICON_OFF }).catch(() => {});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "found" && sender.tab) setIcon(sender.tab.id, msg.found);
});

browser.tabs.onUpdated.addListener((tabId, { status }) => {
  if (status === "loading") setIcon(tabId, false);
});
