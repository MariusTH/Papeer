import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { isTauri } from "../platform";

export type ThemeChoice = "auto" | "light" | "sepia" | "dark";
export type Theme = Exclude<ThemeChoice, "auto">;
export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
];

const KEY = "theme";

function load(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v && THEME_CHOICES.some((c) => c.value === v)) return v as ThemeChoice;
  } catch {
    // storage unavailable: fall through to default
  }
  return "sepia";
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Theme choice (persisted per machine) and the resolved theme applied to <html data-theme>. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(load);
  const [dark, setDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const theme: Theme = choice === "auto" ? (dark ? "dark" : "sepia") : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // ignore
    }
    // Match the native title bar.
    if (isTauri) getCurrentWindow().setTheme(theme === "dark" ? "dark" : "light").catch(() => {});
  }, [theme, choice]);

  return { choice, setChoice, theme };
}
