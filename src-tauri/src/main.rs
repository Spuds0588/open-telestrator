//! The desktop shell: the same studio, in a window that can sit over anything.
//!
//! Nothing about the app is forked here. The webview loads `app.html` — the very
//! bundle GitHub Pages serves — and the only things this process adds are the
//! two that a browser cannot do: making a window that ignores cursor events, and
//! pushing the program to an RTMP platform.
//!
//! Deliberately not `#![windows_subsystem = "windows"]`: a console window is
//! useful while this is still young, and one line is all it takes to change.

// A release build should not open a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod control;
mod stream;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

fn main() {
  tauri::Builder::default()
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
    )
    .manage(control::ControlState::default())
    .manage(stream::Streams::default())
    .invoke_handler(tauri::generate_handler![
      control::control_get,
      control::control_set,
      stream::stream_failure,
      stream::stream_frame,
      stream::stream_start,
      stream::stream_stop,
    ])
    .setup(|app| {
      register_shortcut(app.handle())?;
      build_tray(app.handle())?;
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
fn register_shortcut(app: &tauri::AppHandle) -> tauri::Result<()> {
  use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

  let modifiers = if cfg!(target_os = "macos") {
    Modifiers::SUPER | Modifiers::SHIFT
  } else {
    Modifiers::CONTROL | Modifiers::SHIFT
  };
  let shortcut = Shortcut::new(Some(modifiers), Code::KeyD);
  if let Err(error) = app.global_shortcut().register(shortcut) {
    eprintln!(
      "Could not bind {}. Use the tray icon to change modes instead. ({error})",
      control::SHORTCUT_LABEL
    );
  }
  Ok(())
}

/// The tray icon: the mode toggle and a way out of the app.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let toggle = MenuItem::with_id(
    app,
    "toggle-mode",
    format!("Draw / Control ({})", control::SHORTCUT_LABEL),
    true,
    None::<&str>,
  )?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&toggle, &quit])?;

  let mut builder = TrayIconBuilder::with_id("studio-tray")
    .menu(&menu)
    .tooltip("Open Telestrator")
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "toggle-mode" => {
        let _ = control::toggle(app);
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
