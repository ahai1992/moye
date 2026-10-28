use crate::{document, logging::report};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::PathBuf, sync::Mutex, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    id: String,
    content: String,
    #[serde(default)]
    rich_content: String,
    #[serde(default)]
    highlight_words: Vec<String>,
    background: String,
    foreground: String,
    pinned: bool,
    visible: bool,
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
    updated: u64,
}

#[derive(Default)]
pub struct NotesStore(Mutex<State>);
#[derive(Default)]
struct State {
    loaded: bool,
    notes: Vec<Note>,
    closing: bool,
    pending: HashSet<String>,
    failure: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEdit {
    content: String, #[serde(default)] rich_content: String,
    #[serde(default)] highlight_words: Vec<String>,
    background: String, foreground: String, pinned: bool, updated: u64,
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn lock(app: &AppHandle) -> Result<std::sync::MutexGuard<'_, State>, String> {
    app.state::<NotesStore>().inner().0.lock().map_err(|error| report("notes lock", error, "便签暂时无法访问，请稍后重试。"))
}
fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = match std::env::var_os("MOYE_DATA_DIR") {
        Some(path) => PathBuf::from(path),
        None => app.path().app_data_dir().map_err(|error| report("notes directory", error, "便签保存位置无法访问。"))?,
    };
    if !directory.is_absolute() { return Err("便签保存位置无效。".into()); }
    fs::create_dir_all(&directory).map_err(|error| report("create notes directory", error, "无法创建便签保存目录，请检查写入权限。"))?;
    Ok(directory.join("notes.json"))
}
fn color(value: &str) -> bool { value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|c| c.is_ascii_hexdigit()) }
fn validate(notes: &[Note]) -> Result<(), String> {
    if notes.len() > 128 { return Err("便签数量已达上限，请先删除不需要的便签。".into()); }
    let mut ids = HashSet::new();
    for note in notes {
        document::validate_id(&note.id)?;
        if note.highlight_words.len() > 128 || note.highlight_words.iter().any(|word| word.trim().is_empty())
            || note.highlight_words.iter().map(String::len).sum::<usize>() > 64 * 1024 {
            return Err("高亮关键词过多或过长，请减少后重试。".into());
        }
        if !ids.insert(&note.id) || note.content.len() > 1024 * 1024 || note.rich_content.len() > 2 * 1024 * 1024 || !color(&note.background) || !color(&note.foreground)
            || !note.width.is_finite() || !note.height.is_finite() || !(220.0..=6000.0).contains(&note.width)
            || !(160.0..=6000.0).contains(&note.height) || note.x.is_some_and(|v| !v.is_finite()) || note.y.is_some_and(|v| !v.is_finite()) {
            return Err("便签数据不完整，原保存文件已保留。".into());
        }
    }
    Ok(())
}
fn persist(app: &AppHandle, notes: &[Note]) -> Result<(), String> {
    validate(notes)?;
    let path = path(app)?;
    let bytes = serde_json::to_vec(notes).map_err(|error| report("encode notes", error, "便签整理失败，请重试。"))?;
    if bytes.len() > 32 * 1024 * 1024 { return Err("便签内容总量过大，请先将部分内容保存为文档。".into()); }
    if path.exists() {
        let old = document::bounded_read(&path, 32 * 1024 * 1024)?;
        document::write_atomic(&path.with_extension("backup.json"), &old, None)?;
    }
    document::write_atomic(&path, &bytes, None)
}
fn load(app: &AppHandle, state: &mut State) -> Result<(), String> {
    if state.loaded { return Ok(()); }
    let path = path(app)?;
    if path.exists() {
        let bytes = document::bounded_read(&path, 32 * 1024 * 1024)?;
        let notes: Vec<Note> = serde_json::from_slice(&bytes).map_err(|error| report("decode notes", error, "便签未能读取，原文件和备份已保留，请勿清理应用数据。"))?;
        validate(&notes)?;
        state.notes = notes;
    }
    state.loaded = true;
    Ok(())
}
fn edit_store(app: &AppHandle, change: impl FnOnce(&mut Vec<Note>) -> Result<(), String>) -> Result<(), String> {
    let mut state = lock(app)?;
    load(app, &mut state)?;
    let mut notes = state.notes.clone();
    change(&mut notes)?;
    persist(app, &notes)?;
    state.notes = notes;
    Ok(())
}
fn show(app: &AppHandle, note: &Note) -> Result<(), String> {
    let label = format!("note-{}", note.id);
    if let Some(window) = app.get_webview_window(&label) {
        return window.show().and_then(|_| window.set_focus()).map_err(|error| report("show note", error, "便签窗口无法显示，请重试。"));
    }
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(format!("note.html?id={}", note.id).into()))
        .title("墨页便签").inner_size(note.width, note.height).min_inner_size(220.0, 160.0)
        .decorations(false).resizable(true).always_on_top(note.pinned).skip_taskbar(true).visible(false);
    if let (Some(x), Some(y)) = (note.x, note.y) {
        // 显示器被拔掉后，将便签放回可见屏幕。
        let reachable = app.available_monitors().map_err(|error| report("note monitors", error, "无法读取屏幕位置，请重试。"))?
            .iter().any(|monitor| {
                let scale = monitor.scale_factor();
                let left = monitor.position().x as f64 / scale;
                let top = monitor.position().y as f64 / scale;
                x + 100.0 > left && y + 30.0 > top && x < left + monitor.size().width as f64 / scale - 40.0
                    && y < top + monitor.size().height as f64 / scale - 30.0
            });
        if reachable { builder = builder.position(x, y); }
    }
    builder.build().map_err(|error| report("create note window", error, "便签窗口未能打开，请重试。"))?;
    Ok(())
}
fn own_id(window: &WebviewWindow) -> Result<&str, String> {
    window.label().strip_prefix("note-").ok_or_else(|| "请从便签窗口执行此操作。".into())
}

#[tauri::command]
pub async fn notes_list(app: AppHandle) -> Result<Vec<Note>, String> {
    let mut state = lock(&app)?;
    load(&app, &mut state)?;
    Ok(state.notes.clone())
}
#[tauri::command]
pub async fn notes_restore(app: AppHandle) -> Result<(), String> {
    let notes = { let mut state = lock(&app)?; load(&app, &mut state)?; state.notes.clone() };
    for note in notes.iter().filter(|note| note.visible) { show(&app, note)?; }
    Ok(())
}
#[tauri::command]
pub async fn notes_create(app: AppHandle, id: String) -> Result<(), String> {
    document::validate_id(&id)?;
    let mut created = None;
    edit_store(&app, |notes| {
        if notes.iter().any(|note| note.id == id) { return Err("便签已存在，请重新打开。".into()); }
        let offset = (notes.len() % 8) as f64 * 24.0;
        let note = Note { id, content: String::new(), rich_content: String::new(), highlight_words: Vec::new(), background: "#fff1ad".into(), foreground: "#493f29".into(),
            pinned: false, visible: true, x: Some(100.0 + offset), y: Some(100.0 + offset), width: 300.0, height: 300.0, updated: now() };
        notes.push(note.clone()); created = Some(note); Ok(())
    })?;
    show(&app, &created.unwrap())
}
#[tauri::command]
pub async fn notes_show(app: AppHandle, id: String) -> Result<(), String> {
    let mut selected = None;
    edit_store(&app, |notes| {
        let note = notes.iter_mut().find(|note| note.id == id).ok_or("便签不存在，请刷新列表。")?;
        note.visible = true; selected = Some(note.clone()); Ok(())
    })?;
    show(&app, &selected.unwrap())
}
#[tauri::command]
pub async fn note_read(app: AppHandle, window: WebviewWindow) -> Result<Note, String> {
    let id = own_id(&window)?;
    let state = lock(&app)?;
    let note = state.notes.iter().find(|note| note.id == id).cloned().ok_or("便签未找到，已保存内容仍保留。")?;
    Ok(note)
}
#[tauri::command]
pub async fn note_ready(window: WebviewWindow) -> Result<(), String> {
    own_id(&window)?;
    window.show().map_err(|error| report("note ready", error, "便签窗口无法显示。"))
}
#[tauri::command]
pub async fn note_save(app: AppHandle, window: WebviewWindow, edit: NoteEdit) -> Result<(), String> {
    let id = own_id(&window)?.to_string();
    edit_store(&app, |notes| {
        let note = notes.iter_mut().find(|note| note.id == id).ok_or("便签已关闭，请重新打开。")?;
        if edit.updated < note.updated { return Ok(()); }
        note.content = edit.content; note.background = edit.background; note.foreground = edit.foreground;
        note.rich_content = edit.rich_content;
        note.highlight_words = edit.highlight_words;
        note.pinned = edit.pinned; note.updated = edit.updated; Ok(())
    })?;
    window.set_always_on_top(edit.pinned).map_err(|error| report("note pin", error, "内容已保存，置顶状态未能更新，请重试。"))
}
#[tauri::command]
pub async fn note_hide(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let id = own_id(&window)?.to_string();
    edit_store(&app, |notes| {
        let note = notes.iter_mut().find(|note| note.id == id).ok_or("便签未找到。")?;
        note.visible = false; Ok(())
    })?;
    window.hide().map_err(|error| report("hide note", error, "便签暂时无法收起。"))
}
#[tauri::command]
pub async fn notes_delete(app: AppHandle, id: String) -> Result<(), String> {
    document::validate_id(&id)?;
    {
        let mut state = lock(&app)?;
        load(&app, &mut state)?;
        if state.closing { return Err("软件正在退出，请稍后再删除便签。".into()); }
        if !state.notes.iter().any(|note| note.id == id) { return Err("便签已删除，请刷新列表。".into()); }
        let notes: Vec<_> = state.notes.iter().filter(|note| note.id != id).cloned().collect();
        persist(&app, &notes)?;
        state.notes = notes;
    }
    if let Some(window) = app.get_webview_window(&format!("note-{id}")) {
        window.destroy().map_err(|error| report("delete note window", error, "便签已删除，窗口未能关闭，请重试关闭该窗口。"))?;
    }
    if let Err(error) = app.emit("notes-changed", ()) { crate::logging::error("notify note deletion", error); }
    Ok(())
}
#[tauri::command]
pub fn note_drag(window: WebviewWindow) -> Result<(), String> {
    own_id(&window)?;
    window.start_dragging().map_err(|error| report("drag note", error, "暂时无法移动便签，请重试。"))
}
#[tauri::command]
pub fn note_flush_done(app: AppHandle, window: WebviewWindow, success: bool) -> Result<(), String> {
    let id = own_id(&window)?;
    let mut state = lock(&app)?;
    if state.pending.remove(id) && !success { state.failure = true; }
    Ok(())
}

pub fn geometry(window: &tauri::Window) {
    let Some(id) = window.label().strip_prefix("note-") else { return; };
    let result = (|| {
        let scale = window.scale_factor().map_err(|error| report("note scale", error, "便签位置保存失败。"))?;
        let position = window.outer_position().map_err(|error| report("note position", error, "便签位置保存失败。"))?;
        let size = window.inner_size().map_err(|error| report("note size", error, "便签大小保存失败。"))?;
        if size.width == 0 || size.height == 0 { return Ok(()); }
        edit_store(window.app_handle(), |notes| {
            let Some(note) = notes.iter_mut().find(|note| note.id == id) else { return Ok(()); };
            note.x = Some(position.x as f64 / scale); note.y = Some(position.y as f64 / scale);
            note.width = (size.width as f64 / scale).clamp(220.0, 6000.0);
            note.height = (size.height as f64 / scale).clamp(160.0, 6000.0); Ok(())
        })
    })();
    if let Err(error) = result {
        crate::logging::error("save note geometry", &error);
        if let Err(error) = window.emit("note-save-error", ()) { crate::logging::error("notify note geometry", error); }
    }
}

pub async fn prepare_exit(app: AppHandle) -> Result<(), String> {
    let windows: Vec<_> = app.webview_windows().into_values().filter(|window| window.label().starts_with("note-")).collect();
    {
        let mut state = lock(&app)?;
        if state.closing { return Err("便签正在保存，请稍后再关闭。".into()); }
        state.closing = true; state.failure = false;
        state.pending = windows.iter().filter_map(|window| own_id(window).ok().map(str::to_string)).collect();
    }
    for window in windows {
        if let Err(error) = window.emit("note-flush-request", ()) {
            lock(&app)?.closing = false;
            return Err(report("flush notes", error, "便签尚未保存，已保留窗口，请重试关闭。"));
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        loop {
            {
                let mut state = lock(&app)?;
                if state.failure || started.elapsed() > Duration::from_secs(12) {
                    state.closing = false; state.pending.clear();
                    return Err("部分便签未能保存，已保留窗口。请检查便签中的提示后重试。".into());
                }
                if state.pending.is_empty() { return Ok(()); }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }).await.map_err(|error| report("wait for notes", error, "便签保存尚未完成，请重试关闭。"))?
}
