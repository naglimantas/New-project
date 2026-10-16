# Modes

Two modes for one Windows PC: **WORK** and **FREE TIME**. Each mode has its own blocked programs and its own programs to open, and work always ends with a short check-out of what got done.

- **Start work:** write one goal ("Finish the sync conflict fix"). Programs blocked in WORK (by default Steam, Epic Games, Discord) are closed and stay closed, and WORK's startup items open (an IDE, a folder, a link…).
- **During work:** Modes measures which program is in front (not while you are idle for 5+ minutes). The work blocklist cannot be loosened until work ends, and the tray has no Quit.
- **End work:** the check-out shows your goal next to where the time actually went (e.g. code 1h 20m, chrome 25m), and asks *Done / Partly / Not done* plus an optional next step. The next step is filled in as your next goal. Started by mistake? In the first 2 minutes you can leave without a log entry. *Skip check-out* exists but is logged.
- **Free time:** programs you block in FREE TIME (say Slack and Teams, so work stays out of your evening) are closed, and its startup items open. The list starts empty.
- **LOG** shows every session and the week: sessions, time, time at the PC, and a done score (partly counts half).

A blocked program is first asked to close, like clicking its X (so it can ask to save), and is ended 4 seconds later if it is still running. Programs run as administrator cannot be closed. Windows itself and Modes are never blocked.

## Install

Download `Modes-x.y.z-setup.exe` from **Releases**. It installs per-user, with no admin rights. If SmartScreen warns, click *More info → Run anyway*. Modes starts with Windows in the tray (Settings in RULES turns that off), in the mode you were in, and opens that mode's startup items.

## Privacy

Everything stays on this PC (the app's local storage). Only program file names are measured, never window titles or content, and only during work.

## Develop

```sh
npm install
npm run dev          # browser at http://localhost:5173 (no blocking there; the UI works)
npm test             # unit tests (sessions, rules, saved state, week summary)
npm run build        # typecheck + production build to dist/
npm run tauri dev    # the Windows app (needs Rust)
```

## Release

1. Bump `version` in `package.json` and `src-tauri/Cargo.toml` and commit.
2. Run `git tag vX.Y.Z && git push --follow-tags`.

GitHub Actions (`.github/workflows/release.yml`) builds the Windows installer and attaches it to the release.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | State, work sessions, program names, saved state, week summary. No UI. |
| `src/ui/` | React UI: NOW, RULES and LOG screens, the start and check-out dialogs. |
| `src/platform/native.ts` | Calls into the Windows side; harmless stand-ins in a browser. |
| `src-tauri/src/rules.rs` | What to close and when (`Enforcer`), program time (`Tally`). Pure, tested. |
| `src-tauri/src/win.rs` | Windows calls: processes, closing, foreground program, idle time, opening items. |
| `src-tauri/src/lib.rs` | Tauri shell: commands, the 1 s thread, tray, start with Windows. |
