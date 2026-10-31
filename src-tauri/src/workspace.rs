use crate::document::{self, DocumentState, OpenedDocument, Session, MAX_DOCUMENT_BYTES};
use crate::logging::report;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, Manager};

const MAX_WORKSPACE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Default)]
pub struct WorkspaceStore(Mutex<StoreState>);

#[derive(Default)]
struct StoreState {
    loaded: bool,
    sequence: u64,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollPosition { pub top: f64, pub left: f64 }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    pub mode: String,
    pub wrap: String,
    pub preview: ScrollPosition,
    pub source: ScrollPosition,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTab {
    pub id: String,
    pub content: Option<String>,
    pub view: ViewState,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTab {
    id: String,
    name: String,
    path: Option<PathBuf>,
    content: Option<String>,
    view: ViewState,
    #[serde(default)]
    encoding: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot { version: u32, active_id: String, tabs: Vec<StoredTab> }

#[derive(Serialize)]
pub struct RestoredTab { document: OpenedDocument, view: ViewState }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredWorkspace { active_id: String, tabs: Vec<RestoredTab>, warnings: Vec<String> }

fn workspace_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = match std::env::var_os("MOYE_DATA_DIR") {
        Some(path) => PathBuf::from(path),
        None => app.path().app_data_dir().map_err(|error| report("draft directory", error, "临时保存位置无法访问。"))?,
    };
    if !directory.is_absolute() { return Err("临时保存位置必须是完整的文件夹路径。".into()); }
    fs::create_dir_all(&directory).map_err(|error| report("create draft directory", error, "无法创建临时保存文件夹，请检查写入权限。"))?;
    Ok(directory.join("workspace.json"))
}

fn validate_view(view: &ViewState) -> Result<(), String> {
    if !matches!(view.mode.as_str(), "source" | "preview") || !matches!(view.wrap.as_str(), "none" | "window" | "page") {
        return Err("文档显示状态无效，请重新打开文档。".into());
    }
    for value in [view.preview.top, view.preview.left, view.source.top, view.source.left] {
        if !value.is_finite() || !(0.0..=1_000_000_000.0).contains(&value) { return Err("文档滚动位置无效。".into()); }
    }
    Ok(())
}

fn snapshot(session: &Session, active_id: String, tabs: Vec<SnapshotTab>) -> Result<Snapshot, String> {
    if tabs.len() > 128 { return Err("临时文档数量过多，请先保存并关闭部分标签。".into()); }
    let mut seen = HashSet::new();
    let mut stored = Vec::with_capacity(tabs.len());
    let mut total = 0;
    for tab in tabs {
        document::validate_id(&tab.id)?;
        validate_view(&tab.view)?;
        if !seen.insert(tab.id.clone()) { return Err("临时文档重复，请重试。".into()); }
        let document = session.documents.get(&tab.id).ok_or("文档已关闭，临时保存未完成。")?;
        let path = document.current.as_ref().map(|doc| doc.path.clone());
        // 文件标签仅保存路径与显示状态。恢复数据永远不能写回原文件。
        if path.is_some() && tab.content.is_some() { return Err("已有文件不自动暂存内容，请使用临时副本或手动保存。".into()); }
        if path.is_none() && tab.content.is_none() { return Err("临时文档内容缺失，请重试。".into()); }
        let size = tab.content.as_ref().map_or(0, |text| text.len() as u64);
        if size > MAX_DOCUMENT_BYTES { return Err("临时文档超过 16 MB，请减少嵌入图片或拆分后保存。".into()); }
        total += size;
        if total > MAX_WORKSPACE_BYTES { return Err("临时文档总量过大，请先将部分文档保存为文件。".into()); }
        let encoding = document.current.as_ref().map(|doc| doc.encoding.clone());
        stored.push(StoredTab { id: tab.id, name: document.name.clone(), path, content: tab.content, view: tab.view, encoding });
    }
    if !stored.is_empty() && !seen.contains(&active_id) { return Err("当前标签状态无效，请重试。".into()); }
    Ok(Snapshot { version: 1, active_id, tabs: stored })
}

fn store_snapshot(path: &Path, snapshot: &Snapshot) -> Result<(), String> {
    let bytes = serde_json::to_vec(snapshot).map_err(|error| report("encode drafts", error, "临时文档整理失败，请重试。"))?;
    if bytes.len() as u64 > MAX_WORKSPACE_BYTES { return Err("临时文档总量过大，请先将部分文档保存为文件。".into()); }
    document::write_atomic(path, &bytes, None)
}

fn restore(path: &Path, session: &mut Session) -> Result<RestoredWorkspace, String> {
    if !path.exists() { return Ok(RestoredWorkspace { active_id: String::new(), tabs: vec![], warnings: vec![] }); }
    let bytes = document::bounded_read(path, MAX_WORKSPACE_BYTES)?;
    let snapshot: Snapshot = serde_json::from_slice(&bytes).map_err(|error| report("decode drafts", error, "临时文档未能恢复，原恢复文件已保留。请先把新内容保存为文件。"))?;
    if snapshot.version != 1 || snapshot.tabs.len() > 128 { return Err("临时文档版本或数量无法识别，原恢复文件已保留。".into()); }
    let mut seen = HashSet::new();
    for tab in &snapshot.tabs {
        document::validate_id(&tab.id)?;
        validate_view(&tab.view)?;
        if !seen.insert(&tab.id) || tab.path.is_some() == tab.content.is_some() || tab.content.as_ref().is_some_and(|text| text.len() as u64 > MAX_DOCUMENT_BYTES) {
            return Err("临时文档数据不完整，原恢复文件已保留。".into());
        }
    }
    let mut restored = Session::default();
    let mut tabs = Vec::new();
    let mut warnings = Vec::new();
    for tab in snapshot.tabs {
        let document = if let Some(path) = tab.path {
            match document::open_path_encoding(&mut restored, &tab.id, &path, false, tab.encoding.as_deref()) {
                Ok(document) => document,
                Err(_) => { warnings.push(format!("“{}”无法打开，请检查文件位置。", tab.name)); continue; }
            }
        } else {
            let mut document = document::create_document(&mut restored, &tab.id, tab.name)?;
            document.content = tab.content.unwrap_or_default();
            document
        };
        tabs.push(RestoredTab { document, view: tab.view });
    }
    session.documents = restored.documents;
    Ok(RestoredWorkspace { active_id: snapshot.active_id, tabs, warnings })
}

#[tauri::command]
pub async fn load_workspace(app: AppHandle) -> Result<RestoredWorkspace, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<WorkspaceStore>();
        let mut store = store.0.lock().map_err(|error| report("draft lock", error, "临时文档暂时无法读取。"))?;
        let state = app.state::<DocumentState>();
        let mut session = state.lock()?;
        let result = restore(&workspace_path(&app)?, &mut session)?;
        store.loaded = true;
        Ok(result)
    }).await.map_err(|error| report("restore task", error, "临时文档恢复失败，请重新打开墨页。"))?
}

#[tauri::command]
pub async fn save_workspace(app: AppHandle, sequence: u64, active_id: String, tabs: Vec<SnapshotTab>) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<WorkspaceStore>();
        let mut store = store.0.lock().map_err(|error| report("draft lock", error, "临时文档暂时无法保存。"))?;
        if !store.loaded { return Err("原临时文档尚未成功读取，为保护恢复内容，请先把新内容保存为文件。".into()); }
        if sequence <= store.sequence { return Ok(store.sequence); }
        let state = app.state::<DocumentState>();
        let snapshot = { let session = state.lock()?; snapshot(&session, active_id, tabs)? };
        store_snapshot(&workspace_path(&app)?, &snapshot)?;
        store.sequence = sequence;
        Ok(sequence)
    }).await.map_err(|error| report("draft task", error, "临时保存失败，请手动保存文档后再关闭。"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn view() -> ViewState { ViewState { mode: "preview".into(), wrap: "window".into(), preview: ScrollPosition::default(), source: ScrollPosition::default() } }

    #[test]
    fn recover_multiple_large_drafts_without_writing_real_file() {
        let directory = tempfile::tempdir().unwrap();
        let real = directory.path().join("实际 文件.md");
        fs::write(&real, "# 原文件").unwrap();
        let mut session = Session::default();
        document::open_path(&mut session, "file", &real, false).unwrap();
        document::create_document(&mut session, "draft1", "未命名 1.md".into()).unwrap();
        document::create_document(&mut session, "draft2", "未命名 2.md".into()).unwrap();
        let large = "中文草稿".repeat(500_000);
        let data = snapshot(&session, "draft2".into(), vec![
            SnapshotTab { id: "file".into(), content: None, view: view() },
            SnapshotTab { id: "draft1".into(), content: Some(large.clone()), view: view() },
            SnapshotTab { id: "draft2".into(), content: Some("另一份草稿".into()), view: view() },
        ]).unwrap();
        let path = directory.path().join("workspace.json");
        store_snapshot(&path, &data).unwrap();
        let recovered = restore(&path, &mut Session::default()).unwrap();
        assert_eq!(recovered.tabs.len(), 3);
        assert_eq!(recovered.tabs[1].document.content, large);
        assert_eq!(recovered.active_id, "draft2");
        assert_eq!(fs::read_to_string(&real).unwrap(), "# 原文件");
        assert!(snapshot(&session, "file".into(), vec![SnapshotTab { id: "file".into(), content: Some("禁止自动保存".into()), view: view() }]).is_err());
    }

    #[test]
    fn corrupt_snapshot_is_not_overwritten_or_partially_restored() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.json");
        fs::write(&path, b"{broken").unwrap();
        let mut session = Session::default();
        document::create_document(&mut session, "existing", "保留.md".into()).unwrap();
        assert!(restore(&path, &mut session).is_err());
        assert!(session.documents.contains_key("existing"));
        assert_eq!(fs::read(&path).unwrap(), b"{broken");
    }
}
