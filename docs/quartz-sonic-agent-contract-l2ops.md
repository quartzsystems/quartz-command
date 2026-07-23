# QuartzSONiC agent contract — Port Mirroring, Storm Control, MAC Table, DHCP Relay, sFlow

Hand this document to Claude Code in the **quartz-sonic** repo. Quartz Command's
cloud console now ships pages for the L2-ops features below; every call travels
through the per-device proxy and lands on the agent's local management API
(`src/mgmtapi.rs`), which must implement these endpoints. The agent is the
source of truth for the contract — the frontend data layers to keep in step
with are listed per feature.

## Conventions (same as the existing switching/routing endpoints)

- All responses are JSON. Errors: non-2xx with body `{ "error": "<message>" }`
  — the message is shown verbatim to the user, so make it human-readable.
- Every feature GET returns a **capability envelope**:

  ```json
  { "capability": { "supported": bool, "read_only": bool, "reason": string|null }, ... }
  ```

  Probe the image (FEATURE table, running dockers, DEVICE_METADATA) and report
  `supported: false` with a reason instead of accepting writes that would sit
  inert in CONFIG_DB. `read_only: true` means state can be shown but not edited.
- Writes that take lists receive the **full desired set**; the agent diffs
  against CONFIG_DB and applies the delta.
- After a successful write, the response body is empty (200/204) — the UI
  refetches the document.

---

## 1. Port mirroring (`frontend/lib/device/sonic-mirror.ts`)

Backed by the CONFIG_DB `MIRROR_SESSION` table. SPAN sessions (`type=span`,
`dst_port`, `src_port` comma-list, `direction`) need a 202012+ image; ERSPAN
sessions (`src_ip`, `dst_ip`, `gre_type`, `dscp`, `ttl`, `queue`) are older.
Operational status comes from STATE_DB `MIRROR_SESSION_TABLE`.

### GET `/api/switching/mirror-sessions`

```json
{
  "capability": { ... },
  "sessions": [
    {
      "name": "capture-uplink",
      "type": "span" | "erspan",
      "source_ports": ["Ethernet0", "PortChannel0001"],
      "direction": "rx" | "tx" | "both",
      "dst_port": "Ethernet47" | null,     // SPAN only
      "erspan": {                           // ERSPAN only, else null
        "src_ip": "10.0.0.1",
        "dst_ip": "10.9.0.50",
        "gre_type": "0x88be" | null,
        "dscp": 0-63 | null,
        "ttl": 1-255 | null,
        "queue": int | null
      },
      "status": "active" | "inactive" | null   // STATE_DB; null = no state entry
    }
  ]
}
```

### PUT `/api/switching/mirror-sessions/{name}`

Body = one session object minus `name`/`status` (same shape as above) —
**upsert**: replace the whole MIRROR_SESSION row. Validate: at least one
source port; SPAN needs `dst_port` (a physical port, not also a source);
ERSPAN needs `src_ip` + `dst_ip`. Reject a SPAN session on an image that
doesn't support SPAN with a clear error.

### DELETE `/api/switching/mirror-sessions/{name}`

Reject with a clear error while an ACL rule references the session
(`MIRROR_ACTION`), if the image supports flow-based mirroring.

---

## 2. Storm control (`frontend/lib/device/sonic-storm-control.ts`)

Backed by CONFIG_DB `PORT_STORM_CONTROL` (key
`port|{broadcast,unknown-unicast,unknown-multicast}`, field `kbps`).
Capability: probe whether the image's orchagent handles the table (community
builds since 202205 include it; report unsupported otherwise).

### GET `/api/switching/storm-control`

```json
{
  "capability": { ... },
  "ports": [
    {
      "port": "Ethernet0",
      "alias": "Eth1/1" | null,
      "broadcast_kbps": int | null,          // null = no limit configured
      "unknown_unicast_kbps": int | null,
      "unknown_multicast_kbps": int | null
    }
  ]
}
```

One row per front-panel port (every PORT table entry), whether or not limits
exist.

### PUT `/api/switching/storm-control/{port}`

Body `{ "broadcast_kbps": int|null, "unknown_unicast_kbps": int|null,
"unknown_multicast_kbps": int|null }` — full desired limits for the port;
null removes that traffic class's row.

---

## 3. MAC table / FDB (`frontend/lib/device/sonic-fdb.ts`)

Config side: aging time (CONFIG_DB `SWITCH|switch` `fdb_aging_time`) and
static entries (CONFIG_DB `FDB` table, key `Vlan{id}:{mac}`, fields `port`,
`type=static` — accept whatever the image's schema is and normalize). Read
side: the learned table as `show mac` reports it (ASIC_DB/STATE_DB via the
same path fdbshow uses).

MACs travel colon-separated lowercase (`00:11:22:33:44:55`) in both
directions.

### GET `/api/switching/fdb`

```json
{
  "capability": { ... },
  "aging_time_seconds": int | null,     // null = default in effect
  "aging_time_default": int | null,     // the image default, for the UI placeholder
  "static_entries": [
    { "vlan_id": 10, "mac": "00:11:22:33:44:55", "port": "Ethernet4" }
  ]
}
```

If the image has no writable aging knob, report `read_only` (or omit support)
with a reason rather than silently dropping writes.

### PUT `/api/switching/fdb/settings`

Body `{ "aging_time_seconds": int|null }` — null restores the image default;
0 disables aging.

### PUT `/api/switching/fdb/static/{vlan_id}/{mac}`

Body `{ "port": "Ethernet4" }` — upsert (vlan+mac is the identity; the UI
never changes them on edit, only the port). Validate the VLAN exists and the
port is a member of it.

### DELETE `/api/switching/fdb/static/{vlan_id}/{mac}`

### GET `/api/switching/fdb/table`

```json
{
  "capability": { ... },
  "entries": [
    { "vlan_id": 10, "mac": "...", "port": "Ethernet4", "origin": "dynamic" | "static" }
  ]
}
```

This can be large (tens of thousands of entries on a busy switch) — stream
or cap sanely, but don't silently truncate: if capped, say so in an error or
document the cap.

---

## 4. DHCP relay (`frontend/lib/device/sonic-dhcp-relay.ts`)

The relay-centric view of the per-VLAN `dhcp_servers` list (CONFIG_DB VLAN
table) consumed by the dhcp_relay container — the **same field** the existing
VLAN write endpoint (`dhcp_helpers`) edits; keep the two paths writing
identically. Capability: supported when the dhcp_relay FEATURE/docker exists.

### GET `/api/routing/dhcp-relay`

```json
{
  "capability": { ... },
  "vlans": [
    {
      "vlan_id": 10,
      "description": "servers" | null,
      "ip_addresses": ["10.0.10.1/24"],     // VLAN_INTERFACE SVI addresses
      "servers": ["10.0.0.10", "10.0.0.11"] // the VLAN's dhcp_servers list
    }
  ]
}
```

Every configured VLAN is listed, whether or not it relays (the UI shows the
whole switch's relay posture).

### PUT `/api/routing/dhcp-relay/{vlan_id}`

Body `{ "servers": ["10.0.0.10", ...] }` — full desired set; diff against
the VLAN's dhcp_servers. Empty list = relay off for the VLAN. Restart/notify
the dhcp_relay service the same way the VLAN endpoint does.

---

## 5. sFlow (`frontend/lib/device/sonic-sflow.ts`)

Backed by CONFIG_DB `SFLOW` (global `admin_state`, `polling_interval`,
`agent_id`), `SFLOW_COLLECTOR` (at most two rows: `collector_ip`,
`collector_port`, `collector_vrf`), and `SFLOW_SESSION` (per-port
`admin_state`, `sample_rate`), consumed by hsflowd in the sflow container.
Capability: supported when the sflow FEATURE is present (read_only if the
docker is missing).

### GET `/api/switching/sflow`

```json
{
  "capability": { ... },
  "enabled": bool,
  "polling_interval": int | null,     // seconds, 0 disables; null = default (20)
  "agent_id": "Loopback0" | null,     // null = auto
  "collectors": [
    { "name": "collector0", "address": "10.0.0.50", "port": 6343 | null,
      "vrf": "default" | "mgmt" | null }
  ],
  "ports": [
    {
      "name": "Ethernet0",
      "alias": "Eth1/1" | null,
      "oper_status": "up" | "down" | "unknown",
      "enabled": bool,                 // SFLOW_SESSION admin_state (default: follows global "all")
      "sample_rate": int | null        // null = the speed-based image default
    }
  ]
}
```

One `ports` row per front-panel port.

### PUT `/api/switching/sflow`

Body `{ "enabled", "polling_interval", "agent_id", "collectors" }` —
`collectors` is the full desired set (diff against SFLOW_COLLECTOR; enforce
the two-collector maximum with a clear error).

### PUT `/api/switching/sflow/ports/{name}`

Body `{ "enabled": bool, "sample_rate": int|null }` — write the port's
SFLOW_SESSION row (null sample_rate = remove the override). Valid sample
rates: 256–8388608.

---

## Capability guidance per feature

| Feature        | supported when                                                    |
|----------------|-------------------------------------------------------------------|
| port mirroring | MIRROR_SESSION handled by orchagent (core); SPAN type needs 202012+ — reject span writes with a clear error on older images |
| storm control  | PORT_STORM_CONTROL orchagent support (community 202205+)          |
| fdb config     | always (aging read_only if the image lacks the SWITCH knob)       |
| fdb table      | always                                                            |
| dhcp relay     | dhcp_relay FEATURE/docker present                                 |
| sflow          | sflow FEATURE present (read_only if docker missing)               |
