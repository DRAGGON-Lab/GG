use serde::{Deserialize, Serialize};

const DEFAULT_TEXT_EDITOR_FONT: &str =
    "IBM Plex Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace";
const DEFAULT_TEXT_EDITOR_FONT_SIZE: u16 = 13;
const MIN_TEXT_EDITOR_FONT_SIZE: u16 = 9;
const MAX_TEXT_EDITOR_FONT_SIZE: u16 = 28;
/// Activity-rail defaults (order + hidden-by-default items) live in ONE place —
/// `apps/desktop/src/features/settings/activity-order.json` — and are shared
/// verbatim with the frontend so the two can never drift. Rust embeds the file
/// at compile time; the frontend imports the same JSON directly.
static ACTIVITY_RAIL_DEFAULTS: std::sync::LazyLock<ActivityRailDefaults> =
    std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!(
            "../../../../apps/desktop/src/features/settings/activity-order.json"
        ))
        .expect("bundled activity-order.json must be valid JSON")
    });

#[derive(Deserialize)]
struct ActivityRailDefaults {
    order: Vec<String>,
    hidden: Vec<String>,
}
const DEFAULT_BACKUP_INTERVAL_MINUTES: u64 = 60;
const MIN_BACKUP_INTERVAL_MINUTES: u64 = 15;
const MAX_BACKUP_INTERVAL_MINUTES: u64 = 7 * 24 * 60;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_activity_order")]
    pub activity_order: Vec<String>,
    #[serde(default = "default_hidden_activity_items")]
    pub hidden_activity_items: Vec<String>,
    #[serde(default)]
    pub platform: PlatformSettings,
    #[serde(default)]
    pub backup: BackupSettings,
    #[serde(default)]
    pub workspace: WorkspaceSettings,
    #[serde(default)]
    pub text_editor: TextEditorSettings,
}

impl AppSettings {
    pub fn normalized(mut self) -> Self {
        let existing_activity_order_includes_default_hidden_items =
            ACTIVITY_RAIL_DEFAULTS.hidden.iter().all(|item| {
                self.activity_order
                    .iter()
                    .any(|candidate| candidate == item)
            });

        self.activity_order = normalize_activity_order(self.activity_order);
        self.hidden_activity_items = normalize_activity_collection(self.hidden_activity_items);
        if !existing_activity_order_includes_default_hidden_items {
            self.hidden_activity_items =
                include_default_hidden_activity_items(self.hidden_activity_items);
        }
        self.platform = self.platform.normalized();
        self.backup = self.backup.normalized();
        self.workspace = self.workspace.normalized();
        self.text_editor = self.text_editor.normalized();
        self
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            activity_order: default_activity_order(),
            hidden_activity_items: default_hidden_activity_items(),
            platform: PlatformSettings::default(),
            backup: BackupSettings::default(),
            workspace: WorkspaceSettings::default(),
            text_editor: TextEditorSettings::default(),
        }
    }
}

/// The Bio Eng Studio platform account this install is signed into. Tokens live in
/// the OS keychain; these are the non-secret identifiers plus the server URL
/// (the local-development knob).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSettings {
    #[serde(default = "default_platform_server_url")]
    pub server_url: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub account_email: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    /// Shared platform conversation for one-shot inference (for example, title
    /// generation).
    #[serde(default)]
    pub utility_conversation_id: Option<String>,
}

impl PlatformSettings {
    fn normalized(mut self) -> Self {
        let trimmed = self.server_url.trim().trim_end_matches('/');
        self.server_url = if trimmed.is_empty() {
            default_platform_server_url()
        } else {
            trimmed.to_string()
        };
        self.account_id = normalize_optional(self.account_id);
        self.account_email = normalize_optional(self.account_email);
        self.workspace_id = normalize_optional(self.workspace_id);
        self.device_id = normalize_optional(self.device_id);
        self.utility_conversation_id = normalize_optional(self.utility_conversation_id);
        self
    }
}

impl Default for PlatformSettings {
    fn default() -> Self {
        Self {
            server_url: default_platform_server_url(),
            account_id: None,
            account_email: None,
            workspace_id: None,
            device_id: None,
            utility_conversation_id: None,
        }
    }
}

fn default_platform_server_url() -> String {
    "https://api.bioeng.build".to_string()
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    #[serde(default)]
    pub local_folder: Option<String>,
    #[serde(default = "default_automatic_backups_enabled")]
    pub automatic_backups_enabled: bool,
    #[serde(default = "default_backup_interval_minutes")]
    pub automatic_interval_minutes: u64,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub device_name: String,
    #[serde(default)]
    pub master_key_created_at: Option<String>,
    #[serde(default)]
    pub recovery_key_exported_at: Option<String>,
    #[serde(default)]
    pub last_automatic_backup_attempted_at: Option<String>,
    #[serde(default)]
    pub last_backup: Option<BackupSnapshotSettings>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            local_folder: None,
            automatic_backups_enabled: default_automatic_backups_enabled(),
            automatic_interval_minutes: default_backup_interval_minutes(),
            device_id: String::new(),
            device_name: String::new(),
            master_key_created_at: None,
            recovery_key_exported_at: None,
            last_automatic_backup_attempted_at: None,
            last_backup: None,
        }
    }
}

impl BackupSettings {
    fn normalized(mut self) -> Self {
        self.local_folder = self
            .local_folder
            .and_then(|path| non_empty_string(path.trim().to_string()));
        self.automatic_interval_minutes = self
            .automatic_interval_minutes
            .clamp(MIN_BACKUP_INTERVAL_MINUTES, MAX_BACKUP_INTERVAL_MINUTES);
        self.device_id = self.device_id.trim().to_string();
        self.device_name = self.device_name.trim().to_string();
        self.master_key_created_at = self
            .master_key_created_at
            .and_then(|value| non_empty_string(value.trim().to_string()));
        self.recovery_key_exported_at = self
            .recovery_key_exported_at
            .and_then(|value| non_empty_string(value.trim().to_string()));
        self.last_automatic_backup_attempted_at = self
            .last_automatic_backup_attempted_at
            .and_then(|value| non_empty_string(value.trim().to_string()));
        self
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSnapshotSettings {
    pub id: String,
    pub created_at: String,
    pub total_bytes: u64,
    pub schema_version: i64,
    pub attachment_count: usize,
}

fn non_empty_string(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn default_automatic_backups_enabled() -> bool {
    true
}

fn default_backup_interval_minutes() -> u64 {
    DEFAULT_BACKUP_INTERVAL_MINUTES
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceConfig>,
}

impl WorkspaceSettings {
    fn normalized(mut self) -> Self {
        let mut workspaces = Vec::with_capacity(self.workspaces.len());
        let mut workspace_ids = Vec::with_capacity(self.workspaces.len());

        for workspace in self.workspaces {
            if let Some(workspace) = workspace.normalized() {
                if !workspace_ids.contains(&workspace.id) {
                    workspace_ids.push(workspace.id.clone());
                    workspaces.push(workspace);
                }
            }
        }

        self.active_workspace_id = self
            .active_workspace_id
            .and_then(|id| non_empty_string(id.trim().to_string()))
            .filter(|id| workspace_ids.contains(id));
        self.workspaces = workspaces;
        self
    }
}

/// Whether a workspace was created and is owned by the app (lives under
/// `~/Bio Eng Studio/Projects`, git-initialized by us) or was opened from an
/// arbitrary existing folder. Existing persisted workspaces deserialize as
/// `External`, which keeps every prior workspace working unchanged.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceKind {
    Managed,
    #[default]
    External,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub root: String,
    #[serde(default)]
    pub kind: WorkspaceKind,
    /// Whether automatic history (git checkpoints) is on. `None` means "not yet
    /// asked" — only meaningful for external workspaces, where we ask once
    /// before touching the user's folder. Managed workspaces are forced to
    /// `Some(true)` in [`Self::normalized`].
    #[serde(default)]
    pub history_enabled: Option<bool>,
    #[serde(default)]
    pub last_opened_at: Option<String>,
    #[serde(default)]
    pub last_path: Option<String>,
}

impl WorkspaceConfig {
    fn normalized(mut self) -> Option<Self> {
        self.id = self.id.trim().to_string();
        self.root = self.root.trim().to_string();

        if self.id.is_empty() || self.root.is_empty() {
            return None;
        }

        self.name = non_empty_string(self.name.trim().to_string())
            .unwrap_or_else(|| display_name_from_root(&self.root));
        // Managed workspaces always keep history; we created and own them.
        if self.kind == WorkspaceKind::Managed {
            self.history_enabled = Some(true);
        }
        self.last_opened_at = self
            .last_opened_at
            .and_then(|value| non_empty_string(value.trim().to_string()));
        self.last_path = self
            .last_path
            .and_then(|value| non_empty_string(value.trim().to_string()));

        Some(self)
    }
}

fn display_name_from_root(root: &str) -> String {
    root.rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| root.to_string())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEditorSettings {
    #[serde(default = "default_text_editor_font")]
    pub font_family: String,
    #[serde(default = "default_text_editor_font_size")]
    pub font_size: u16,
    #[serde(default)]
    pub keymap: TextEditorKeymap,
    #[serde(default)]
    pub theme: TextEditorTheme,
}

impl TextEditorSettings {
    fn normalized(mut self) -> Self {
        if self.font_family.trim().is_empty() {
            self.font_family = DEFAULT_TEXT_EDITOR_FONT.to_string();
        }

        self.font_size = self
            .font_size
            .clamp(MIN_TEXT_EDITOR_FONT_SIZE, MAX_TEXT_EDITOR_FONT_SIZE);

        self
    }
}

impl Default for TextEditorSettings {
    fn default() -> Self {
        Self {
            font_family: DEFAULT_TEXT_EDITOR_FONT.to_string(),
            font_size: DEFAULT_TEXT_EDITOR_FONT_SIZE,
            keymap: TextEditorKeymap::Default,
            theme: TextEditorTheme::MatchApp,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum TextEditorKeymap {
    #[default]
    Default,
    Vim,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum TextEditorTheme {
    #[default]
    MatchApp,
    Light,
    Dark,
}

fn default_text_editor_font() -> String {
    DEFAULT_TEXT_EDITOR_FONT.to_string()
}

fn default_text_editor_font_size() -> u16 {
    DEFAULT_TEXT_EDITOR_FONT_SIZE
}

fn default_activity_order() -> Vec<String> {
    ACTIVITY_RAIL_DEFAULTS.order.clone()
}

fn default_hidden_activity_items() -> Vec<String> {
    ACTIVITY_RAIL_DEFAULTS.hidden.clone()
}

fn normalize_activity_order(activity_order: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::with_capacity(ACTIVITY_RAIL_DEFAULTS.order.len());

    for item in activity_order {
        if ACTIVITY_RAIL_DEFAULTS.order.contains(&item) && !normalized.contains(&item) {
            normalized.push(item);
        }
    }

    for item in default_activity_order() {
        if !normalized.contains(&item) {
            normalized.push(item);
        }
    }

    normalized
}

fn normalize_activity_collection(activity_items: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::with_capacity(ACTIVITY_RAIL_DEFAULTS.order.len());

    for item in activity_items {
        if ACTIVITY_RAIL_DEFAULTS.order.contains(&item) && !normalized.contains(&item) {
            normalized.push(item);
        }
    }

    normalized
}

fn include_default_hidden_activity_items(activity_items: Vec<String>) -> Vec<String> {
    let mut normalized = normalize_activity_collection(activity_items);

    for item in default_hidden_activity_items() {
        if !normalized.contains(&item) {
            normalized.push(item);
        }
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::AppSettings;
    use serde_json::json;

    #[test]
    fn activity_rail_defaults_load_from_shared_json() {
        // Guards the shared-JSON wiring: the include_str! path resolves, the
        // file parses, and Editor is the default first item.
        let order = super::default_activity_order();
        assert_eq!(order.first().map(String::as_str), Some("Editor"));
        assert_eq!(order.len(), 3);
        assert!(super::default_hidden_activity_items().is_empty());
    }

    #[test]
    fn app_settings_serialization_omits_secret_like_ai_fields() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "ai": {
                "selectedProvider": "anthropic",
                "providers": {
                    "anthropic": {
                        "keyPresent": true,
                        "apiKey": "sk-anthropic-secret",
                        "refreshToken": "refresh-secret",
                        "lastValidationError": "invalid"
                    },
                    "openai": {
                        "apiKey": "sk-openai-secret"
                    }
                }
            }
        }))
        .unwrap()
        .normalized();
        let serialized = serde_json::to_string(&settings).unwrap();

        // The legacy `ai` block (and anything secret-like inside it) is
        // dropped wholesale on round-trip.
        assert!(!serialized.contains("sk-anthropic-secret"));
        assert!(!serialized.contains("sk-openai-secret"));
        assert!(!serialized.contains("refresh-secret"));
        assert!(!serialized.contains("apiKey"));
        assert!(!serialized.contains("refreshToken"));
        assert!(!serialized.contains("providers"));
        assert!(serialized.contains("\"platform\""));
    }

    #[test]
    fn workspace_settings_drop_invalid_workspaces_and_preserve_active_workspace() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "workspace": {
                "activeWorkspaceId": "math",
                "workspaces": [
                    {
                        "id": "math",
                        "name": "",
                        "root": "/Users/example/math",
                        "lastPath": "main.py"
                    },
                    {
                        "id": "math",
                        "name": "Duplicate",
                        "root": "/Users/example/duplicate"
                    },
                    {
                        "id": "",
                        "root": "/Users/example/invalid"
                    }
                ]
            }
        }))
        .unwrap()
        .normalized();

        assert_eq!(
            settings.workspace.active_workspace_id.as_deref(),
            Some("math")
        );
        assert_eq!(settings.workspace.workspaces.len(), 1);
        assert_eq!(settings.workspace.workspaces[0].name, "math");
        assert_eq!(
            settings.workspace.workspaces[0].last_path.as_deref(),
            Some("main.py")
        );
    }

    #[test]
    fn workspace_kind_defaults_external_and_managed_forces_history() {
        use super::WorkspaceKind;

        let settings = serde_json::from_value::<AppSettings>(json!({
            "workspace": {
                "workspaces": [
                    // Legacy workspace with no `kind` — must read as External.
                    { "id": "legacy", "root": "/Users/example/legacy" },
                    // Managed workspace — history is forced on regardless of input.
                    {
                        "id": "managed",
                        "root": "/Users/example/Bio Eng Studio/Projects/managed",
                        "kind": "managed",
                        "historyEnabled": false
                    }
                ]
            }
        }))
        .unwrap()
        .normalized();

        let legacy = &settings.workspace.workspaces[0];
        assert_eq!(legacy.kind, WorkspaceKind::External);
        assert_eq!(legacy.history_enabled, None);

        let managed = &settings.workspace.workspaces[1];
        assert_eq!(managed.kind, WorkspaceKind::Managed);
        assert_eq!(managed.history_enabled, Some(true));
    }

    #[test]
    fn legacy_ai_provider_settings_are_ignored_silently() {
        // Settings persisted before the platform migration carry an `ai` key;
        // it must deserialize without error and without effect.
        let settings = serde_json::from_value::<AppSettings>(json!({
            "ai": {
                "selectedProvider": "anthropic",
                "providers": {
                    "anthropic": { "keyPresent": true, "lastValidationAt": "123" }
                }
            }
        }))
        .unwrap()
        .normalized();

        assert_eq!(settings.platform.server_url, "https://api.bioeng.build");
        assert!(settings.platform.account_id.is_none());
    }

    #[test]
    fn platform_settings_normalize_server_url_and_blank_ids() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "platform": {
                "serverUrl": " https://api.bioeng.dev/ ",
                "accountId": "  ",
                "workspaceId": "wspc_1",
                "deviceId": ""
            }
        }))
        .unwrap()
        .normalized();

        assert_eq!(settings.platform.server_url, "https://api.bioeng.dev");
        assert!(settings.platform.account_id.is_none());
        assert_eq!(settings.platform.workspace_id.as_deref(), Some("wspc_1"));
        assert!(settings.platform.device_id.is_none());

        let blank = serde_json::from_value::<AppSettings>(json!({
            "platform": { "serverUrl": "   " }
        }))
        .unwrap()
        .normalized();
        assert_eq!(blank.platform.server_url, "https://api.bioeng.build");
    }

    #[test]
    fn backup_settings_serialization_omits_secret_material() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "backup": {
                "localFolder": "/tmp/bioeng-backups",
                "deviceId": "dev_test",
                "masterKey": "secret",
                "recoveryKey": "CGBK1-secret"
            }
        }))
        .unwrap()
        .normalized();
        let serialized = serde_json::to_string(&settings).unwrap();

        assert!(serialized.contains("localFolder"));
        // Exact key match: masterKeyCreatedAt legitimately serializes.
        assert!(!serialized.contains("\"masterKey\""));
        assert!(!serialized.contains("\"secret\""));
        assert!(!serialized.contains("CGBK1-secret"));
    }
}
