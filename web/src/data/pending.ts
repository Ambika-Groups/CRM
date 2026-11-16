import { CommandError, type Page } from "@ag/core";
import type { DataSource } from "./types";

/**
 * Stands in while the real data source (demo or Firebase) is being loaded and started, so screens always have a
 * source to ask. It holds nothing and runs nothing; the provider shows its loading state meanwhile.
 */
export const pendingSource: DataSource = {
  mode: "demo",
  async init() {},
  session: () => null,
  subscribe: () => () => {},
  async get() { return null; },
  async docStatus() { return "missing"; },
  async getMany<T>(_c: string, ids: string[]) { return ids.map(() => null as T | null); },
  async query<T extends { id: string }>(): Promise<Page<T>> { return { items: [], next: null, total: 0 }; },
  async count() { return 0; },
  async listSmall<T>() { return [] as T[]; },
  async run() { throw Object.assign(new CommandError("Not ready yet."), { retry: true }); },
  async setPreference() {},
};
