use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

/// Application error type mapped onto HTTP responses. The frontend relies on
/// `{ "error": "…" }` bodies. (Model ported from QuartzFire's `error.rs`.)
#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[allow(dead_code)] // reserved for handlers that 404 (e.g. future resource lookups)
    #[error("{0}")]
    NotFound(String),
    /// Deliberately vague — the same message for "no such user" and "wrong
    /// password" so login responses don't leak which emails exist.
    #[error("invalid credentials")]
    Unauthorized,
    /// Authenticated but not permitted (e.g. not a member of the organization).
    #[error("forbidden")]
    Forbidden,
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status.is_server_error() {
            tracing::error!("{self:#}");
        }
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}

/// Database errors are always internal; keep the mapping in one place so query
/// handlers can use `?` directly.
impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(anyhow::anyhow!(e))
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
