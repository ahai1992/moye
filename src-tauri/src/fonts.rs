use crate::logging::report;

#[tauri::command]
pub async fn installed_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(enumerate).await
        .map_err(|error| report("enumerate fonts task", error, "读取本机字体失败，请重试。"))?
}

fn enumerate() -> Result<Vec<String>, String> {
    let mut names = platform_fonts()?;
    names.retain(|name| !name.trim().is_empty() && !name.starts_with('@'));
    names.sort_unstable_by_key(|name| name.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    if names.is_empty() {
        return Err(report("enumerate fonts", "no font families returned", "未能读取到本机字体，请重试。"));
    }
    Ok(names)
}

#[cfg(target_os = "windows")]
fn platform_fonts() -> Result<Vec<String>, String> {
    use std::ffi::c_void;

    // LOGFONTW 的字段顺序与 Windows SDK 一致，回调参数指向 ENUMLOGFONTEXW 的首个字段。
    #[repr(C)]
    struct LogFont {
        height: i32, width: i32, escapement: i32, orientation: i32, weight: i32,
        italic: u8, underline: u8, strike_out: u8, char_set: u8,
        out_precision: u8, clip_precision: u8, quality: u8, pitch_and_family: u8,
        face_name: [u16; 32],
    }
    type FontCallback = unsafe extern "system" fn(*const LogFont, *const c_void, u32, isize) -> i32;
    #[link(name = "user32")]
    extern "system" {
        fn GetDC(window: *mut c_void) -> *mut c_void;
        fn ReleaseDC(window: *mut c_void, dc: *mut c_void) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn EnumFontFamiliesExW(dc: *mut c_void, font: *const LogFont, callback: FontCallback, data: isize, flags: u32) -> i32;
    }
    unsafe extern "system" fn collect(font: *const LogFont, _: *const c_void, _: u32, data: isize) -> i32 {
        let face = &(*font).face_name;
        let end = face.iter().position(|character| *character == 0).unwrap_or(face.len());
        let names = &mut *(data as *mut Vec<String>);
        names.push(String::from_utf16_lossy(&face[..end]));
        1
    }

    unsafe {
        let dc = GetDC(std::ptr::null_mut());
        if dc.is_null() {
            return Err(report("font device context", std::io::Error::last_os_error(), "读取本机字体失败，请重试。"));
        }
        let mut font: LogFont = std::mem::zeroed();
        font.char_set = 1; // DEFAULT_CHARSET：枚举所有字符集中的字体家族。
        let mut names = Vec::new();
        let result = EnumFontFamiliesExW(dc, &font, collect, &mut names as *mut Vec<String> as isize, 0);
        ReleaseDC(std::ptr::null_mut(), dc);
        if result == 0 && names.is_empty() {
            return Err(report("enumerate Windows fonts", "GDI returned no fonts", "读取本机字体失败，请重试。"));
        }
        Ok(names)
    }
}

#[cfg(target_os = "macos")]
fn platform_fonts() -> Result<Vec<String>, String> {
    use std::ffi::{c_char, c_void};
    #[link(name = "CoreText", kind = "framework")]
    extern "C" { fn CTFontManagerCopyAvailableFontFamilyNames() -> *const c_void; }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
        fn CFStringGetLength(string: *const c_void) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(string: *const c_void, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
        fn CFRelease(value: *const c_void);
    }
    unsafe {
        let families = CTFontManagerCopyAvailableFontFamilyNames();
        if families.is_null() {
            return Err(report("enumerate macOS fonts", "CoreText returned null", "读取本机字体失败，请重试。"));
        }
        let mut names = Vec::new();
        for index in 0..CFArrayGetCount(families) {
            let value = CFArrayGetValueAtIndex(families, index);
            let capacity = CFStringGetMaximumSizeForEncoding(CFStringGetLength(value), 0x08000100) + 1;
            if capacity <= 0 { continue; }
            let mut bytes = vec![0u8; capacity as usize];
            if CFStringGetCString(value, bytes.as_mut_ptr().cast(), capacity, 0x08000100) != 0 {
                let end = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
                names.push(String::from_utf8_lossy(&bytes[..end]).into_owned());
            }
        }
        CFRelease(families);
        Ok(names)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_fonts() -> Result<Vec<String>, String> {
    let output = std::process::Command::new("fc-list").args(["--format", "%{family}\n"]).output()
        .map_err(|error| report("run fontconfig", error, "读取本机字体失败，请确认系统已安装 Fontconfig 后重试。"))?;
    if !output.status.success() {
        return Err(report("enumerate Fontconfig fonts", String::from_utf8_lossy(&output.stderr), "读取本机字体失败，请重试。"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).lines().flat_map(|line| line.split(','))
        .map(|name| name.trim().to_owned()).collect())
}
