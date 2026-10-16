//! The Windows shell around the web app:
//!  - closing blocked programs while a mode is on (`rules::Enforcer`, every 2 s),
//!  - counting which program is in front during work (`rules::Tally`, every second),
//!  - opening startup items, listing running programs,
//!  - a tray icon with the mode and a menu, staying alive in the tray (closing the window only hides
//!    it) and starting with Windows.
//!
//! The web app owns the state. It calls `set_mode` after every change and takes the counted time
//! with `take_usage`; Rust tells it about tray clicks (`tray` event) and closed programs (`blocked`).

mod rules;
mod win;

use rules::{Action, Enforcer, Tally, IDLE_MS};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;

const TRAY_ID: &str = "modes-tray";

/// The same program is not reported as closed more often than this.
const NOTIFY_EVERY_MS: f64 = 20_000.0;

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

#[derive(Default)]
struct Shared {
    /// `work` or `free`.
    mode: Mutex<String>,
    /// The mode's name as the user sees it, for notifications.
    label: Mutex<String>,
    blocked: Mutex<HashSet<String>>,
    enforcer: Mutex<Enforcer>,
    tally: Mutex<Tally>,
    /// Program time is counted (only during work).
    tracking: AtomicBool,
    /// When each program was last reported as closed.
    notified: Mutex<HashMap<String, f64>>,
}

/// The web app's mode, after every change: what to block and whether to count program time.
#[tauri::command]
fn set_mode(app: AppHandle, mode: String, label: String, blocked: Vec<String>, tracking: bool, state: State<'_, Shared>) -> Result<(), String> {
    let set: HashSet<String> = blocked.iter().map(|b| b.to_lowercase()).filter(|b| !rules::protected(b)).collect();
    if let Ok(mut b) = state.blocked.lock() {
        *b = set;
    }
    state.tracking.store(tracking, Ordering::Relaxed);
    let changed = state.mode.lock().map(|mut m| std::mem::replace(&mut *m, mode.clone()) != mode).unwrap_or(true);
    if let Ok(mut l) = state.label.lock() {
        *l = label.clone();
    }
    if changed {
        if let Ok(mut e) = state.enforcer.lock() {
            e.clear();
        }
    }
    update_tray(&app, &mode, &label).map_err(|e| e.to_string())
}

/// Which of these programs are running now (to warn before they are closed).
#[tauri::command]
fn running_blocked(names: Vec<String>) -> Vec<String> {
    let names: HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut out: Vec<String> = win::processes()
        .into_iter()
        .map(|(_, a)| a)
        .filter(|a| names.contains(a) && !rules::protected(a))
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Programs with a window open now, to pick from when adding to a blocklist.
#[tauri::command]
fn running_programs() -> Vec<String> {
    let mut out: Vec<String> = win::windowed().into_iter().filter(|a| !rules::protected(a)).collect();
    out.sort();
    out.dedup();
    out
}

/// Program time counted since the last call, in ms.
#[tauri::command]
fn take_usage(state: State<'_, Shared>) -> HashMap<String, f64> {
    state.tally.lock().map(|mut t| t.take()).unwrap_or_default()
}

/// Opens a startup item. Not async, so it runs on the main thread, which Windows' shell expects.
#[tauri::command]
fn open_item(target: String, args: String) -> Result<(), String> {
    win::open(target.trim(), args.trim())
}

/// Started with Windows (hidden in the tray): the web app then opens the mode's startup items.
#[tauri::command]
fn started_at_login() -> bool {
    std::env::args().any(|a| a == "--minimized")
}

/// Starts Modes when the user signs in to Windows, hidden in the tray. Not in development builds,
/// which would register the dev exe.
#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    use tauri_plugin_autostart::ManagerExt;
    let launch = app.autolaunch();
    let now = launch.is_enabled().map_err(|e| e.to_string())?;
    if on && !now {
        launch.enable().map_err(|e| e.to_string())?;
    } else if !on && now {
        launch.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn window_in_front(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

/// The tray menu: the mode, the switch, open, and (outside work) quit. Quitting would stop the
/// blocking, so during work the way out is ending work.
fn tray_menu(app: &AppHandle, mode: &str, label: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let work = mode == "work";
    let status = MenuItem::with_id(app, "status", format!("Mode: {label}"), false, None::<&str>)?;
    let switch = MenuItem::with_id(app, "switch", if work { "End work…" } else { "Start work…" }, true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Open Modes", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    if work {
        Menu::with_items(app, &[&status, &sep, &switch, &show])
    } else {
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let sep2 = PredefinedMenuItem::separator(app)?;
        Menu::with_items(app, &[&status, &sep, &switch, &show, &sep2, &quit])
    }
}

fn update_tray(app: &AppHandle, mode: &str, label: &str) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(tray_menu(app, mode, label)?))?;
        tray.set_tooltip(Some(format!("Modes · {label}")))?;
    }
    Ok(())
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Modes")
        .show_menu_on_left_click(false)
        .menu(&tray_menu(app, "free", "FREE TIME")?)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                // Checked again here: the menu may be stale for a moment after a switch.
                let work = app.state::<Shared>().mode.lock().map(|m| *m == "work").unwrap_or(false);
                if !work {
                    app.exit(0);
                }
            }
            "show" => show_main(app),
            "switch" => {
                show_main(app);
                let _ = app.emit("tray", "switch");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Reports closed programs: an event for the window and, when it is not in front, a notification.
fn report(app: &AppHandle, closed: Vec<String>, now: f64) {
    let state = app.state::<Shared>();
    let label = state.label.lock().map(|l| l.clone()).unwrap_or_default();
    let Ok(mut notified) = state.notified.lock() else { return };
    notified.retain(|_, at| now - *at < NOTIFY_EVERY_MS);
    let fresh: Vec<String> = closed.into_iter().filter(|a| !notified.contains_key(a)).collect();
    if fresh.is_empty() {
        return;
    }
    for a in &fresh {
        notified.insert(a.clone(), now);
        let _ = app.emit("blocked", a.clone());
    }
    drop(notified);
    if !window_in_front(app) {
        let names: Vec<&str> = fresh.iter().map(|a| a.trim_end_matches(".exe")).collect();
        let _ = app
            .notification()
            .builder()
            .title(format!("Blocked in {label}"))
            .body(format!("Closing {}.", names.join(", ")))
            .show();
    }
}

fn start_thread(app: AppHandle) {
    let own_pid = std::process::id();
    std::thread::spawn(move || {
        let mut n: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(1000));
            n = n.wrapping_add(1);
            let state = app.state::<Shared>();
            let now = now_ms();

            let front = if state.tracking.load(Ordering::Relaxed) && win::idle_ms() < IDLE_MS {
                win::foreground()
            } else {
                None
            };
            if let Ok(mut t) = state.tally.lock() {
                t.tick(now, front.as_deref());
            }

            if !n.is_multiple_of(2) {
                continue;
            }
            let Ok(blocked) = state.blocked.lock().map(|b| b.clone()) else { continue };
            if blocked.is_empty() {
                continue;
            }
            let procs = win::processes();
            let actions = match state.enforcer.lock() {
                Ok(mut e) => e.step(now, &procs, &blocked, own_pid),
                Err(_) => continue,
            };
            let mut closed = Vec::new();
            for a in actions {
                match a {
                    Action::Close(pid, app_name) => {
                        win::close(pid);
                        if !closed.contains(&app_name) {
                            closed.push(app_name);
                        }
                    }
                    Action::Kill(pid, _) => win::kill(pid),
                }
            }
            if !closed.is_empty() {
                report(&app, closed, now);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launch just brings the running window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Shared::default())
        // Closing the window only hides it: the blocking goes on in the tray (Quit is in its menu).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_mode,
            running_blocked,
            running_programs,
            take_usage,
            open_item,
            set_autostart,
            started_at_login
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            start_thread(app.handle().clone());
            // The window starts hidden (tauri.conf.json). Started with Windows: it stays in the tray
            // until the user opens it.
            if !started_at_login() {
                show_main(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Modes");
}
