//! The desktop shell: the same studio, in a window that can sit over anything.
//!
//! Nothing about the app is forked here. The webview loads `app.html` — the very
//! bundle GitHub Pages serves — and the only things this process adds are the
//! ones a browser cannot do: making a window that ignores cursor events and
//! pushing the program to an RTMP platform.
//!
//! There is no updater here on purpose. The app ships as one standalone
//! executable with nothing installed around it, so a newer version is news and a
//! link, which the webview handles; see `docs/tauri-desktop.md#a-newer-version`.
//!
//! This is a library with a two-line binary in front of it rather than a binary
//! on its own, which is what an Android build needs: `mobile_entry_point` has to
//! sit on a function a phone's activity can call. The desktop build is unchanged
//! by the split — `main.rs` calls `run()` and does nothing else.
//!
//! Releasing is the one thing that needs a human. See
//! `docs/tauri-desktop.md#releasing`.

mod control;
mod stream;

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
#[cfg(desktop)]
use tauri::Emitter;
use tauri::webview::{PermissionKind, PermissionResponse};

/// The event the shell sends the webview when someone asks for an update check
/// from outside it — the tray menu, because in Control mode the window ignores
/// the pointer and cannot be clicked at all.
#[cfg(desktop)]
pub const UPDATE_CHECK_EVENT: &str = "update-check";

/// Bootstrap the shell.
///
/// Called by `main.rs` on the desktop and by the Android activity on a phone or
/// tablet, which is the whole reason this is a function here rather than the
/// body of `main`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    .manage(control::ControlState::default())
    .manage(stream::Streams::default())
    .invoke_handler(tauri::generate_handler![
      control::control_get,
      control::control_offered,
      control::control_set,
      stream::stream_failure,
      stream::stream_frame,
      stream::stream_start,
      stream::stream_stop,
    ]);

  // Opening the release page is the one plugin every platform wants: a phone has
  // no browser chrome around this app either.
  builder = builder.plugin(tauri_plugin_opener::init());

  // The camera, the microphone and the screen are most of what this app is for,
  // and a webview refuses all three unless the embedder answers for them. On
  // Linux this is not a default that can be left alone: WebKitGTK's
  // `permission-request` signal has no prompt of its own, so an unanswered
  // request is denied and `getUserMedia` fails with `NotAllowedError`. Measured
  // rather than assumed — with a handler that allows, a real webview returns a
  // track; with none, it refuses. Nothing outside these three is granted here:
  // the app asks for no location, no notifications and no MIDI.
  builder = builder.on_permission_request(|_webview, kind| match kind {
    PermissionKind::Camera | PermissionKind::Microphone | PermissionKind::DisplayCapture => {
      PermissionResponse::Allow
    }
    _ => PermissionResponse::Default,
  });

  // A tray and a second pointer mode are desktop ideas, and a phone has neither,
  // so they are compiled in only where they exist.
  #[cfg(desktop)]
  {
    builder = builder
      .plugin(
        tauri_plugin_global_shortcut::Builder::new()
          .with_handler(|app, _shortcut, event| {
            // Only on press: the plugin reports both edges, and toggling twice
            // would leave the mode exactly as it was.
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
              let _ = control::toggle(app);
            }
          })
          .build(),
      );
  }

  builder
    .setup(|app| {
      #[cfg(desktop)]
      {
        register_shortcut(app.handle())?;
        build_tray(app.handle())?;
      }
      let _ = app;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("could not start Open Telestrator");
}

/// Bind the draw/control shortcut.
///
/// This is the only way out of Control mode that does not need the tray, so a
/// failure here is worth surfacing rather than swallowing. It is not fatal: the
/// tray menu still toggles the mode.
#[cfg(desktop)]
fn register_shortcut(app: &tauri::AppHandle) -> tauri::Result<()> {
  use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

  let modifiers = if cfg!(target_os = "macos") {
    Modifiers::SUPER | Modifiers::SHIFT
  } else {
    Modifiers::CONTROL | Modifiers::SHIFT
  };
  let shortcut = Shortcut::new(Some(modifiers), Code::KeyD);
  match app.global_shortcut().register(shortcut) {
    // The hatch is the shortcut, so Control mode is offered only once it is
    // bound — see `control::offers`. The tray's toggle is still built below and
    // still works, but a tray icon is not something every desktop shows, so it
    // is not what this promise is made on.
    Ok(()) => control::mark_escape_ready(),
    Err(error) => eprintln!(
      "Could not bind {}. Control mode is unavailable without it. ({error})",
      control::SHORTCUT_LABEL
    ),
  }
  Ok(())
}

/// The tray icon: the mode toggle, an update check, and a way out of the app.
///
/// The update check lives here rather than only in the panel because of Control
/// mode: a window that ignores the pointer cannot be asked anything, so the one
/// place that always works is outside the window.
#[cfg(desktop)]
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let toggle = MenuItem::with_id(
    app,
    "toggle-mode",
    format!("Draw / Control ({})", control::SHORTCUT_LABEL),
    true,
    None::<&str>,
  )?;
  let updates = MenuItem::with_id(app, "check-updates", "Check for updates", true, None::<&str>)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&toggle, &separator, &updates, &quit])?;

  let mut builder = TrayIconBuilder::with_id("studio-tray")
    .menu(&menu)
    .tooltip("Open Telestrator")
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "toggle-mode" => {
        let _ = control::toggle(app);
      }
      // The webview owns the update preference and does the talking to the
      // release server, so this is a nudge rather than a check.
      "check-updates" => {
        let _ = app.emit(UPDATE_CHECK_EVENT, ());
      }
      "quit" => app.exit(0),
      _ => {}
    });

  if let Some(icon) = app.default_window_icon().cloned() {
    builder = builder.icon(icon);
  }
  // Held for the life of the app; dropping it would remove the icon.
  builder.build(app)?;
  Ok(())
}
