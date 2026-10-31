use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
pub use crate::logging::report;

pub(crate) const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Default)]
pub struct Session {
    pub documents: HashMap<String, Document>,
    pub pending: VecDeque<PathBuf>,
}

#[derive(Default)]
pub struct Document {
    pub current: Option<CurrentDocument>,
    pub name: String,
    revision: u64,
}

pub struct CurrentDocument {
    pub path: PathBuf,
    original_bytes: Vec<u8>,
    crlf: bool,
    bom: bool,
    pub encoding: String,
}

#[derive(Default)]
pub struct DocumentState(pub Mutex<Session>);

impl DocumentState {
    pub fn lock(&self) -> Result<MutexGuard<'_, Session>, String> {
        self.0.lock().map_err(|error| report("session lock", error, "文档暂时无法处理，请重新打开墨页。"))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub id: String,
    pub path: Option<String>,
    pub name: String,
    pub content: String,
    pub line_ending: &'static str,
    pub encoding: String,
}

#[derive(Serialize)]
pub struct ImageData {
    name: String,
    data: String,
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| {
        matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown" | "mkd")
    })
}

pub(crate) fn bounded_read(path: &Path, maximum: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|error| report("open", error, "文件无法打开，请检查文件是否存在以及读取权限。"))?;
    let metadata = file.metadata().map_err(|error| report("metadata", error, "无法读取文件信息，请稍后重试。"))?;
    if !metadata.is_file() { return Err("请选择一个文件。".into()); }
    if metadata.len() > maximum { return Err("文件过大，请选择 16 MB 以内的文档或 8 MB 以内的图片。".into()); }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum + 1).read_to_end(&mut bytes)
        .map_err(|error| report("read", error, "读取文件失败，请稍后重试。"))?;
    if bytes.len() as u64 > maximum { return Err("文件过大，暂时无法载入。".into()); }
    Ok(bytes)
}

fn response(id: &str, current: &CurrentDocument, content: String) -> OpenedDocument {
    OpenedDocument {
        id: id.into(),
        path: Some(current.path.to_string_lossy().into_owned()),
        name: current.path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        content,
        line_ending: if current.crlf { "CRLF" } else { "LF" },
        encoding: current.encoding.clone(),
    }
}

pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return Err("文档标识无效，请重新打开文档。".into());
    }
    Ok(())
}

pub(crate) fn create_document(session: &mut Session, id: &str, name: String) -> Result<OpenedDocument, String> {
    validate_id(id)?;
    if session.documents.contains_key(id) { return Err("文档已经打开，请切换到对应标签。".into()); }
    if session.documents.len() >= 128 { return Err("打开的文档较多，请先关闭部分标签。".into()); }
    session.documents.insert(id.into(), Document { name: name.clone(), ..Default::default() });
    Ok(OpenedDocument { id: id.into(), path: None, name, content: String::new(), line_ending: "LF", encoding: "UTF-8".into() })
}

pub(crate) fn open_path(session: &mut Session, id: &str, path: &Path, reload: bool) -> Result<OpenedDocument, String> {
    open_path_encoding(session, id, path, reload, None)
}

pub(crate) fn open_path_encoding(session: &mut Session, id: &str, path: &Path, reload: bool, encoding: Option<&str>) -> Result<OpenedDocument, String> {
    validate_id(id)?;
    if !is_markdown(path) { return Err("请选择 .md、.markdown、.mdown 或 .mkd 文档。".into()); }
    let path = path.canonicalize().map_err(|error| report("resolve document", error, "文档未找到，请确认文件没有被移动或删除。"))?;
    if !reload {
        for (existing_id, document) in &session.documents {
            if let Some(current) = &document.current {
                if current.path == path { return Ok(response(existing_id, current, String::new())); }
            }
        }
        if session.documents.contains_key(id) { return Err("文档标识已使用，请重新打开。".into()); }
        if session.documents.len() >= 128 { return Err("打开的文档较多，请先关闭部分标签。".into()); }
    }
    let bytes = bounded_read(&path, MAX_DOCUMENT_BYTES)?;
    let (text, encoding, bom) = crate::text_encoding::decode(&bytes, encoding)
        .map_err(|error| report("decode document", &error, &error))?;
    let crlf = text.contains("\r\n");
    let content = text.replace("\r\n", "\n");
    let current = CurrentDocument { path, original_bytes: bytes, crlf, bom, encoding };
    let result = response(id, &current, content);
    let revision = session.documents.get(id).map_or(0, |doc| doc.revision + 1);
    session.documents.insert(id.into(), Document { current: Some(current), name: result.name.clone(), revision });
    Ok(result)
}

#[tauri::command]
pub async fn open_document(app: AppHandle, document_id: String) -> Result<Option<OpenedDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app.dialog().file().add_filter("Markdown 文档", &["md", "markdown", "mdown", "mkd"]).blocking_pick_file();
        let Some(path) = path else { return Ok(None) };
        let path = path.into_path().map_err(|error| report("dialog path", error, "请选择本地文档。"))?;
        let state = app.state::<DocumentState>();
        let mut session = state.lock()?;
        open_path(&mut session, &document_id, &path, false).map(Some)
    }).await.map_err(|error| report("open task", error, "打开文档失败，请重试。"))?
}

#[tauri::command]
pub fn new_document(state: tauri::State<'_, DocumentState>, document_id: String, name: String) -> Result<OpenedDocument, String> {
    let mut session = state.lock()?;
    create_document(&mut session, &document_id, name)
}

#[tauri::command]
pub fn close_document(state: tauri::State<'_, DocumentState>, document_id: String) -> Result<(), String> {
    state.lock()?.documents.remove(&document_id);
    Ok(())
}

#[tauri::command]
pub fn has_pending_file(state: tauri::State<'_, DocumentState>) -> Result<bool, String> {
    let pending = !state.lock()?.pending.is_empty();
    Ok(pending)
}

#[tauri::command]
pub fn discard_pending_file(state: tauri::State<'_, DocumentState>) -> Result<(), String> {
    state.lock()?.pending.pop_front();
    Ok(())
}

#[tauri::command]
pub async fn open_pending_file(app: AppHandle, document_id: String) -> Result<Option<OpenedDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DocumentState>();
        let mut session = state.lock()?;
        let Some(path) = session.pending.pop_front() else { return Ok(None) };
        open_path(&mut session, &document_id, &path, false).map(Some)
    }).await.map_err(|error| report("pending open task", error, "打开文档失败，请重试。"))?
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8], expected: Option<&[u8]>) -> Result<(), String> {
    let parent = path.parent().ok_or("保存位置无效，请选择其他文件夹。")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| report("create temporary", error, "无法保存到此位置，请检查写入权限或另存为。"))?;
    if path.exists() {
        let metadata = fs::metadata(path).map_err(|error| report("save metadata", error, "无法读取原文件信息，请另存为。"))?;
        temporary.as_file().set_permissions(metadata.permissions())
            .map_err(|error| report("preserve permissions", error, "无法保留文件权限，请另存为。"))?;
    }
    temporary.write_all(bytes).and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| report("write temporary", error, "保存失败，原文件尚未更改，请检查磁盘空间。"))?;
    if let Some(expected) = expected {
        let latest = bounded_read(path, MAX_DOCUMENT_BYTES)?;
        if latest != expected {
            return Err("原文件已被其他程序修改。为避免覆盖，请使用“另存为”保存到另一个文件。".into());
        }
    }
    temporary.persist(path).map_err(|error| report("replace file", error.error, "保存失败，原文件尚未替换，请稍后重试或另存为。"))?;
    Ok(())
}

#[tauri::command]
pub async fn save_document(app: AppHandle, document_id: String, content: String, save_as: bool, encoding: Option<String>) -> Result<Option<OpenedDocument>, String> {
    if content.len() as u64 > MAX_DOCUMENT_BYTES { return Err("文档超过 16 MB，请减少嵌入图片或拆分文档后保存。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DocumentState>();
        // 原生对话框期间不能持有文档锁：文件关联回调还需要在 UI 线程排队新文件。
        let (current_path, revision, name) = {
            let session = state.lock()?;
            let doc = session.documents.get(&document_id).ok_or("文档已关闭，请重新打开。")?;
            (doc.current.as_ref().map(|doc| doc.path.clone()), doc.revision, doc.name.clone())
        };
        let mut path = if save_as || current_path.is_none() {
            let default_name = current_path.as_ref().and_then(|path| path.file_name()).and_then(|name| name.to_str()).unwrap_or(&name);
            let mut dialog = app.dialog().file().add_filter("Markdown 文档", &["md", "markdown", "mdown", "mkd"]).set_file_name(default_name);
            if let Some(parent) = current_path.as_ref().and_then(|path| path.parent()) { dialog = dialog.set_directory(parent); }
            let Some(path) = dialog.blocking_save_file() else { return Ok(None) };
            path.into_path().map_err(|error| report("save path", error, "请选择本地保存位置。"))?
        } else { current_path.unwrap() };
        let mut session = state.lock()?;
        let doc = session.documents.get(&document_id).ok_or("文档已关闭，请重新打开。")?;
        if doc.revision != revision { return Err("文档状态已变化，请重新保存。".into()); }
        let current = doc.current.as_ref();
        if path.extension().is_none() { path.set_extension("md"); }
        if !is_markdown(&path) { return Err("请使用 .md、.markdown、.mdown 或 .mkd 扩展名。".into()); }
        if path.exists() {
            path = path.canonicalize().map_err(|error| report("resolve save", error, "保存位置无法访问，请选择其他文件夹。"))?;
        }
        if session.documents.iter().any(|(id, doc)| id != &document_id && doc.current.as_ref().is_some_and(|current| current.path == path)) {
            return Err("此文件已在另一个标签中打开，请切换到对应标签或选择其他保存位置。".into());
        }
        let crlf = current.is_some_and(|doc| doc.crlf);
        let bom = encoding.as_ref().map_or_else(|| current.is_some_and(|doc| doc.bom), |name| matches!(name.as_str(), "UTF-8 BOM" | "UTF-16LE" | "UTF-16BE"));
        let encoding = encoding.unwrap_or_else(|| current.map_or_else(|| "UTF-8".into(), |doc| doc.encoding.clone()));
        let normalized = content.replace("\r\n", "\n");
        let disk_text = if crlf { normalized.replace('\n', "\r\n") } else { normalized.clone() };
        let bytes = crate::text_encoding::encode(&disk_text, &encoding, bom)
            .map_err(|error| report("encode document", &error, &error))?;
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES { return Err("文档保存后超过 16 MB，请拆分文档后保存。".into()); }
        let expected = current.filter(|doc| doc.path == path).map(|doc| doc.original_bytes.as_slice());
        write_atomic(&path, &bytes, expected)?;
        let path = path.canonicalize().map_err(|error| report("resolve saved file", error, "文档已写入，但保存位置无法确认，请重新打开文档。"))?;
        let current = CurrentDocument { path, original_bytes: bytes, crlf, bom, encoding };
        let result = response(&document_id, &current, normalized);
        session.documents.insert(document_id, Document { current: Some(current), name: result.name.clone(), revision: revision + 1 });
        Ok(Some(result))
    }).await.map_err(|error| report("save task", error, "保存文档失败，请重试。"))?
}

#[tauri::command]
pub async fn check_document(app: AppHandle, document_id: String) -> Result<&'static str, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DocumentState>();
        let session = state.lock()?;
        let current = session.documents.get(&document_id).and_then(|doc| doc.current.as_ref());
        let Some(current) = current else { return Ok("unchanged") };
        match fs::metadata(&current.path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok("missing"),
            Err(error) => return Err(report("check file", error, "无法检查文档，请确认文件位置和读取权限。")),
            Ok(metadata) if metadata.len() != current.original_bytes.len() as u64 => return Ok("changed"),
            _ => {}
        }
        Ok(if bounded_read(&current.path, MAX_DOCUMENT_BYTES)? == current.original_bytes { "unchanged" } else { "changed" })
    }).await.map_err(|error| report("check task", error, "文档检查失败，请稍后重试。"))?
}

#[tauri::command]
pub async fn reload_document(app: AppHandle, document_id: String, encoding: Option<String>) -> Result<OpenedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DocumentState>();
        let mut session = state.lock()?;
        let current = session.documents.get(&document_id).and_then(|doc| doc.current.as_ref()).ok_or("文档尚未保存为文件。")?;
        let path = current.path.clone();
        let encoding = encoding.unwrap_or_else(|| current.encoding.clone());
        open_path_encoding(&mut session, &document_id, &path, true, Some(&encoding))
    }).await.map_err(|error| report("reload task", error, "重新加载失败，当前内容已保留。"))?
}

#[tauri::command]
pub async fn reveal_document(app: AppHandle, document_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app.state::<DocumentState>().lock()?.documents.get(&document_id)
            .and_then(|doc| doc.current.as_ref()).map(|doc| doc.path.clone()).ok_or("请先将文档保存为本地文件。")?;
        if !path.exists() { return Err("文件已移动或删除，无法定位。".into()); }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let path = path.to_string_lossy();
            let path = if let Some(network) = path.strip_prefix(r"\\?\UNC\") { format!(r"\\{network}") }
                else { path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned() };
            std::process::Command::new("explorer.exe").creation_flags(0x08000000)
                .arg(format!("/select,{path}")).spawn()
                .map_err(|error| report("reveal file", error, "资源管理器无法打开，请重试。"))?;
        }
        #[cfg(target_os = "macos")]
        std::process::Command::new("open").arg("-R").arg(&path).spawn()
            .map_err(|error| report("reveal file", error, "文件管理器无法打开，请重试。"))?;
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        std::process::Command::new("xdg-open").arg(path.parent().ok_or("文件位置无效。")?).spawn()
            .map_err(|error| report("reveal file", error, "文件管理器无法打开，请重试。"))?;
        Ok(())
    }).await.map_err(|error| report("reveal task", error, "打开文件位置失败，请重试。"))?
}

fn image_data(path: &Path) -> Result<String, String> {
    let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif",
        "webp" => "image/webp", "avif" => "image/avif", "bmp" => "image/bmp", "svg" => "image/svg+xml",
        _ => return Err("请选择 PNG、JPEG、GIF、WebP、AVIF、BMP 或 SVG 图片。".into()),
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bounded_read(path, MAX_IMAGE_BYTES)?)))
}

#[tauri::command]
pub async fn read_image(app: AppHandle, document_id: String, relative_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DocumentState>();
        let session = state.lock()?;
        let parent = session.documents.get(&document_id).and_then(|doc| doc.current.as_ref()).and_then(|doc| doc.path.parent()).ok_or("请先保存文档，再使用相对路径图片。")?;
        let base = tauri::Url::from_directory_path(parent).map_err(|_| "文档位置无法识别。")?;
        let url = base.join(&relative_path).map_err(|error| report("image url", error, "图片路径无效。"))?;
        let path = url.to_file_path().map_err(|_| "仅支持本地图片。")?;
        let path = path.canonicalize().map_err(|error| report("image path", error, "本地图片未找到。"))?;
        if !path.starts_with(parent) { return Err("相对路径图片需要位于文档所在文件夹内，可使用“插入本地图片”嵌入其他图片。".into()); }
        image_data(&path)
    }).await.map_err(|error| report("image task", error, "图片读取失败。"))?
}

#[tauri::command]
pub async fn pick_image(app: AppHandle) -> Result<Option<ImageData>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app.dialog().file().add_filter("图片", &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"]).blocking_pick_file() else { return Ok(None) };
        let path = path.into_path().map_err(|error| report("pick image path", error, "请选择本地图片。"))?;
        Ok(Some(ImageData { name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), data: image_data(&path)? }))
    }).await.map_err(|error| report("pick image task", error, "图片打开失败。"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserve_encoding_and_detect_conflicting_save() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("中文 文档.md");
        let bytes = b"\xef\xbb\xbf# title\r\n\r\nhello\r\n";
        fs::write(&path, bytes).unwrap();
        let mut session = Session::default();
        let document = open_path(&mut session, "first", &path, false).unwrap();
        assert_eq!(document.content, "# title\n\nhello\n");
        assert_eq!(document.line_ending, "CRLF");
        assert!(session.documents["first"].current.as_ref().unwrap().bom);
        fs::write(&path, b"external edit").unwrap();
        assert!(write_atomic(&path, b"replacement", Some(bytes)).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external edit");
        write_atomic(&path, b"saved", Some(b"external edit")).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"saved");
    }

    #[test]
    fn reject_non_markdown_and_explicit_invalid_utf8() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("invalid.md");
        fs::write(&path, [0xff, 0xff]).unwrap();
        let mut session = Session::default();
        assert!(open_path_encoding(&mut session, "invalid", &path, false, Some("UTF-8")).is_err());
        assert!(!is_markdown(Path::new("secret.env")));
        assert!(is_markdown(Path::new("notes.MD")));
    }

    #[test]
    fn tabs_keep_separate_files_and_release_handles() {
        let folder = tempfile::tempdir().unwrap();
        let first = folder.path().join("第一份.md");
        let second = folder.path().join("第二份.md");
        fs::write(&first, "第一份内容").unwrap();
        fs::write(&second, "第二份内容").unwrap();
        let mut session = Session::default();
        open_path(&mut session, "first", &first, false).unwrap();
        open_path(&mut session, "second", &second, false).unwrap();
        assert_eq!(open_path(&mut session, "duplicate", &first, false).unwrap().id, "first");
        assert_eq!(session.documents.len(), 2);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // 其他软件能够取得独占句柄，说明应用没有保留读取句柄锁住文件。
            let handle = fs::OpenOptions::new().read(true).write(true).share_mode(0).open(&first).unwrap();
            drop(handle);
        }
        fs::write(&first, "外部更新").unwrap();
        let reloaded = open_path(&mut session, "first", &first, true).unwrap();
        assert_eq!(reloaded.content, "外部更新");
        assert_eq!(session.documents["second"].current.as_ref().unwrap().original_bytes, "第二份内容".as_bytes());
    }
}
