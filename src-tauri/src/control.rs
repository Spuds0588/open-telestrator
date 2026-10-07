//! Draw mode and Control mode: where the pointer goes.
//!
//! In **Draw** the window takes clicks, and the canvas draws on them — the
//! behaviour the web app has always had. In **Control** the whole window is made
//! to ignore cursor events, so the pointer belongs to whatever is *under* the
//! window: the video, page or application the telestrator is sitting on top of.
//! The two are one switch, not a mode plus a modifier.
//!
//! One window, not two. An earlier plan split the stage and the studio into
//! separate windows so the controls could stay clickable while the overlay was
//! click-through, but the stroke stack, the capture and the broadcast all live
//! in one webview: two windows would mean two React trees and two stroke
//! stacks, which is the one thing a telestrator must not have. Since a
//! click-through window cannot be clicked, the way out is a global shortcut
//! and the tray icon, both of which work wherever the pointer is.
//!
//! Tauri can only make a whole window ignore cursor events — per-region
//! pass-through is still an open upstream request (tauri-apps/tauri#13070) —
//! which is exactly what a single-window telestrator wants anyway.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
// Only the desktop half names a window or talks to the webview, so a phone
// build — where `SUPPORTED` is false and none of that code is compiled — does
// not carry the imports either.
#[cfg(desktop)]
use tauri::{Emitter, WebviewWindow};

/// The window the studio lives in, as named in `tauri.conf.json`.
#[cfg(desktop)]
pub const WINDOW: &str = "studio";

/// The shortcut that gets you back out of Control mode. On the desktop build
/// this is the escape hatch that matters: a click-through window cannot be
/// clicked, so the way back may never live inside it.
/// Desktop only: there is no second pointer mode without a window that can
/// ignore one, so a phone build compiles neither of these.
#[cfg(all(desktop, target_os = "macos"))]
pub const SHORTCUT_LABEL: &str = "Cmd+Shift+D";
#[cfg(all(desktop, not(target_os = "macos")))]
pub const SHORTCUT_LABEL: &str = "Ctrl+Shift+D";

/// Whether the global shortcut is bound — the only hatch that is certain to
/// work.
///
/// A click-through window cannot be clicked, so the ways back are the shortcut
/// and the tray icon, and the tray is not something every desktop shows: GNOME
/// needs an extension for it, and a tray that is drawn but ignored is no hatch
/// at all. The shortcut goes wherever the pointer does, so it is the one way out
/// this code will rely on. If binding it failed, Control mode must not be
/// entered: a window that ignores the pointer with nothing left to click is an
/// app the operator has to kill.
static ESCAPE_READY: AtomicBool = AtomicBool::new(false);

/// Record that binding the shortcut succeeded. Called once, from the shell's
/// setup, and only on a target that has a shortcut to bind.
#[cfg(desktop)]
pub fn mark_escape_ready() {
  ESCAPE_READY.store(true, Ordering::Relaxed);
}

/// Whether anything can currently hand the pointer back.
pub fn escape_ready() -> bool {
  ESCAPE_READY.load(Ordering::Relaxed)
}

#[derive(Default)]
pub struct ControlState {
  control: Mutex<bool>,
}

impl ControlState {
  pub fn get(&self) -> bool {
    self.control.lock().map(|value| *value).unwrap_or(false)
  }
}

/// Whether this build has a second pointer mode at all.
///
/// A phone has no window underneath this one to hand the pointer to, and the
/// call that makes a window ignore cursor events is desktop-only in Tauri. So
/// the command says no rather than pretending, and the webview is told the same
/// thing through `src/lib/desktop.ts`.
pub const SUPPORTED: bool = cfg!(desktop);

/// Put the window into one mode or the other.
///
/// Failures are returned rather than logged because the only caller is a user
/// action, and "the mode did not change" is worth saying out loud.
pub fn set(app: &AppHandle, control: bool) -> Result<bool, String> {
  if !SUPPORTED {
    return Err(NO_SECOND_WINDOW.into());
  }
  // Only the dangerous direction is gated. Turning Control *off* is always
  // allowed, and has to be: it is what the hatch itself asks for.
  if control && !escape_ready() {
    return Err(NO_WAY_BACK.into());
  }
  #[cfg(desktop)]
  {
    return set_window(app, control);
  }
  #[cfg(not(desktop))]
  {
    // Unreachable: `SUPPORTED` is false on this target and the guard above has
    // already returned. The webview is told the same thing through
    // `offersControlMode` in `src/lib/controlMode.ts`, so the tile never appears.
    let _ = (app, control);
    unreachable!()
  }
}

/// What the webview is told when it asks for a mode this build does not have.
pub const NO_SECOND_WINDOW: &str = "This build has no window to pass the pointer to.";

/// What the webview is told when Control mode is asked for with no way back.
pub const NO_WAY_BACK: &str =
  "Control mode is off because the Draw/Control shortcut could not be bound, and that shortcut is the only way back to the pointer.";

/// Whether the rail should draw a Control tile at all.
///
/// Both conditions are needed: a window that can be told to ignore the pointer,
/// and a live shortcut to undo it. The rail asks this rather than the shell
/// name, so a build whose shortcut failed to bind offers no tile instead of one
/// that can only refuse.
pub fn offers() -> bool {
  SUPPORTED && escape_ready()
}

#[cfg(desktop)]
fn set_window(app: &AppHandle, control: bool) -> Result<bool, String> {
  let window: WebviewWindow = app
    .get_webview_window(WINDOW)
    .ok_or_else(|| "the studio window is missing".to_string())?;

  window
    .set_ignore_cursor_events(control)
    .map_err(|error| format!("could not change the pointer mode: {error}"))?;

  if let Some(state) = app.try_state::<ControlState>() {
    if let Ok(mut current) = state.control.lock() {
      *current = control;
    }
  }

  // The webview owns everything the user can see: it has to know, so it can
  // stop drawing and step out of the way.
  let _ = app.emit("control-changed", control);
  Ok(control)
}

#[cfg(desktop)]
pub fn toggle(app: &AppHandle) -> Result<bool, String> {
  let current = app
    .try_state::<ControlState>()
    .map(|state| state.get())
    .unwrap_or(false);
  set(app, !current)
}

#[tauri::command]
pub fn control_set(app: AppHandle, control: bool) -> Result<bool, String> {
  set(&app, control)
}

#[tauri::command]
pub fn control_offered() -> bool {
  offers()
}

#[tauri::command]
pub fn control_get(app: AppHandle) -> Result<bool, String> {
  Ok(app
    .try_state::<ControlState>()
    .map(|state| state.get())
    .unwrap_or(false))
}
