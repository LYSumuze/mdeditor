use tauri::Manager;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

// ============ File Dialogs ============

#[tauri::command]
async fn show_open_dialog(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app_handle.dialog()
        .file()
        .set_title("选择文件夹")
        .blocking_pick_folder();
    
    match result {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

// ============ File System Operations ============

#[tauri::command]
fn read_directory(dir_path: String) -> Result<Vec<serde_json::Value>, String> {
    let path = PathBuf::from(&dir_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Directory not found: {}", dir_path));
    }
    
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&path).map_err(|e| e.to_string())?;
    
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map_err(|e| e.to_string())?.is_dir();
        let full_path = entry.path().to_string_lossy().to_string();
        
        entries.push(serde_json::json!({
            "name": name,
            "isDirectory": is_dir,
            "path": full_path,
        }));
    }
    
    Ok(entries)
}

#[tauri::command]
fn read_file_content(file_path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Ok(None);
    }
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_file_content(file_path: String, content: String) -> Result<bool, String> {
    let path = PathBuf::from(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match fs::write(&path, content) {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn create_file_cmd(file_path: String) -> Result<bool, String> {
    let path = PathBuf::from(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match fs::write(&path, "") {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_file_cmd(file_path: String) -> Result<bool, String> {
    match fs::remove_file(&file_path) {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn rename_file_cmd(old_path: String, new_path: String) -> Result<bool, String> {
    match fs::rename(&old_path, &new_path) {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn create_directory_cmd(dir_path: String) -> Result<bool, String> {
    match fs::create_dir_all(&dir_path) {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_directory_cmd(dir_path: String) -> Result<bool, String> {
    match fs::remove_dir_all(&dir_path) {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

// ============ Version History ============

#[tauri::command]
fn save_version(folder_path: String, file_name: String, version_id: String, content: String) -> Result<bool, String> {
    let versions_dir = PathBuf::from(&folder_path).join(".versions").join(&file_name);
    fs::create_dir_all(&versions_dir).map_err(|e| e.to_string())?;
    let version_file = versions_dir.join(format!("{}.md", version_id));
    match fs::write(&version_file, &content) {
        Ok(_) => {
            if let Ok(entries) = fs::read_dir(&versions_dir) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        if name.ends_with(".md") {
                            Some(name.trim_end_matches(".md").to_string())
                        } else {
                            None
                        }
                    })
                    .collect();
                versions.sort();
                versions.reverse();
                for old_ver in versions.iter().skip(10) {
                    let _ = fs::remove_file(versions_dir.join(format!("{}.md", old_ver)));
                }
            }
            Ok(true)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn get_version_history(folder_path: String, file_name: String) -> Result<Vec<serde_json::Value>, String> {
    let versions_dir = PathBuf::from(&folder_path).join(".versions").join(&file_name);
    if !versions_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut versions = Vec::new();
    let read_dir = fs::read_dir(&versions_dir).map_err(|e| e.to_string())?;
    
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".md") {
            let version = name.trim_end_matches(".md").to_string();
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            // Simple ISO-like timestamp from millis (no chrono dependency)
            let time = version.parse::<i64>()
                .map(|ts| {
                    let secs = ts / 1000;
                    let mins = (secs % 86400) / 60;
                    let hours = mins / 60;
                    let remaining_mins = mins % 60;
                    let days = secs / 86400;
                    // Approximate date from epoch days
                    let base_year = 1970;
                    let mut year = base_year;
                    let mut remaining_days = days;
                    loop {
                        let year_days = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) { 366 } else { 365 };
                        if remaining_days < year_days { break; }
                        remaining_days -= year_days;
                        year += 1;
                    }
                    let month_days = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
                        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
                    } else {
                        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
                    };
                    let mut month = 0;
                    for (i, &md) in month_days.iter().enumerate() {
                        if remaining_days < md { month = i; break; }
                        remaining_days -= md;
                        if i == 11 { month = 11; }
                    }
                    let day = remaining_days + 1;
                    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month + 1, day, hours, remaining_mins, secs % 60)
                })
                .unwrap_or_default();
            versions.push(serde_json::json!({
                "version": version,
                "time": time,
                "size": metadata.len(),
            }));
        }
    }
    
    versions.sort_by(|a, b| {
        let va = a["version"].as_str().unwrap_or("").parse::<i64>().unwrap_or(0);
        let vb = b["version"].as_str().unwrap_or("").parse::<i64>().unwrap_or(0);
        vb.cmp(&va)
    });
    
    Ok(versions)
}

#[tauri::command]
fn get_version_content(folder_path: String, file_name: String, version_id: String) -> Result<Option<String>, String> {
    let version_file = PathBuf::from(&folder_path)
        .join(".versions")
        .join(&file_name)
        .join(format!("{}.md", version_id));
    
    if !version_file.exists() {
        return Ok(None);
    }
    
    match fs::read_to_string(&version_file) {
        Ok(content) => Ok(Some(content)),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_version_file(folder_path: String, file_name: String, version_id: String) -> Result<bool, String> {
    let version_file = PathBuf::from(&folder_path)
        .join(".versions")
        .join(&file_name)
        .join(format!("{}.md", version_id));
    
    if !version_file.exists() {
        return Ok(false);
    }
    
    match fs::remove_file(&version_file) {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

// ============ Error Log ============

#[tauri::command]
fn write_error_log(app_handle: tauri::AppHandle, log_content: String) -> Result<Option<String>, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let log_file_name = format!("md-editor-error-log-{}.txt", timestamp);
    
    let log_path = app_handle.path().resource_dir()
        .map(|dir| dir.join(&log_file_name))
        .unwrap_or_else(|_| PathBuf::from(&log_file_name));
    
    match fs::write(&log_path, &log_content) {
        Ok(_) => Ok(Some(log_path.to_string_lossy().to_string())),
        Err(e) => Err(e.to_string()),
    }
}

// ============ App Setup ============

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(|_app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_open_dialog,
            read_directory,
            read_file_content,
            write_file_content,
            create_file_cmd,
            delete_file_cmd,
            rename_file_cmd,
            create_directory_cmd,
            delete_directory_cmd,
            save_version,
            get_version_history,
            get_version_content,
            delete_version_file,
            write_error_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
