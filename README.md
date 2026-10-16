# Modes

Two modes for one Windows PC: **WORK** and **FREE TIME**. Each mode has its own blocked programs and its own programs to open, and work always ends with a short check-out of what got done.

- **Start work:** write one goal ("Finish the sync conflict fix") and, if you like, a **focus lock** (25, 50 or 90 min) during which work cannot be ended. Programs blocked in WORK (by default Steam, Epic Games, Discord) are closed and stay closed, tabs of blocked sites (say youtube.com) are closed, and WORK's startup items open (an IDE, a folder, a link…).
- **During work:** Modes measures which program is in front (not while you are idle for 5+ minutes) and counts every blocked program or site you tried to open. The work blocklists cannot be loosened until work ends, and the tray has no Quit.
- **End work:** the check-out shows your goal next to where the time actually went (e.g. code 1h 20m, chrome 25m) and what got blocked (steam ×2), and asks *Done / Partly / Not done* plus an optional next step. The next step is filled in as your next goal. Started by mistake? In the first 2 minutes you can leave without a log entry. *Skip check-out* exists but is logged.
- **Free time:** programs and sites you block in FREE TIME (say Slack and Teams, so work stays out of your evening) are closed, and its startup items open. The lists start empty.
- **Breaks:** take 5, 10 or 15 minutes inside a work session. Nothing is blocked or measured, and work goes on by itself when the break is over (with a notification). Breaks are left out of work time.
- **Work hours (optional):** on your work days Modes asks you to start work at the start time (or when the PC comes on later), and to check out at the end time.
- **Anywhere:** Ctrl+Alt+M starts or ends work; the tray shows the mode and your goal.
- **LOG** shows the week (sessions, work time, time at the PC, a done score where partly counts half, and your streak: work days in a row with a session done), work per day for the last 7 days, and every session (each can be deleted). **EXPORT CSV** saves the whole log to Downloads, for a spreadsheet or as proof of the work.

A blocked program is first asked to close, like clicking its X (so it can ask to save), and is ended 4 seconds later if it is still running. Programs run as administrator cannot be closed. Windows itself and Modes are never blocked.

A blocked site's tab is closed with Ctrl+W when it has been in front for 2 seconds in Chrome, Edge, Firefox, Brave, Opera, Vivaldi, Arc and other common browsers. Modes recognises it from the tab title ("Video - YouTube - Google Chrome"), so a page whose title does not name the site gets through, a page about YouTube on another site does not get closed, and a background tab playing audio is not touched.

## Install

Download `Modes-x.y.z-setup.exe` from **Releases**. It installs per-user, with no admin rights. If SmartScreen warns, click *More info → Run anyway*. Modes starts with Windows in the tray (Settings in RULES turns that off), in the mode you were in, and opens that mode's startup items.

## Privacy

Everything stays on this PC (the app's local storage). Only program file names are measured, only during work. Browser tab titles are read only to find blocked sites, and never kept.

## Develop

```sh
npm install
npm run dev          # browser at http://localhost:5173 (no blocking there; the UI works)
npm test             # unit tests (sessions, lock, breaks, schedule, sites, saved state, export)
npm run e2e          # builds, then clicks through the app in Chromium with a fake Windows side
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
| `src-tauri/src/rules.rs` | What to close and when (`Enforcer`), sites in tab titles (`site_in_title`, `SiteGuard`), program time (`Tally`). Pure, tested. |
| `src-tauri/src/win.rs` | Windows calls: processes, closing, the window in front, Ctrl+W, idle time, opening items. |
| `src-tauri/src/lib.rs` | Tauri shell: commands, the 1 s thread, tray, start with Windows. |
