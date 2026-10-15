export type JobState = "queued" | "running" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  url: string;
  title: string;
  thumb: string;
  state: JobState;
  percent: number;
  msg: string;
  file: string;
  finished: number;
}

export interface Item {
  url: string;
  label: string;
  thumb: string;
  kind: string;
  generic: boolean;
}

export interface Settings {
  folder: string;
  folder_label: string;
  quality: "best" | "1080" | "720" | "audio";
  codec: "auto" | "compat";
  concurrent: 1 | 2 | 3 | 4;
  by_site: boolean;
  cookies: boolean;
  reveal: boolean;
}

export interface ReleaseInfo {
  version: string;
  url: string;
}

export interface About {
  helper: string;
  api: number;
  ytdlp: string | null;
  latest_app: ReleaseInfo | null;
  latest_ytdlp: ReleaseInfo | null;
  app_update: boolean;
  ytdlp_update: boolean;
  checking: boolean;
  bundled: boolean;
}

export interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

export interface Reply {
  offline?: boolean;
  jobs?: Job[];
  ytdlp?: string;
  settings?: Settings;
  ok?: boolean;
  helper?: string;
}

export type BackgroundMessage = { api: ApiCall } | { type: "found"; found: boolean };
export type ContentMessage = { type: "jobs"; jobs: Job[] };

export const isActive = (job: Pick<Job, "state">): boolean => job.state === "queued" || job.state === "running";
