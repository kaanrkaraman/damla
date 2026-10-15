import type { BackgroundMessage, Reply } from "./types";

export const api = (method: string, path: string, body?: unknown): Promise<Reply> =>
  browser.runtime.sendMessage({ api: { method, path, body } } satisfies BackgroundMessage);
