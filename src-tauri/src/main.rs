// Prevents an extra console window on Windows in release; harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Thin binary entry: all logic lives in the library crate.
fn main() {
    harmony_lib::run();
}
