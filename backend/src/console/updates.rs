//! Firmware update check. Resolves the latest QuartzFire system-image release
//! from the configured GitHub repo (`QC_QUARTZFIRE_REPO`) so the console can
//! offer a one-click upgrade — the device then pulls the ISO itself via
//! `add system image <url>`, so nothing large transits the cloud.
//!
//! Failures (no repo configured, GitHub unreachable, rate-limited) resolve as
//! `{ available: false, error }` with a 200, so the maintenance page can show a
//! quiet hint instead of erroring the whole panel.

use std::sync::Arc;
use std::time::Duration;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{error::Result, AppState};

/// The subset of a GitHub release asset we consume.
#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
    /// "sha256:…" on newer GitHub; absent on older API responses.
    #[serde(default)]
    digest: Option<String>,
}

/// The subset of a GitHub release we consume.
#[derive(Deserialize)]
struct GhRelease {
    #[serde(default)]
    tag_name: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

/// One installable image asset returned to the console.
#[derive(Serialize)]
pub struct ImageAsset {
    name: String,
    /// arch parsed from `<version>-<arch>.iso`, when recognizable.
    arch: Option<String>,
    /// URL the device downloads from.
    url: String,
    size: u64,
    /// "sha256:…" when GitHub reports an asset digest; else null.
    digest: Option<String>,
}

/// Latest-release summary + its `.iso` assets. `available` is false when no
/// repo is configured or the lookup found no suitable release/asset.
#[derive(Serialize, Default)]
pub struct LatestImage {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes_url: Option<String>,
    prerelease: bool,
    assets: Vec<ImageAsset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

const ARCHES: [&str; 4] = ["amd64", "arm64", "i386", "armhf"];

/// Parse the arch token from a `<version>-<arch>.iso` asset name.
fn arch_of(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".iso")?;
    let arch = stem.rsplit('-').next()?;
    ARCHES.contains(&arch).then(|| arch.to_string())
}

fn unavailable(error: impl Into<String>) -> Json<LatestImage> {
    Json(LatestImage {
        available: false,
        error: Some(error.into()),
        ..Default::default()
    })
}

/// GET /api/system/latest-image — the latest QuartzFire release + its ISOs.
pub async fn latest_image(State(state): State<Arc<AppState>>) -> Result<Json<LatestImage>> {
    let Some(repo) = state.config.quartzfire_repo.as_deref() else {
        return Ok(unavailable(
            "No releases repository is configured (set QC_QUARTZFIRE_REPO).",
        ));
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("quartz-command")
        .build()
    {
        Ok(c) => c,
        Err(e) => return Ok(unavailable(format!("update check unavailable: {e}"))),
    };

    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let mut req = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = state.config.github_token.as_deref() {
        req = req.bearer_auth(token);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return Ok(unavailable(format!("could not reach GitHub: {e}"))),
    };
    if !resp.status().is_success() {
        return Ok(unavailable(format!(
            "GitHub returned {} for {repo}.",
            resp.status().as_u16()
        )));
    }
    let release: GhRelease = match resp.json().await {
        Ok(r) => r,
        Err(e) => return Ok(unavailable(format!("unexpected GitHub response: {e}"))),
    };

    let assets: Vec<ImageAsset> = release
        .assets
        .into_iter()
        .filter(|a| a.name.ends_with(".iso"))
        .map(|a| ImageAsset {
            arch: arch_of(&a.name),
            name: a.name,
            url: a.browser_download_url,
            size: a.size,
            digest: a.digest,
        })
        .collect();

    Ok(Json(LatestImage {
        available: !assets.is_empty(),
        version: release.tag_name.clone(),
        name: release.name.or(release.tag_name),
        published_at: release.published_at,
        notes_url: release.html_url,
        prerelease: release.prerelease,
        assets,
        error: release.draft.then(|| "latest release is a draft".to_string()),
    }))
}
