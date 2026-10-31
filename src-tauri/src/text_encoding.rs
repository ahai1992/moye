use encoding_rs::{Encoding, UTF_8, UTF_16LE, UTF_16BE, GB18030};

pub fn lookup(name: &str) -> Result<&'static Encoding, String> {
    match name {
        "UTF-8" | "UTF-8 BOM" => Ok(UTF_8),
        "UTF-16LE" => Ok(UTF_16LE),
        "UTF-16BE" => Ok(UTF_16BE),
        "GBK" => Ok(encoding_rs::GBK),
        "GB18030" => Ok(GB18030),
        "Big5" => Ok(encoding_rs::BIG5),
        "Shift_JIS" => Ok(encoding_rs::SHIFT_JIS),
        "Windows-1252" => Ok(encoding_rs::WINDOWS_1252),
        _ => Err("请选择支持的文本编码。".into()),
    }
}

pub fn decode(bytes: &[u8], requested: Option<&str>) -> Result<(String, String, bool), String> {
    let detected = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) { Some(("UTF-8 BOM", 3)) }
        else if bytes.starts_with(&[0xff, 0xfe]) { Some(("UTF-16LE", 2)) }
        else if bytes.starts_with(&[0xfe, 0xff]) { Some(("UTF-16BE", 2)) } else { None };
    let name = match requested {
        Some(name) => name,
        None => detected.map(|item| item.0).unwrap_or_else(|| {
            if std::str::from_utf8(bytes).is_ok() { "UTF-8" }
            else if GB18030.decode_without_bom_handling_and_without_replacement(bytes).is_some() { "GB18030" }
            else { "Windows-1252" }
        }),
    };
    let encoding = lookup(name)?;
    let skip = detected.filter(|(label, _)| lookup(label).ok() == Some(encoding)).map_or(0, |item| item.1);
    let text = encoding.decode_without_bom_handling_and_without_replacement(&bytes[skip..])
        .ok_or_else(|| format!("无法按 {name} 完整读取此文件，请选择其他编码。"))?;
    Ok((text.into_owned(), name.into(), skip > 0))
}

pub fn encode(text: &str, name: &str, bom: bool) -> Result<Vec<u8>, String> {
    let encoding = lookup(name)?;
    let mut bytes = Vec::new();
    if encoding == UTF_16LE || encoding == UTF_16BE {
        if bom { bytes.extend_from_slice(if encoding == UTF_16LE { &[0xff, 0xfe] } else { &[0xfe, 0xff] }); }
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&if encoding == UTF_16LE { unit.to_le_bytes() } else { unit.to_be_bytes() });
        }
    } else {
        if encoding == UTF_8 && bom { bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]); }
        let (encoded, _, failed) = encoding.encode(text);
        if failed || encoding.decode_without_bom_handling_and_without_replacement(&encoded).as_deref() != Some(text) {
            return Err(format!("当前文字无法完整保存为 {name}，原文件未修改。请选择 UTF-8 或其他可表示这些文字的编码。"));
        }
        bytes.extend_from_slice(&encoded);
    }
    Ok(bytes)
}
