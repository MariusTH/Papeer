# Papeer

--------------------------------
| AI GENERATED, like all of it |
--------------------------------

*Papeer* — Norwegian dialect for *papir*, paper. Handwrite on PDFs with a pen tablet, reMarkable-style. Desktop app for macOS, Windows and Linux, plus a web version for testing.

- Open a PDF or start a blank notebook, and write with pressure-sensitive pens: fineliner, ballpoint, fountain pen, brush, pencil. A highlighter is included.
- Pages grow downward when you write near the bottom, so each page can have its own length.
- A notes margin beside every page holds your own notes; they are never exported.
- Page thumbnails, tabs for several documents, and a stroke eraser. Flip the pen to erase (macOS).
- Lasso select & move, undo/redo, and Light / Sepia / Dark themes.
- **Autosave**: every document is saved continuously, and open tabs reopen on launch.
  - Desktop: saved to `Documents/Papeer/*.inkpdf`, an editable project (zip of the original PDF + strokes).
  - Web: saved in the browser's localStorage. Use **Download** to keep a copy.
- **Export PDF**: flattened output. Original pages stay vector and selectable, and ink is vector paths.

## Install

Download the installer for your system from [Releases](../../releases).

- **macOS:** open the `.dmg` and drag the app to Applications. The app isn't signed yet, so after the first launch attempt go to **System Settings → Privacy & Security → Open Anyway**.
- **Windows:** run the `-setup.exe`. If SmartScreen warns, choose **More info → Run anyway**.
- **Linux:** `.AppImage` or `.deb`.

The web version runs on GitHub Pages. It's for testing: browser storage holds only a few MB, and pen-flip eraser detection is desktop-only.

## Develop

```sh
pnpm install
pnpm tauri dev     # desktop app with hot reload
pnpm dev           # web version at http://localhost:1420 (autosaves to localStorage)
pnpm test          # unit, export and storage tests
pnpm typecheck
pnpm app           # build the macOS .app locally (src-tauri/target/release/bundle/macos)
```

## Releasing

1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json`).
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Release** workflow builds macOS (universal), Windows and Linux installers and attaches them to a **draft** release. Review it on GitHub and publish it.

Every push to `main` runs tests (**CI**) and deploys the web version (**Web (GitHub Pages)**).

## Shortcuts

| Key | Action |
| --- | --- |
| P / H / E / L | Pen / Highlighter / Eraser / Lasso |
| ⌘Z / ⇧⌘Z | Undo / Redo |
| ⌘O / ⌘S / ⇧⌘S / ⌘E | Open / Save now / Save As (web: Download) / Export PDF |
| ⌘T, ⌘W, Ctrl+Tab, ⌘1–9 | New tab, close tab, next tab, go to tab (desktop) |
| ⌥⌘T / ⌥⌘M | Toggle page thumbnails / notes margin |
| ⇧⌘N | Insert blank page after current |
| ⌘= / ⌘- / ⌘0, pinch, ⌘-scroll | Zoom in / out / fit width |
| Delete, Esc | Delete / clear lasso selection |

The pen's eraser end or barrel button erases. Finger/touch input is ignored (palm rejection).

## Layout

- `src/model`: types, pure document ops (auto-extend, notes, move, erase), undo history, zustand store with tabs
- `src/ink`: brushes and pressure curve, stroke outlines (perfect-freehand + spline, shared by screen and export), hit testing
- `src/canvas`: page rendering (pdf.js background, ink and live canvases), pen input, native tablet events
- `src/pdf`: pdf.js loading, pdf-lib export
- `src/io`: `.inkpdf` format, autosave, storage (files on desktop, localStorage on web), file pickers
- `src-tauri`: Rust shell; `tablet.rs` reads macOS tablet events (pen/eraser proximity, pressure)
- `app-icon/icon.svg`: source for all app icons (`pnpm tauri icon app-icon/icon.svg`)
