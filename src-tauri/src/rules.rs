//! The parts of Modes that decide things, with no Tauri and no Windows calls, so they build and are
//! tested on any system: which blocked programs to close (`Enforcer`) and how long each program was in
//! front during work (`Tally`). `win.rs` does the looking and closing; `lib.rs` runs both once a tick.

use std::collections::{HashMap, HashSet};

/// Windows itself and Modes: never closed, whatever the rules say. Mirrors `PROTECTED` in src/core/programs.ts.
pub const PROTECTED: &[&str] = &[
    "system",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "dwm.exe",
    "explorer.exe",
    "sihost.exe",
    "fontdrvhost.exe",
    "ctfmon.exe",
    "conhost.exe",
    "taskmgr.exe",
    "lockapp.exe",
    "logonui.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "textinputhost.exe",
    "runtimebroker.exe",
    "msedgewebview2.exe",
    "modes.exe",
];

pub fn protected(app: &str) -> bool {
    PROTECTED.contains(&app)
}

/// Programs that are the lock screen or a system overlay: time in front of them is not work.
const NOT_WORK: &[&str] = &[
    "lockapp.exe",
    "logonui.exe",
    "searchhost.exe",
    "searchapp.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "textinputhost.exe",
    "modes.exe",
];

/// Lower-case file name of a program's path: `C:\Games\Steam.EXE` is `steam.exe`.
pub fn app_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_lowercase()
}

/// A blocked program first gets this long to close its windows by itself (and save), then it is ended.
pub const GRACE_MS: f64 = 4_000.0;

#[derive(Debug, PartialEq, Clone)]
pub enum Action {
    /// Ask the program's windows to close, like clicking X.
    Close(u32, String),
    /// End the process.
    Kill(u32, String),
}

/// Closes blocked programs: first politely, after `GRACE_MS` for good.
#[derive(Default)]
pub struct Enforcer {
    /// Processes already asked to close: pid → (program, when).
    asked: HashMap<u32, (String, f64)>,
}

impl Enforcer {
    /// One look at the running processes (`pid`, program). `own_pid` is Modes itself.
    pub fn step(&mut self, now: f64, procs: &[(u32, String)], blocked: &HashSet<String>, own_pid: u32) -> Vec<Action> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for (pid, app) in procs {
            // 0 and 4 are the idle and system processes.
            if *pid == 0 || *pid == 4 || *pid == own_pid || protected(app) || !blocked.contains(app) {
                continue;
            }
            seen.insert(*pid);
            match self.asked.get(pid) {
                // A pid can be reused by another program: then it is a new process.
                Some((a, at)) if a == app => {
                    if now - at >= GRACE_MS {
                        out.push(Action::Kill(*pid, app.clone()));
                    }
                }
                _ => {
                    self.asked.insert(*pid, (app.clone(), now));
                    out.push(Action::Close(*pid, app.clone()));
                }
            }
        }
        // Gone, or no longer blocked.
        self.asked.retain(|pid, _| seen.contains(pid));
        out
    }

    pub fn clear(&mut self) {
        self.asked.clear();
    }
}

/// No keyboard or mouse input for this long: the user is away, the time is not counted.
pub const IDLE_MS: u32 = 5 * 60_000;

/// A gap between two ticks longer than this means the PC was asleep (or the process stalled).
const MAX_GAP_MS: f64 = 5_000.0;

/// Milliseconds each program was in front, since the last `take`.
#[derive(Default)]
pub struct Tally {
    totals: HashMap<String, f64>,
    last: f64,
}

impl Tally {
    /// One look at the screen: the program in front, or `None` when nothing counts (not tracking, idle).
    pub fn tick(&mut self, now: f64, front: Option<&str>) {
        let gap = now - self.last;
        self.last = now;
        let Some(app) = front else { return };
        if app.is_empty() || NOT_WORK.contains(&app) || gap <= 0.0 || gap > MAX_GAP_MS {
            return;
        }
        *self.totals.entry(app.to_string()).or_insert(0.0) += gap;
    }

    pub fn take(&mut self) -> HashMap<String, f64> {
        std::mem::take(&mut self.totals)
    }
}

/// Browsers whose tab titles are checked for blocked sites.
pub const BROWSERS: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "opera_gx.exe",
    "vivaldi.exe",
    "arc.exe",
    "chromium.exe",
    "librewolf.exe",
    "waterfox.exe",
    "zen.exe",
    "floorp.exe",
];

pub fn is_browser(app: &str) -> bool {
    BROWSERS.contains(&app)
}

/// The blocked site a browser window title shows, if any: the title is split into its parts
/// ("Some video - YouTube - Google Chrome" has "youtube"), and a part that is one of `keys`
/// (lower case, from `siteKeys` in src/core/programs.ts) matches. A notification count like "(3)"
/// and Edge's "and 2 more pages" are ignored.
pub fn site_in_title(title: &str, keys: &HashSet<String>) -> Option<String> {
    if keys.is_empty() {
        return None;
    }
    let lower = title.to_lowercase();
    let mut parts = vec![lower.as_str()];
    for sep in [" - ", " \u{2013} ", " \u{2014} ", " | ", " / ", " \u{b7} ", " : "] {
        parts = parts.into_iter().flat_map(|p| p.split(sep)).collect();
    }
    parts.into_iter().find_map(|p| {
        let mut p = p.trim();
        // "(3) YouTube"
        if p.starts_with('(') {
            if let Some(i) = p.find(") ") {
                if p[1..i].chars().all(|c| c.is_ascii_digit() || c == '+') {
                    p = p[i + 2..].trim();
                }
            }
        }
        // Edge: "YouTube and 2 more pages"
        if let Some(i) = p.find(" and ") {
            if p.ends_with(" more pages") || p.ends_with(" more page") {
                p = p[..i].trim();
            }
        }
        keys.contains(p).then(|| p.to_string())
    })
}

/// Closes browser tabs of blocked sites: only after the same window showed one for two ticks in a
/// row, so a title flashing by while switching tabs closes nothing.
#[derive(Default)]
pub struct SiteGuard {
    seen: Option<(isize, String)>,
}

impl SiteGuard {
    /// One look at the window in front (`hwnd`, program, title). Returns the site to close the tab of.
    pub fn step(&mut self, front: Option<(isize, &str, &str)>, keys: &HashSet<String>) -> Option<String> {
        let hit = front.and_then(|(hwnd, app, title)| {
            if is_browser(app) {
                site_in_title(title, keys).map(|s| (hwnd, s))
            } else {
                None
            }
        });
        match (hit, self.seen.take()) {
            (Some(h), Some(prev)) if h == prev => Some(h.1),
            (Some(h), _) => {
                self.seen = Some(h);
                None
            }
            (None, _) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    fn procs(list: &[(u32, &str)]) -> Vec<(u32, String)> {
        list.iter().map(|(p, a)| (*p, a.to_string())).collect()
    }

    #[test]
    fn asks_first_then_ends_after_the_grace_time() {
        let mut e = Enforcer::default();
        let blocked = set(&["steam.exe"]);
        let ps = procs(&[(10, "steam.exe"), (11, "code.exe")]);
        assert_eq!(e.step(0.0, &ps, &blocked, 1), vec![Action::Close(10, "steam.exe".into())]);
        assert!(e.step(1_000.0, &ps, &blocked, 1).is_empty());
        assert_eq!(e.step(GRACE_MS, &ps, &blocked, 1), vec![Action::Kill(10, "steam.exe".into())]);
        // It closed: a new start is asked again first.
        assert!(e.step(5_000.0, &procs(&[(11, "code.exe")]), &blocked, 1).is_empty());
        assert_eq!(
            e.step(6_000.0, &procs(&[(12, "steam.exe")]), &blocked, 1),
            vec![Action::Close(12, "steam.exe".into())]
        );
    }

    #[test]
    fn never_touches_windows_itself_or_modes() {
        let mut e = Enforcer::default();
        let blocked = set(&["explorer.exe", "svchost.exe", "modes.exe", "game.exe"]);
        let ps = procs(&[(0, "game.exe"), (4, "system"), (20, "explorer.exe"), (21, "svchost.exe"), (22, "game.exe")]);
        assert_eq!(e.step(0.0, &ps, &blocked, 22), vec![]);
    }

    #[test]
    fn a_reused_pid_or_a_lifted_rule_starts_over() {
        let mut e = Enforcer::default();
        let blocked = set(&["a.exe", "b.exe"]);
        e.step(0.0, &procs(&[(30, "a.exe")]), &blocked, 1);
        assert_eq!(e.step(GRACE_MS, &procs(&[(30, "b.exe")]), &blocked, 1), vec![Action::Close(30, "b.exe".into())]);
        // The rule is lifted: forgotten, and asked again only after it is blocked again.
        assert!(e.step(GRACE_MS + 1.0, &procs(&[(30, "b.exe")]), &set(&[]), 1).is_empty());
        assert_eq!(
            e.step(GRACE_MS * 3.0, &procs(&[(30, "b.exe")]), &blocked, 1),
            vec![Action::Close(30, "b.exe".into())]
        );
    }

    #[test]
    fn tallies_time_in_front_without_sleep_or_overlays() {
        let mut t = Tally::default();
        t.tick(100_000.0, Some("code.exe")); // the first tick only sets the clock
        t.tick(101_000.0, Some("code.exe"));
        t.tick(102_000.0, Some("code.exe"));
        t.tick(103_000.0, Some("chrome.exe"));
        t.tick(104_000.0, None);
        t.tick(105_000.0, Some("lockapp.exe"));
        t.tick(3_700_000.0, Some("code.exe")); // after an hour asleep
        t.tick(3_701_000.0, Some("modes.exe"));
        let got = t.take();
        assert_eq!(got.len(), 2);
        assert_eq!(got["code.exe"], 2_000.0);
        assert_eq!(got["chrome.exe"], 1_000.0);
        assert!(t.take().is_empty());
    }

    fn keys(k: &[&str]) -> HashSet<String> {
        k.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn finds_blocked_sites_in_tab_titles() {
        let k = keys(&["youtube.com", "youtube", "reddit", "x"]);
        assert_eq!(site_in_title("Rust in 100 seconds - YouTube - Google Chrome", &k), Some("youtube".into()));
        assert_eq!(site_in_title("(3) YouTube - Mozilla Firefox", &k), Some("youtube".into()));
        assert_eq!(site_in_title("Home / X \u{2014} Mozilla Firefox", &k), Some("x".into()));
        assert_eq!(
            site_in_title("Rust in 100 seconds - YouTube and 2 more pages - Personal - Microsoft\u{200b} Edge", &k),
            Some("youtube".into())
        );
        assert_eq!(site_in_title("r/rust : Reddit", &k), Some("reddit".into()));
        // A page about YouTube, YouTube Music, an empty list: not blocked.
        assert_eq!(site_in_title("How YouTube works - Wikipedia - Google Chrome", &keys(&["reddit"])), None);
        assert_eq!(site_in_title("YouTube Music - Google Chrome", &k), None);
        assert_eq!(site_in_title("Notes about youtube.com - Google Docs - Google Chrome", &k), None);
        assert_eq!(site_in_title("youtube.com/watch?v=1 - Google Chrome", &k), None);
        assert_eq!(site_in_title("youtube.com - Google Chrome", &k), Some("youtube.com".into()));
        assert_eq!(site_in_title("YouTube - Google Chrome", &HashSet::new()), None);
    }

    #[test]
    fn closes_a_tab_only_after_two_looks_at_the_same_window() {
        let k = keys(&["youtube"]);
        let mut g = SiteGuard::default();
        let yt = Some((7isize, "chrome.exe", "Video - YouTube - Google Chrome"));
        assert_eq!(g.step(yt, &k), None);
        assert_eq!(g.step(yt, &k), Some("youtube".into()));
        // Right after closing it starts over.
        assert_eq!(g.step(yt, &k), None);
        assert_eq!(g.step(Some((7, "chrome.exe", "Docs - Google Chrome")), &k), None);
        assert_eq!(g.step(yt, &k), None);
        // Another window, or not a browser.
        assert_eq!(g.step(Some((8, "chrome.exe", "Video - YouTube - Google Chrome")), &k), None);
        let mut g = SiteGuard::default();
        let editor = Some((9isize, "code.exe", "notes - YouTube - Visual Studio Code"));
        assert_eq!(g.step(editor, &k), None);
        assert_eq!(g.step(editor, &k), None);
    }

    #[test]
    fn names_are_the_lower_case_file_name() {
        assert_eq!(app_name(r"C:\Program Files (x86)\Steam\Steam.EXE"), "steam.exe");
        assert_eq!(app_name("code.exe"), "code.exe");
        assert!(protected("explorer.exe"));
        assert!(!protected("steam.exe"));
    }
}
