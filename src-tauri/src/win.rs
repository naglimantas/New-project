//! The Windows calls Modes needs: running processes, closing and ending them, the program in front,
//! idle time, and opening startup items. Other systems get harmless stand-ins so the crate still builds
//! and its tests run there.

#[cfg(windows)]
mod imp {
    use crate::rules::app_name;
    use std::collections::HashSet;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, BOOL, HWND, INVALID_HANDLE_VALUE, LPARAM};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetLastInputInfo, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, LASTINPUTINFO, VIRTUAL_KEY, VK_CONTROL,
        VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, SW_SHOWNORMAL,
        WM_CLOSE,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn exe_name(entry: &PROCESSENTRY32W) -> String {
        let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
        app_name(&String::from_utf16_lossy(&entry.szExeFile[..len]))
    }

    /// Every running process: (pid, lower-case program file name).
    pub fn processes() -> Vec<(u32, String)> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE || snap.is_null() {
                return out;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    out.push((entry.th32ProcessID, exe_name(&entry)));
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        out
    }

    unsafe extern "system" fn close_one(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let target = lparam as u32;
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == target && IsWindowVisible(hwnd) != 0 {
            PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
        1
    }

    /// Asks every visible top-level window of the process to close, like clicking its X.
    pub fn close(pid: u32) {
        unsafe {
            EnumWindows(Some(close_one), pid as LPARAM);
        }
    }

    /// Ends the process. Fails quietly for processes Modes may not end (run as administrator).
    pub fn kill(pid: u32) {
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !h.is_null() {
                TerminateProcess(h, 1);
                CloseHandle(h);
            }
        }
    }

    unsafe extern "system" fn collect_pid(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let pids = &mut *(lparam as *mut HashSet<u32>);
        if IsWindowVisible(hwnd) != 0 && GetWindowTextLengthW(hwnd) > 0 {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != 0 {
                pids.insert(pid);
            }
        }
        1
    }

    /// Programs that have a visible, titled window right now: what the user would want to pick from.
    pub fn windowed() -> Vec<String> {
        let mut pids: HashSet<u32> = HashSet::new();
        unsafe {
            EnumWindows(Some(collect_pid), &mut pids as *mut HashSet<u32> as LPARAM);
        }
        processes().into_iter().filter(|(pid, _)| pids.contains(pid)).map(|(_, app)| app).collect()
    }

    /// The window in front: its handle, the program that owns it and (when `with_title`) its title.
    pub fn front_window(with_title: bool) -> Option<(isize, String, String)> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return None;
            }
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(process);
            if ok == 0 || len == 0 {
                return None;
            }
            let app = app_name(&String::from_utf16_lossy(&buf[..len as usize]));
            let mut title = String::new();
            if with_title {
                let mut text = [0u16; 512];
                let n = GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32);
                if n > 0 {
                    title = String::from_utf16_lossy(&text[..n as usize]);
                }
            }
            Some((hwnd as isize, app, title))
        }
    }

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// Closes the current tab of the browser window `hwnd` with Ctrl+W, only if that window is still in
    /// front and no modifier key is held (Ctrl+Shift+W would close the whole window).
    pub fn close_tab(hwnd: isize) -> bool {
        unsafe {
            if GetForegroundWindow() as isize != hwnd {
                return false;
            }
            for vk in [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN] {
                if GetAsyncKeyState(vk as i32) < 0 {
                    return false;
                }
            }
            const VK_W: VIRTUAL_KEY = 0x57;
            let inputs = [key(VK_CONTROL, false), key(VK_W, false), key(VK_W, true), key(VK_CONTROL, true)];
            SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) == inputs.len() as u32
        }
    }

    /// Milliseconds since the last key press or mouse move (anywhere in Windows).
    pub fn idle_ms() -> u32 {
        unsafe {
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if GetLastInputInfo(&mut info) == 0 {
                return 0;
            }
            GetTickCount().wrapping_sub(info.dwTime)
        }
    }

    /// Opens a program, shortcut, file, folder or URL the way a double-click would. Errors come back
    /// as text; Windows shows no error box of its own (`SEE_MASK_FLAG_NO_UI`).
    pub fn open(target: &str, args: &str) -> Result<(), String> {
        let verb = wide("open");
        let file = wide(target);
        let params = wide(args);
        let ok = unsafe {
            let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
            info.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC;
            info.lpVerb = verb.as_ptr();
            info.lpFile = file.as_ptr();
            info.lpParameters = if args.is_empty() { std::ptr::null() } else { params.as_ptr() };
            info.nShow = SW_SHOWNORMAL;
            ShellExecuteExW(&mut info)
        };
        if ok != 0 {
            return Ok(());
        }
        Err(match unsafe { GetLastError() } {
            2 | 3 => "not found".into(),
            5 => "access denied".into(),
            1155 => "no program is set to open it".into(),
            1223 => "cancelled".into(),
            n => format!("Windows error {n}"),
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    //! These run on a real Windows (the CI's windows job): they start throwaway processes and check
    //! that Modes sees, closes and ends them.
    use super::*;
    use crate::rules::{Action, Enforcer, GRACE_MS};
    use std::collections::HashSet;
    use std::process::{Child, Command};
    use std::time::{Duration, Instant};

    fn wait_for(secs: u64, mut f: impl FnMut() -> bool) -> bool {
        let until = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < until {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        f()
    }

    fn exited(child: &mut Child, secs: u64) -> bool {
        wait_for(secs, || matches!(child.try_wait(), Ok(Some(_))))
    }

    /// A process without a window that runs for a minute.
    fn pinger() -> Child {
        Command::new("ping").args(["-n", "60", "127.0.0.1"]).spawn().expect("ping starts")
    }

    #[test]
    fn sees_and_ends_a_running_process() {
        let mut child = pinger();
        let pid = child.id();
        assert!(
            wait_for(5, || processes().contains(&(pid, "ping.exe".to_string()))),
            "ping.exe in the process list"
        );
        kill(pid);
        assert!(exited(&mut child, 5), "ping.exe ended");
        assert!(!processes().iter().any(|(p, _)| *p == pid));
    }

    #[test]
    fn the_enforcer_ends_a_blocked_program_after_the_grace_time() {
        let mut child = pinger();
        let pid = child.id();
        assert!(wait_for(5, || processes().iter().any(|(p, _)| *p == pid)));
        let blocked: HashSet<String> = ["ping.exe".to_string()].into();
        let mut e = Enforcer::default();
        let own = std::process::id();
        let first = e.step(0.0, &processes(), &blocked, own);
        assert!(first.contains(&Action::Close(pid, "ping.exe".into())), "{first:?}");
        for a in &first {
            if let Action::Close(p, _) = a {
                close(*p);
            }
        }
        // A console program has no window to close: it is still there, and is ended after the grace time.
        let later = e.step(GRACE_MS, &processes(), &blocked, own);
        assert!(later.contains(&Action::Kill(pid, "ping.exe".into())), "{later:?}");
        for a in later {
            if let Action::Kill(p, _) = a {
                kill(p);
            }
        }
        assert!(exited(&mut child, 5), "ping.exe ended by the enforcer");
    }

    #[test]
    fn closes_a_program_window_like_its_x_button() {
        let mut child = Command::new("notepad.exe").spawn().expect("notepad starts");
        let pid = child.id();
        // The runner may have no desktop to show windows on; then there is nothing to close.
        if !wait_for(15, || windowed().contains(&"notepad.exe".to_string())) {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("no notepad window appeared (no interactive desktop?): window closing not checked");
            return;
        }
        close(pid);
        assert!(exited(&mut child, 10), "notepad closed on WM_CLOSE");
    }

    #[test]
    fn opens_programs_and_reports_missing_ones() {
        assert_eq!(open(r"C:\definitely\missing\nothing-here.exe", ""), Err("not found".to_string()));
        // cmd.exe exits at once; it only has to start.
        assert_eq!(open("cmd.exe", "/c exit 0"), Ok(()));
    }

    #[test]
    fn idle_time_and_the_window_in_front_can_be_read() {
        // Values depend on the machine; these only must not fail or crash.
        let _ = idle_ms();
        if let Some((hwnd, app, _)) = front_window(true) {
            assert!(hwnd != 0);
            assert!(!app.is_empty());
        }
    }
}

#[cfg(windows)]
pub use imp::{close, close_tab, front_window, idle_ms, kill, open, processes, windowed};

#[cfg(not(windows))]
pub fn processes() -> Vec<(u32, String)> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn close(_pid: u32) {}

#[cfg(not(windows))]
pub fn kill(_pid: u32) {}

#[cfg(not(windows))]
pub fn windowed() -> Vec<String> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn front_window(_with_title: bool) -> Option<(isize, String, String)> {
    None
}

#[cfg(not(windows))]
pub fn close_tab(_hwnd: isize) -> bool {
    false
}

#[cfg(not(windows))]
pub fn idle_ms() -> u32 {
    0
}

#[cfg(not(windows))]
pub fn open(_target: &str, _args: &str) -> Result<(), String> {
    Err("only on Windows".into())
}
