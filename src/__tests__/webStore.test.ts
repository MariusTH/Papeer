import { beforeEach, describe, expect, it } from "vitest";

/** Minimal localStorage with a size quota, like a browser's. */
class FakeStorage {
  map = new Map<string, string>();
  constructor(private quota = Infinity) {}
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    const size = [...this.map].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
    if (size + k.length + v.length > this.quota) throw new DOMException("exceeded", "QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const { webStore } = await import("../io/storage");

describe("web document store (localStorage)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new FakeStorage();
  });

  it("round-trips binary documents", async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    const path = await webStore.newPath("Notes");
    expect(path).toBe("browser/Notes.inkpdf");
    await webStore.write(path, bytes);
    expect(Array.from((await webStore.read(path))!)).toEqual(Array.from(bytes));
    expect(await webStore.read("browser/missing.inkpdf")).toBeNull();
  });

  it("never reuses a name that is taken", async () => {
    await webStore.write(await webStore.newPath("Notes"), new Uint8Array([1]));
    expect(await webStore.newPath("Notes")).toBe("browser/Notes 2.inkpdf");
    expect(await webStore.newPath("a/b:c")).toBe("browser/a-b-c.inkpdf");
  });

  it("stores the session", async () => {
    await webStore.writeSession('{"files":[]}');
    expect(await webStore.readSession()).toBe('{"files":[]}');
  });

  it("explains a full storage quota and keeps the previous version", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new FakeStorage(2000);
    const path = await webStore.newPath("Notes");
    await webStore.write(path, new Uint8Array([1, 2, 3]));
    await expect(webStore.write(path, new Uint8Array(5000))).rejects.toThrow(/storage is full/);
    expect(Array.from((await webStore.read(path))!)).toEqual([1, 2, 3]);
  });
});
