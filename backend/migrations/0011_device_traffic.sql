-- WAN throughput samples pushed in the device-stats snapshot (see
-- DeviceMessage.device_stats rx_bps/tx_bps). A rolling per-device history of
-- interval-averaged rates, driving the dashboard's Network Usage card. Pruned
-- to a fixed window on each insert (see gateway::device::store_device_stats);
-- received_at anchors both ordering and pruning so a skewed device clock can't
-- retain stale rows.
CREATE TABLE device_traffic_samples (
    device_id   text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    received_at timestamptz NOT NULL DEFAULT now(),
    -- Throughput averaged over the report interval, bits per second.
    rx_bps      bigint NOT NULL DEFAULT 0,
    tx_bps      bigint NOT NULL DEFAULT 0
);

-- Read pattern is "recent samples for a scope's devices, bucketed by time".
CREATE INDEX device_traffic_samples_device_time
    ON device_traffic_samples (device_id, received_at DESC);
