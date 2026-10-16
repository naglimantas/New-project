//! The Windows calls Modes needs: running processes, closing and ending them, the program in front,
//! idle time, and opening startup items. Other systems get harmless stand-ins so the crate still builds
//! and its tests run there.

#[cfg(windows)]
mod imp {
    use crate::rules::app_name;
    use std::collections::HashSet;
    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, INVALID_HANDLE_VALUE, LPARAM};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, SW_SHOWNORMAL, WM_CLOSE,
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

    /// The program that owns the window in front.
    pub fn foreground() -> Option<String> {
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
            Some(app_name(&String::from_utf16_lossy(&buf[..len as usize])))
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

    /// Opens a program, shortcut, file, folder or URL the way a double-click would.
    pub fn open(target: &str, args: &str) -> Result<(), String> {
        let verb = wide("open");
        let file = wide(target);
        let params = wide(args);
        let r = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                if args.is_empty() { std::ptr::null() } else { params.as_ptr() },
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        // Values up to 32 are error codes.
        if r as isize > 32 {
            Ok(())
        } else {
            Err(match r as isize {
                2 | 3 => "not found".into(),
                5 => "access denied".into(),
                31 => "no program is set to open it".into(),
                n => format!("Windows error {n}"),
            })
        }
    }
}

#[cfg(windows)]
pub use imp::{close, foreground, idle_ms, kill, open, processes, windowed};

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
pub fn foreground() -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn idle_ms() -> u32 {
    0
}

#[cfg(not(windows))]
pub fn open(_target: &str, _args: &str) -> Result<(), String> {
    Err("only on Windows".into())
}
