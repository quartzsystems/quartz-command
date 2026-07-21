-- Absolute memory & disk figures on the latest device-stats snapshot, so the
-- device Monitor overview can show "Used / Free / Total" like the local WebUI
-- instead of only a percentage. Bytes; 0 when the agent doesn't report them
-- (older builds), in which case the console falls back to the percentage.
-- Only the latest snapshot needs these — the sparkline history stays percentage.

ALTER TABLE device_stats
    ADD COLUMN mem_used_bytes   bigint NOT NULL DEFAULT 0,
    ADD COLUMN mem_total_bytes  bigint NOT NULL DEFAULT 0,
    ADD COLUMN disk_used_bytes  bigint NOT NULL DEFAULT 0,
    ADD COLUMN disk_total_bytes bigint NOT NULL DEFAULT 0;
