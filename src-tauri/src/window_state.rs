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
    Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent,
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
    if window.is_fullscreen().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
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
