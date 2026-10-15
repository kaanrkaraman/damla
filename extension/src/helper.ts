import type { Reply } from "./types";

export const HELPER = "http://127.0.0.1:7560";

export async function request(method: string, path: string, body?: unknown): Promise<Reply> {
  try {
    const response = await fetch(HELPER + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await response.json()) as Reply;
  } catch {
    return { offline: true };
  }
}
