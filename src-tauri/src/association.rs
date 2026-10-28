#[tauri::command]
pub async fn register_file_association(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("请在主窗口设置文件关联。".into()); }
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(register_windows).await
        .map_err(|error| crate::logging::report("register association task", error, "文件关联未完成，请重试。"))?;
    #[cfg(not(target_os = "windows"))]
    Err("当前功能适用于 Windows，请在系统中选择墨页作为默认打开程序。".into())
}

#[cfg(target_os = "windows")]
fn register_windows() -> Result<(), String> {
    use std::{os::windows::process::CommandExt, process::Command};
    use crate::logging::report;
    fn value(key: &str, name: Option<&str>, data: &str) -> Result<(), String> {
        let mut command = Command::new("reg.exe");
        command.creation_flags(0x08000000).args(["add", key]);
        if let Some(name) = name { command.args(["/v", name]); } else { command.arg("/ve"); }
        let output = command.args(["/t", "REG_SZ", "/d", data, "/f"]).output()
            .map_err(|error| report("write file association", error, "无法注册文件关联，请检查当前用户权限。"))?;
        if !output.status.success() {
            return Err(report("register file association", String::from_utf8_lossy(&output.stderr), "文件关联未完成，请检查当前用户权限后重试。"));
        }
        Ok(())
    }
    let executable = std::env::current_exe().map_err(|error| report("association executable", error, "无法定位当前程序，请重新打开后重试。"))?;
    let executable = executable.to_str().ok_or("程序路径无法识别，请移动到其他文件夹后重试。")?;
    let command = format!("\"{executable}\" \"%1\"");
    let prog_id = "Moye.Markdown";
    let classes = r"HKCU\Software\Classes";
    value(&format!(r"{classes}\{prog_id}"), None, "Markdown 文档")?;
    value(&format!(r"{classes}\{prog_id}\DefaultIcon"), None, &format!("\"{executable}\",0"))?;
    value(&format!(r"{classes}\{prog_id}\shell\open\command"), None, &command)?;
    value(&format!(r"{classes}\Applications\moye.exe"), Some("FriendlyAppName"), "墨页")?;
    value(&format!(r"{classes}\Applications\moye.exe\shell\open\command"), None, &command)?;
    let capabilities = r"HKCU\Software\Moye\Capabilities";
    value(capabilities, Some("ApplicationName"), "墨页")?;
    value(capabilities, Some("ApplicationDescription"), "本地 Markdown 编辑器")?;
    for extension in [".md", ".markdown", ".mdown", ".mkd"] {
        value(&format!(r"{classes}\{extension}\OpenWithProgids"), Some(prog_id), "")?;
        value(&format!(r"{classes}\Applications\moye.exe\SupportedTypes"), Some(extension), "")?;
        value(&format!(r"{capabilities}\FileAssociations"), Some(extension), prog_id)?;
    }
    value(r"HKCU\Software\RegisteredApplications", Some("墨页"), r"Software\Moye\Capabilities")?;
    Command::new("explorer.exe").creation_flags(0x08000000)
        .arg("ms-settings:defaultapps?registeredAppUser=墨页").spawn()
        .map_err(|error| report("open default applications", error, "已注册文件关联。请手动打开 Windows 设置 → 应用 → 默认应用，选择墨页。"))?;
    Ok(())
}
