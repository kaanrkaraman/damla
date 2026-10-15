const HELPER = "http://127.0.0.1:8791";

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
