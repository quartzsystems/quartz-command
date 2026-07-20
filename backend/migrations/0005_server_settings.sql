-- Instance-wide settings editable from the admin console (Settings → Server).
-- One row per key; a present row overrides the env-derived default. Known
-- keys live in backend/src/settings.rs (currently: gateway_addr).
CREATE TABLE server_settings (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
