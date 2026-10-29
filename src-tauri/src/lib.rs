mod document;
mod logging;
mod workspace;
mod notes;
mod association;
mod fonts;

use document::{DocumentState, is_markdown, report};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

fn queue_file(app: &tauri::AppHandle, path: PathBuf) {
    if !is_markdown(&path) { return; }
    let state = app.state::<DocumentState>();
    match state.lock() {
        Ok(mut session) => { if !session.pending.contains(&path) { session.pending.push_back(path); } },
        Err(error) => { logging::error("queue file", error); return; }
    }
    if let Err(error) = app.emit("files-pending", ()) { logging::error("notify open", error); }
}

fn file_arguments(args: impl Iterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.map(PathBuf::from).filter(|path| is_markdown(path)).map(|path| {
        if path.is_absolute() { path } else { cwd.join(path) }
    }).collect()
}

#[tauri::command]
async fn close_window(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("请从主窗口退出软件。".into()); }
    if let Err(error) = notes::prepare_exit(app.clone()).await {
        if let Err(notify) = app.emit("note-flush-cancel", ()) { logging::error("cancel note flush", notify); }
        return Err(error);
    }
    for note in app.webview_windows().into_values().filter(|window| window.label().starts_with("note-")) {
        note.destroy().map_err(|error| report("close note", error, "便签已保存，但窗口未能关闭，请重试。"))?;
    }
    window.destroy().map_err(|error| report("close", error, "窗口暂时无法关闭，请重试。"))
}

#[tauri::command]
fn set_document_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|error| report("title", error, "窗口标题暂时无法更新。"))
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            for path in file_arguments(args.into_iter().skip(1), Path::new(&cwd)) { queue_file(app, path); }
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.unminimize().and_then(|_| window.show()).and_then(|_| window.set_focus()) {
                    logging::error("focus", error);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(DocumentState::default())
        .manage(workspace::WorkspaceStore::default())
        .manage(notes::NotesStore::default())
        .setup(|app| {
            logging::init(app.handle());
            match std::env::current_dir() {
                Ok(cwd) => {
                    for path in file_arguments(std::env::args().skip(1), &cwd) { queue_file(app.handle(), path); }
                }
                Err(error) => logging::error("working directory", error),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.emit("close-requested", ()) { logging::error("close request", error); }
            }
            if window.label().starts_with("note-") && matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                notes::geometry(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            document::open_document,
            document::new_document,
            document::close_document,
            document::check_document,
            document::reload_document,
            workspace::load_workspace,
            workspace::save_workspace,
            document::save_document,
            document::has_pending_file,
            document::open_pending_file,
            document::discard_pending_file,
            document::read_image,
            document::pick_image,
            close_window,
            set_document_title,
            notes::notes_list,
            notes::notes_restore,
            notes::notes_create,
            notes::notes_show,
            notes::notes_delete,
            notes::note_read,
            notes::note_ready,
            notes::note_save,
            notes::note_hide,
            notes::note_drag,
            notes::note_flush_done,
            association::register_file_association,
            fonts::installed_fonts,
        ])
        .build(tauri::generate_context!())
        .expect("墨页启动失败");

    app.run(|app, event| {
        // macOS 的 Finder 文件关联通过 Opened 事件传递，不经过 argv。
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                match url.to_file_path() {
                    Ok(path) => queue_file(app, path),
                    Err(_) => logging::error("open url", "unsupported file URL"),
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
