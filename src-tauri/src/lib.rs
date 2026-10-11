mod commands;
mod images;
mod player;
mod settings;

use std::path::PathBuf;

use plex::{ClientInfo, PlexClient};
use settings::Settings;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub plex: PlexClient,
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("plximg", |ctx, request, responder| {
            images::handle(ctx.app_handle(), request, responder)
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_mpv::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = Settings::load(&settings_path);
            settings.save(&settings_path)?;
            let plex = PlexClient::new(ClientInfo {
                client_id: settings.client_id.clone(),
                product: "PlexRust".into(),
                version: env!("CARGO_PKG_VERSION").into(),
                platform: "Windows".into(),
                device_name: hostname(),
            })?;
            app.manage(images::ImageCache::default());
            app.manage(player::PreviewStore::default());
            app.manage(commands::FilteredLibrary::default());
            app.manage(AppState {
                plex,
                settings: Mutex::new(settings),
                settings_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_session,
            commands::auth_start,
            commands::auth_wait,
            commands::sign_out,
            commands::list_servers,
            commands::select_server,
            commands::library_sections,
            commands::home_hubs,
            commands::section_items,
            commands::filter_values,
            commands::collections,
            commands::collection_items,
            commands::trailers,
            commands::metadata,
            commands::children,
            commands::search,
            commands::get_prefs,
            commands::set_prefs,
            player::playback_info,
            player::transcode_url,
            player::stop_transcode,
            player::report_progress,
            player::load_previews,
            player::remember_tracks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PlexRust".into())
}
