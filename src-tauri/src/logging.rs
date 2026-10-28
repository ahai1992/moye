use std::{fs::OpenOptions, io::Write, path::PathBuf, sync::OnceLock, time::SystemTime};
use tauri::Manager;

static LOG_FILE: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    let directory = match app.path().app_log_dir() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("[moye:log directory] {error}");
            std::env::temp_dir().join("moye")
        }
    };
    if let Err(error) = std::fs::create_dir_all(&directory) {
        eprintln!("[moye:create log directory] {error}");
        return;
    }
    LOG_FILE.get_or_init(|| directory.join("errors.log"));
}

pub fn error(context: &str, error: impl std::fmt::Display) {
    let timestamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|duration| duration.as_secs()).unwrap_or(0);
    let message = format!("[{timestamp}] [moye:{context}] {error}\n");
    eprint!("{message}");
    if let Some(path) = LOG_FILE.get() {
        let result = OpenOptions::new().create(true).append(true).open(path).and_then(|mut file| file.write_all(message.as_bytes()));
        if let Err(error) = result { eprintln!("[moye:write log] {error}"); }
    }
}

pub fn report(context: &str, error: impl std::fmt::Display, message: &str) -> String {
    self::error(context, error);
    message.to_string()
}
