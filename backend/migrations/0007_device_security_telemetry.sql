-- Latest security-service telemetry snapshot per device, pushed by the device's
-- qfagent over the control stream (see DeviceMessage.security_telemetry). One
-- row per device, upserted on each report. Counters are cumulative within a
-- service's current run (Prometheus-counter semantics: they reset on service
-- restart / ruleset reload / log rotation); anchor deltas on time_unix. A
-- disabled or uninstalled service reports enabled=false with zero counters.
CREATE TABLE device_security_telemetry (
    device_id     text PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
    -- Device wall-clock of the snapshot (epoch seconds) and the nominal cadence.
    time_unix     bigint  NOT NULL,
    interval_secs integer NOT NULL DEFAULT 0,

    -- Intrusion Prevention (Suricata).
    ips_enabled         boolean NOT NULL DEFAULT false,
    ips_prevented       bigint  NOT NULL DEFAULT 0,
    ips_detected        bigint  NOT NULL DEFAULT 0,
    ips_scans           bigint  NOT NULL DEFAULT 0,
    ips_scans_available boolean NOT NULL DEFAULT false,

    -- Application Control (qfappd / nDPI).
    ac_enabled        boolean NOT NULL DEFAULT false,
    ac_blocked        bigint  NOT NULL DEFAULT 0,
    ac_detected       bigint  NOT NULL DEFAULT 0,
    ac_total_requests bigint  NOT NULL DEFAULT 0,

    -- Geolocation blocking (nftables qz_geo).
    geo_enabled           boolean NOT NULL DEFAULT false,
    geo_blocked           bigint  NOT NULL DEFAULT 0,
    geo_connections       bigint  NOT NULL DEFAULT 0,
    geo_countries_blocked integer NOT NULL DEFAULT 0,

    -- Content Filtering (e2guardian).
    cf_enabled        boolean NOT NULL DEFAULT false,
    cf_blocked        bigint  NOT NULL DEFAULT 0,
    cf_allowed        bigint  NOT NULL DEFAULT 0,
    cf_total_requests bigint  NOT NULL DEFAULT 0,

    -- When the controller received this snapshot.
    received_at timestamptz NOT NULL DEFAULT now()
);
