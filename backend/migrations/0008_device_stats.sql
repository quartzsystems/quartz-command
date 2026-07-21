-- Device health & stats pushed by the device's qfagent over the control stream
-- (see DeviceMessage.device_stats). Two tables back the device Monitor overview:
--
--  * device_stats         — the latest snapshot per device (one row, upserted):
--                           utilization gauges, uptime, public IP, and the
--                           top-policies list (stored as JSON).
--  * device_stats_samples — a short rolling history of the utilization gauges
--                           per device, driving the console's CPU/memory/disk
--                           sparklines. Pruned to a fixed window on each insert.
--
-- Utilization gauges are instantaneous 0–100 percentages. top_policies counters
-- are cumulative within the ruleset's current run (Prometheus-counter semantics).

CREATE TABLE device_stats (
    device_id     text PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
    -- Device wall-clock of the snapshot (epoch seconds) and the nominal cadence.
    time_unix     bigint  NOT NULL,
    interval_secs integer NOT NULL DEFAULT 0,

    -- Instantaneous resource utilization, 0–100 percent.
    cpu_pct  double precision NOT NULL DEFAULT 0,
    mem_pct  double precision NOT NULL DEFAULT 0,
    disk_pct double precision NOT NULL DEFAULT 0,

    -- Seconds since device boot; public/WAN IP as the device sees itself.
    uptime_secs bigint NOT NULL DEFAULT 0,
    public_ip   text   NOT NULL DEFAULT '',

    -- Top firewall policies by traffic: a JSON array of
    -- {name, bytes, hits}, already sorted desc and capped by the agent.
    top_policies jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- When the controller received this snapshot.
    received_at timestamptz NOT NULL DEFAULT now()
);

-- Rolling utilization history for the sparklines. Bounded per device by pruning
-- on insert (see gateway::device::store_device_stats); received_at anchors both
-- ordering and pruning so a skewed device clock can't retain stale rows.
CREATE TABLE device_stats_samples (
    device_id   text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    received_at timestamptz NOT NULL DEFAULT now(),
    cpu_pct     double precision NOT NULL DEFAULT 0,
    mem_pct     double precision NOT NULL DEFAULT 0,
    disk_pct    double precision NOT NULL DEFAULT 0
);

-- Read pattern is "recent samples for one device, newest first".
CREATE INDEX device_stats_samples_device_time
    ON device_stats_samples (device_id, received_at DESC);
