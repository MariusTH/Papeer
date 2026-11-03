import { ask, message } from "@tauri-apps/plugin-dialog";

/** True inside the desktop app; false when running as a plain web page. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Yes/no question: a native dialog on desktop, `confirm()` on the web. */
export async function confirmDialog(text: string, opts: { title?: string; okLabel?: string; cancelLabel?: string } = {}) {
  if (isTauri) return ask(text, { kind: "warning", ...opts });
  return window.confirm(opts.title ? `${opts.title}\n\n${text}` : text);
}

export async function errorDialog(text: string) {
  if (isTauri) await message(text, { kind: "error" });
  else window.alert(text);
}
