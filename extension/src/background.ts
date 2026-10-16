import "./compat";
import { request } from "./helper";
import type { BackgroundMessage } from "./types";
import { isActive } from "./types";

const POLL_MS = 700;

const ICON_ON = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png" };
const ICON_OFF = { 16: "icons/off-16.png", 32: "icons/off-32.png", 48: "icons/off-48.png" };

let tracking = false;

async function trackBadge(): Promise<void> {
  if (tracking) return;
  tracking = true;
  try {
    for (;;) {
      const reply = await request("GET", "/jobs");
      const jobs = reply.jobs ?? [];
      const active = jobs.filter(isActive).length;
      await browser.action.setBadgeText({ text: active ? String(active) : "" });
      for (const tab of await browser.tabs.query({})) {
        if (tab.id !== undefined) browser.tabs.sendMessage(tab.id, { type: "jobs", jobs }).catch(() => {});
      }
      if (!active) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    tracking = false;
  }
}

const setIcon = (tabId: number, found: boolean) => browser.action.setIcon({ tabId, path: found ? ICON_ON : ICON_OFF }).catch(() => {});

browser.runtime.onMessage.addListener(
  (message: BackgroundMessage, sender: browser.runtime.MessageSender, sendResponse: (reply: unknown) => void) => {
    if ("type" in message) {
      if (sender.tab?.id !== undefined) setIcon(sender.tab.id, message.found);
      return undefined;
    }
    if (!("api" in message)) return undefined;
    const { method, path, body } = message.api;
    void request(method, path, body).then((reply) => {
      if (method === "POST" && path === "/jobs" && !reply.offline) void trackBadge();
      sendResponse(reply);
    });
    return true;
  },
);

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") setIcon(tabId, false);
});
