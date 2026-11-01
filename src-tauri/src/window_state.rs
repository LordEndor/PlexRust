//! Remembers the main window's size, position and maximized state between
//! launches, so the app reopens where it was last closed.
//!
//! The window starts hidden (see `tauri.conf.json`) and is shown once the
//! saved state has been applied, so it never flashes at the default spot.
//! Fullscreen (video playback) is never saved: the bounds tracked are the
//! normal, non-maximized ones, and the app always reopens windowed.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow,
    WindowEvent,
};

const FILE_NAME: &str = "window-state.json";

/// Window bounds in physical pixels. Position is the outer (frame) position,
/// size is the inner (client area) size, matching `set_position`/`set_size`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

/// Restores the saved state onto `window`, shows it, and keeps tracking it so
/// the state is written back when the window closes.
pub fn manage<R: Runtime>(window: &WebviewWindow<R>) {
    let path = window
        .app_handle()
        .path()
        .app_config_dir()
        .map(|dir| dir.join(FILE_NAME))
        .ok();

    let restored = path
        .as_deref()
        .and_then(load)
        .and_then(|s| restore(window, s));
    let _ = window.show();
    let _ = window.set_focus();

    let current = Arc::new(Mutex::new(restored.or_else(|| snapshot(window))));
    let tracked = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => track(&tracked, &current),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            if let (Some(path), Some(state)) = (&path, *current.lock().unwrap()) {
                save(path, &state);
            }
        }
        _ => {}
    });
}

/// Applies `state` and returns it when it was restored as saved, or `None`
/// when the window had to be moved to the primary monitor instead.
fn restore<R: Runtime>(window: &WebviewWindow<R>, state: WindowState) -> Option<WindowState> {
    let monitors = window.available_monitors().unwrap_or_default();
    let fits = monitors.iter().any(|m| on_monitor(m, &state));
    if fits {
        // Move first so the size is applied at the target monitor's scale.
        let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
        let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    } else {
        // The monitor it was on is gone (or the layout changed): keep the size
        // if it fits, and center it on the primary monitor.
        let primary = window.primary_monitor().ok().flatten();
        let size = match &primary {
            Some(m) => PhysicalSize::new(
                state.width.min(m.size().width),
                state.height.min(m.size().height),
            ),
            None => PhysicalSize::new(state.width, state.height),
        };
        if let Some(m) = &primary {
            let _ = window.set_position(*m.position());
        }
        let _ = window.set_size(size);
        let _ = window.center();
    }
    if state.maximized {
        let _ = window.maximize();
    }
    fits.then_some(state)
}

/// True when the window's title bar would be reachable on `monitor`: the top
/// center of the window lies inside it. Avoids reopening a window that is
/// technically "on" a monitor but only by a few pixels.
fn on_monitor(monitor: &Monitor, state: &WindowState) -> bool {
    let pos = monitor.position();
    let size = monitor.size();
    let x = state.x as i64 + state.width as i64 / 2;
    let y = state.y as i64 + 16;
    x >= pos.x as i64
        && x < pos.x as i64 + size.width as i64
        && y >= pos.y as i64
        && y < pos.y as i64 + size.height as i64
}

fn track<R: Runtime>(window: &WebviewWindow<R>, current: &Mutex<Option<WindowState>>) {
    // The mini player's small corner window is never saved; the bounds from
    // before it are, so the app reopens at its normal size.
    if window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || MINI.lock().unwrap().is_some()
    {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let mut current = current.lock().unwrap();
    if maximized {
        // Keep the normal bounds so un-maximizing after a restart goes back
        // to the size the user picked.
        if let Some(state) = current.as_mut() {
            state.maximized = true;
        }
    } else if let Some(state) = snapshot(window) {
        *current = Some(state);
    }
}

fn snapshot<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowState> {
    if window.is_maximized().unwrap_or(false) {
        return None;
    }
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowState {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

/// The window's bounds from before the mini player shrank it, while it's on.
static MINI: Mutex<Option<WindowState>> = Mutex::new(None);

/// Size of the mini player, in logical pixels (16:9).
const MINI_SIZE: (f64, f64) = (480.0, 270.0);
/// Gap between the mini player and the screen's corner, in logical pixels.
const MINI_MARGIN: f64 = 24.0;
/// The smallest normal window, as in `tauri.conf.json`.
const MIN_SIZE: (f64, f64) = (960.0, 600.0);

/// Shrinks the window to a small always-on-top player in the bottom-right
/// corner of its screen, or puts it back the way it was.
#[tauri::command]
pub fn mini_player<R: Runtime>(window: WebviewWindow<R>, on: bool) -> Result<(), String> {
    let e = |e: tauri::Error| e.to_string();
    let mut mini = MINI.lock().unwrap();
    if on {
        if mini.is_some() {
            return Ok(());
        }
        if window.is_fullscreen().unwrap_or(false) {
            window.set_fullscreen(false).map_err(e)?;
        }
        let maximized = window.is_maximized().unwrap_or(false);
        if maximized {
            window.unmaximize().map_err(e)?;
        }
        let Some(mut before) = snapshot(&window) else {
            return Err("Couldn't read the window's size".into());
        };
        before.maximized = maximized;
        *mini = Some(before);
        drop(mini);

        let monitor = window.current_monitor().map_err(e)?;
        let scale = window.scale_factor().unwrap_or(1.0);
        window.set_min_size(None::<PhysicalSize<u32>>).map_err(e)?;
        window.set_size(LogicalSize::new(MINI_SIZE.0, MINI_SIZE.1)).map_err(e)?;
        if let Some(m) = monitor {
            let area = m.work_area();
            let margin = (MINI_MARGIN * scale) as i32;
            let (w, h) = ((MINI_SIZE.0 * scale) as i32, (MINI_SIZE.1 * scale) as i32);
            let x = area.position.x + area.size.width as i32 - w - margin;
            let y = area.position.y + area.size.height as i32 - h - margin;
            window.set_position(PhysicalPosition::new(x, y)).map_err(e)?;
        }
        window.set_always_on_top(true).map_err(e)?;
    } else {
        let Some(before) = mini.take() else {
            return Ok(());
        };
        drop(mini);
        window.set_always_on_top(false).map_err(e)?;
        window.set_min_size(Some(LogicalSize::new(MIN_SIZE.0, MIN_SIZE.1))).map_err(e)?;
        window.set_position(PhysicalPosition::new(before.x, before.y)).map_err(e)?;
        window.set_size(PhysicalSize::new(before.width, before.height)).map_err(e)?;
        if before.maximized {
            window.maximize().map_err(e)?;
        }
    }
    Ok(())
}

/// Keeps the window above other windows while on, such as while watching
/// next to other work.
#[tauri::command]
pub fn pin_window<R: Runtime>(window: WebviewWindow<R>, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

fn load(path: &Path) -> Option<WindowState> {
    let text = std::fs::read_to_string(path).ok()?;
    let state: WindowState = serde_json::from_str(&text).ok()?;
    (state.width > 0 && state.height > 0).then_some(state)
}

fn save(path: &PathBuf, state: &WindowState) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(path, text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_rejects_missing_and_garbage() {
        let dir = std::env::temp_dir().join(format!("plexrust-ws-{}", std::process::id()));
        let path = dir.join(FILE_NAME);
        assert_eq!(load(&path), None);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(load(&path), None);
        let state = WindowState {
            x: -1920,
            y: 40,
            width: 1600,
            height: 900,
            maximized: true,
        };
        save(&path, &state);
        assert_eq!(load(&path), Some(state));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
