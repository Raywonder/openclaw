import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "./storage";

describe("storage", () => {
  const originalGetItem = window.localStorage.getItem;
  const originalSetItem = window.localStorage.setItem;

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key: string) => store.get(key) ?? null);
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key: string, value: string) => {
      store.set(key, value);
      return null;
    });
  });

  afterEach(() => {
    window.localStorage.getItem = originalGetItem;
    window.localStorage.setItem = originalSetItem;
  });

  it("defaults chatAnnouncements to true", () => {
    const settings = loadSettings();
    expect(settings.chatAnnouncements).toBe(true);
  });

  it("persists chatAnnouncements changes", () => {
    const initial = loadSettings();
    const next = { ...initial, chatAnnouncements: false };
    saveSettings(next);

    const reloaded = loadSettings();
    expect(reloaded.chatAnnouncements).toBe(false);
  });
});
