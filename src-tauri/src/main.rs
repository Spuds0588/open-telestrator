//! The desktop binary: everything it does is in the library beside it.
//!
//! The shell is a library with a tiny binary in front of it because Android
//! needs a function an activity can call (`lib.rs`). This file exists so that
//! `cargo run` and the released executable still start a process.
//!
//! Deliberately not `#![windows_subsystem = "windows"]` in debug: a console
//! window is useful while this is still young.

// A release build should not open a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  open_telestrator_lib::run()
}
