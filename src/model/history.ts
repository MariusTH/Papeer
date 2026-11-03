import { Page } from "./types";

/**
 * Snapshot history. Pages and strokes are immutable, so snapshots share
 * structure and are cheap.
 */
export interface History {
  past: Page[][];
  future: Page[][];
}

const LIMIT = 200;

export const emptyHistory = (): History => ({ past: [], future: [] });

export function record(h: History, before: Page[]): History {
  const past = [...h.past, before];
  if (past.length > LIMIT) past.shift();
  return { past, future: [] };
}

export function undo(h: History, current: Page[]): { history: History; pages: Page[] } | null {
  if (!h.past.length) return null;
  const pages = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, pages };
}

export function redo(h: History, current: Page[]): { history: History; pages: Page[] } | null {
  if (!h.future.length) return null;
  const [pages, ...future] = h.future;
  return { history: { past: [...h.past, current], future }, pages };
}
