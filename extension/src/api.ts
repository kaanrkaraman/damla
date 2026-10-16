import { request } from "./helper";
import type { BackgroundMessage, Reply } from "./types";

// The popup is an extension page, so it can reach the helper itself; going through the
// background worker would wake it first. Content scripts are subject to the page's CORS rules.
const isExtensionPage = location.protocol.endsWith("-extension:");

export const api = (method: string, path: string, body?: unknown): Promise<Reply> =>
  isExtensionPage ? request(method, path, body) : browser.runtime.sendMessage({ api: { method, path, body } } satisfies BackgroundMessage);
