use anyhow::Result;
use axum::{
    middleware,
    routing::{delete, get, post},
    Router,
};
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::trace::TraceLayer;

use quartz_command::{
    admin, console,
    config::Config,
    db, gateway,
    pki::ca::{self as device_ca, DeviceCa},
    security, seed, AppState,
};

#[tokio::main]
async fn main() -> Result<()> {
    // Load backend/.env if present (no error if it isn't), so `cargo run` picks
    // up DATABASE_URL etc. without any shell export step.
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "quartz_command=info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env()?;
    let pool = db::init(&config.database_url).await?;

    // A CLI subcommand? Run it against the migrated database and exit.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(cmd) = args.first() {
        return run_subcommand(&pool, cmd, &args[1..]).await;
    }

    // Bring up a usable /admin/login on a fresh database (no-op once an admin
    // exists, or when the default-admin env vars are unset).
    seed::bootstrap_default_admin(
        &pool,
        config.default_admin_email.as_deref(),
        config.default_admin_password.as_deref(),
    )
    .await?;

    let jwt_secret = security::load_or_create_secret(&config.jwt_secret_file);
    let admin_jwt_secret = security::load_or_create_secret(&config.admin_jwt_secret_file);
    let listen = config.listen.clone();

    // Device PKI: load (or mint) the internal CA and note the fingerprint
    // that goes into enrollment tokens.
    let device_ca = Arc::new(DeviceCa::load_or_create(&config.device_ca_dir)?);
    let gateway_ca_fingerprint_hex =
        device_ca::gateway_ca_fingerprint_hex(config.gateway_ca_file.as_deref(), &device_ca)?;

    let state = Arc::new(AppState {
        gateway_addr: config.gateway_addr.clone(),
        gateway_ca_fingerprint_hex,
        device_ca: device_ca.clone(),
        db: pool.clone(),
        jwt_secret,
        admin_jwt_secret,
        config,
    });

    // Device gateway (gRPC): enrollment bootstrap + mTLS device services.
    let grpc_state = Arc::new(gateway::GrpcState::new(
        pool.clone(),
        device_ca,
        state.config.gateway_addr.clone(),
    ));
    {
        let grpc_config = state.config.clone();
        tokio::spawn(async move {
            if let Err(e) = gateway::serve(grpc_state, &grpc_config).await {
                tracing::error!("device gateway failed: {e:#}");
            }
        });
    }

    // Protected user routes: require a valid `qc_session`.
    let user_protected = Router::new()
        .route("/api/auth/me", get(console::auth::me))
        .route("/api/orgs", get(console::organizations::list))
        .route("/api/orgs/:organization_guid", get(console::organizations::get_one))
        .route(
            "/api/orgs/:organization_guid/subs",
            get(console::organizations::list_subs).post(console::organizations::create_sub),
        )
        .route(
            "/api/orgs/:organization_guid/subs/:sub_guid",
            get(console::organizations::get_sub),
        )
        .route(
            "/api/orgs/:organization_guid/enroll-tokens",
            get(console::enroll_tokens::list).post(console::enroll_tokens::create),
        )
        .route(
            "/api/orgs/:organization_guid/enroll-tokens/:token_id/revoke",
            post(console::enroll_tokens::revoke),
        )
        .route("/api/orgs/:organization_guid/devices", get(console::devices::list))
        .route(
            "/api/orgs/:organization_guid/devices/:device_id/revoke",
            post(console::devices::revoke),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            console::auth::require_auth,
        ));

    // Protected admin routes: require a valid `qc_admin_session`.
    let admin_protected = Router::new()
        .route("/api/admin/auth/me", get(admin::auth::me))
        .route("/api/admin/overview", get(admin::orgs::overview))
        .route(
            "/api/admin/admins",
            get(admin::accounts::list).post(admin::accounts::create),
        )
        .route(
            "/api/admin/admins/:admin_id",
            delete(admin::accounts::delete).patch(admin::accounts::update),
        )
        .route("/api/admin/orgs", get(admin::orgs::list).post(admin::orgs::create))
        .route(
            "/api/admin/orgs/:organization_guid",
            get(admin::orgs::get_one)
                .patch(admin::orgs::update)
                .delete(admin::orgs::delete),
        )
        .route(
            "/api/admin/orgs/:organization_guid/members",
            post(admin::orgs::add_member),
        )
        .route(
            "/api/admin/orgs/:organization_guid/members/:user_id",
            delete(admin::orgs::remove_member).patch(admin::orgs::update_member),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            admin::auth::require_admin,
        ));

    // Public routes (login/logout for both realms) + health.
    let public = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/auth/login", post(console::auth::login))
        .route("/api/auth/logout", post(console::auth::logout))
        .route("/api/admin/auth/login", post(admin::auth::login))
        .route("/api/admin/auth/logout", post(admin::auth::logout));

    let app = Router::new()
        .merge(public)
        .merge(user_protected)
        .merge(admin_protected)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!("quartz-command backend listening on {listen}");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Dispatch the developer seeding subcommands (see `seed.rs`).
async fn run_subcommand(pool: &PgPool, cmd: &str, rest: &[String]) -> Result<()> {
    match cmd {
        "seed-user" => {
            let email = rest.first().ok_or_else(|| usage("seed-user <email> [full_name]"))?;
            seed::seed_user(pool, email, rest.get(1).map(String::as_str)).await
        }
        "seed-admin" => {
            let email = rest.first().ok_or_else(|| usage("seed-admin <email> [full_name]"))?;
            seed::seed_admin(pool, email, rest.get(1).map(String::as_str)).await
        }
        "seed-org" => {
            let name = rest.first().ok_or_else(|| usage("seed-org <name> <slug>"))?;
            let slug = rest.get(1).ok_or_else(|| usage("seed-org <name> <slug>"))?;
            seed::seed_org(pool, name, slug).await
        }
        "add-member" => {
            let user = rest.first().ok_or_else(|| usage("add-member <user_email> <org_slug> [role]"))?;
            let org = rest.get(1).ok_or_else(|| usage("add-member <user_email> <org_slug> [role]"))?;
            let role = rest.get(2).map(String::as_str).unwrap_or("member");
            seed::add_member(pool, user, org, role).await
        }
        other => Err(usage(&format!("unknown subcommand: {other}"))),
    }
}

fn usage(msg: &str) -> anyhow::Error {
    anyhow::anyhow!(
        "usage: quartz-command [seed-user|seed-admin|seed-org|add-member] …\n  {msg}"
    )
}
