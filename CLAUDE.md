# Modes: notes for Claude

A sibling of TimeTrack (`naglimantas/time-tracker`): same stack, same look, same rules for the look.

## Stack

- React 19 + TypeScript 7 (native `tsc`), Vite 8, Vitest 5. Windows only: Tauri v2 (`src-tauri/`).
- No Rust or Windows on the dev box is assumed. Before pushing: `npx tsc --noEmit && npx vitest run && npx vite build`.
- Rust in a Linux container: `rules.rs` has no Tauri or Windows types, so `cargo test` works in a scratch crate that `#[path]`-includes it. The full crate checks with `rustup target add x86_64-pc-windows-gnu` and `cargo check --target x86_64-pc-windows-gnu` (with a stub `x86_64-w64-mingw32-windres` on PATH that writes an empty file for `-o`, and a `dist/` folder present). Run `cargo clippy` the same way; `rustfmt.toml` sets `max_width = 160`.
- CI (`.github/workflows/ci.yml`) runs the web tests and build, and `cargo test` on Windows. A release is a `vX.Y.Z` tag matching `package.json` (also bump `src-tauri/Cargo.toml`).

## Model (`src/core/`)

- `State` (`model.ts`): `mode` (`work` | `free`), `since`, per-mode `rules` (`blocked` exe names, sorted, lower case; `startup` items `{target, args}`), `current` (the running `WorkSession`, only in work), `log` (finished sessions, newest first, max 1000), `settings` (`autostart`, `openStartup`).
- All changes are pure functions with explicit `now`: `startWork` (needs a goal), `checkOut` (outcome `done` | `partly` | `not` | `skipped` plus next step), `cancelWork` (only in the first 2 min, no log entry), `addUsage`, `setRules`. `suggestedGoal` is the last non-skipped next step.
- Saved in localStorage `modes-state` on every change and on `beforeunload`. `parseState` (`store.ts`) never throws: broken data falls back to defaults, work without a session becomes free time, protected names are dropped from blocklists.
- `PROTECTED` exists twice and must stay the same: `src/core/programs.ts` and `src-tauri/src/rules.rs`. The app's own exe is `modes.exe` (`mainBinaryName`).

## Windows side (`src-tauri/src/`)

- The web app owns the state; Rust only follows it. `set_mode` (mode, label, blocked, tracking) is sent after every mode or blocklist change.
- One thread, every second: `Tally::tick` with the foreground program (only while tracking and not idle 5+ min; gaps over 5 s, overlays and `modes.exe` do not count). Every 2 s: `Enforcer::step` over all processes: `Close` (WM_CLOSE to visible top-level windows) first, `Kill` (TerminateProcess) after `GRACE_MS` (4 s). Closed programs emit `blocked` and, when the window is not in front, a notification (once per program per 20 s).
- `take_usage` hands over the tally; the UI takes it every 10 s during work, right before check-out, and once at start (to drop stray time).
- `open_item` uses ShellExecuteW (programs, shortcuts, files, folders, URLs). It is a sync command so it runs on the main thread.
- The window starts hidden; it is shown unless started with `--minimized` (autostart). `started_at_login` lets the UI open the mode's startup items after login. Closing the window hides it. The tray menu: status, Start/End work (emits `tray` `switch`), Open, and Quit only outside work.

## UI (`src/ui/`)

- Screens NOW, RULES, LOG (keys 1–3, not while typing). Dialogs: START WORK (goal, prefilled with `suggestedGoal`) and END WORK (goal, where the time went, outcome, next step). Both list the running programs the next mode will close.
- During work the WORK blocklist can only grow (no × buttons).
- Enter in a dialog input calls `preventDefault`: otherwise the same key press also clicks the button focus returns to when the dialog closes (found in testing: starting work opened END WORK).
- Browser checks: `npx vite preview` and playwright-core with `executablePath: '/opt/pw-browsers/chromium'` in the cloud container. To seed localStorage, abort the app's scripts while writing it, or `beforeunload` saves the old state over it.

## Design rules (as TimeTrack)

- JetBrains Mono, sharp corners, thin borders, no gradients or glows, never pure `#000`/`#fff`, warm graphite dark and paper light theme following the system. Each mode has one muted OKLCH accent (`--work`, `--free`). Animations are short and respect `prefers-reduced-motion`.
- Keep CLAUDE.md and `.claude/` tracked in git.
