# QuartzSONiC agent contract — MCLAG, VRRP, BFD, VXLAN/EVPN, QoS

Hand this document to Claude Code in the **quartz-sonic** repo. Quartz Command's
cloud console now ships pages for the features below; every call travels
through the per-device proxy and lands on the agent's local management API
(`src/mgmtapi.rs`), which must implement these endpoints. The agent is the
source of truth for the contract — the frontend data layers to keep in step
with are listed per feature.

MCLAG and VRRP are **pair features**: the console configures them from the
sub-organization's High Availability section, writing the mirrored config to
both switches of a pair (two independent PUTs — one per switch). The agent
only ever sees its own switch's half; it needs no notion of the pair.

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

## 1. MCLAG (`frontend/lib/device/sonic-mclag.ts`)

Backed by CONFIG_DB `MCLAG_DOMAIN` (one domain per switch) and
`MCLAG_INTERFACE` (member port channels), consumed by iccpd. Live state the
way `mclagdctl` reports it (session status, role, per-interface local/remote
port state). Capability: supported when the image ships iccpd / handles
MCLAG_DOMAIN (Enterprise SONiC and community builds with the mclag feature);
report unsupported otherwise.

### GET `/api/ha/mclag`

```json
{
  "capability": { ... },
  "domain": {                          // null = MCLAG not configured
    "domain_id": 1,                     // 1–4095
    "source_ip": "10.0.0.1",            // this switch's keepalive source
    "peer_ip": "10.0.0.2",              // the paired switch's address
    "peer_link": "PortChannel0001" | null,
    "keepalive_interval_s": int | null, // null = image default (1)
    "session_timeout_s": int | null,    // null = image default (15)
    "system_mac": "00:11:22:33:44:55" | null,
    "members": ["PortChannel0002"]      // MCLAG_INTERFACE rows
  },
  "state": {                            // null when unconfigured / iccpd down
    "session_status": "up" | "down" | null,
    "role": "active" | "standby" | null,
    "peer_link_status": "up" | "down" | null,
    "members": [
      { "name": "PortChannel0002",
        "local_status": "up" | "down" | "unknown",
        "remote_status": "up" | "down" | "unknown" }
    ]
  }
}
```

### PUT `/api/ha/mclag`

Body = the whole `domain` object above — **upsert**: replace the switch's
MCLAG_DOMAIN row and diff `members` against MCLAG_INTERFACE. Validate:
domain_id 1–4095; source_ip ≠ peer_ip; peer_link (when set) and every member
is an existing PortChannel; a member can't equal the peer link. The console
writes the mirrored object to the other switch itself.

### DELETE `/api/ha/mclag`

Remove the domain and all its MCLAG_INTERFACE rows.

---

## 2. VRRP (`frontend/lib/device/sonic-vrrp.ts`)

Backed by the `VRRP` CONFIG_DB table on images that ship vrrpd (Enterprise
SONiC; community builds generally lack it — report `supported: false` with a
reason like "VRRP requires an image with vrrpd, e.g. Enterprise SONiC").
Group identity is (interface, vrid). Live master/backup state from the VRRP
daemon / STATE_DB.

### GET `/api/ha/vrrp`

```json
{
  "capability": { ... },
  "groups": [
    {
      "interface": "Vlan10",            // L3 interface, normally an SVI
      "vrid": 1,                         // 1–255
      "virtual_ips": ["10.0.10.1"],      // bare IPs or CIDR, as the image stores them
      "priority": 200,                   // 1–254
      "preempt": true,
      "adv_interval_ms": 1000 | null,    // null = protocol default (1000)
      "version": 2 | 3 | null,           // null = image default
      "state": "master" | "backup" | "init" | null
    }
  ]
}
```

### PUT `/api/ha/vrrp/{interface}/{vrid}`

Body = one group object minus `state` — **upsert** for the (interface, vrid)
identity. Validate the interface exists and has an address; virtual IPs must
not collide with either switch's own interface addresses (reject with a clear
error). Round `adv_interval_ms` to whatever granularity the image supports
(centiseconds on some builds) rather than rejecting.

### DELETE `/api/ha/vrrp/{interface}/{vrid}`

---

## 3. BFD (`frontend/lib/device/sonic-bfd.ts`)

Community SONiC has no CONFIG_DB schema for BFD, so program FRR's bfdd
directly (vtysh / frr.conf), same as the routing-policy panels. Capability:
supported when the bgp container is running and bfdd is present. Peer
identity is (peer, interface, vrf, multihop).

### GET `/api/routing/bfd`

```json
{
  "capability": { ... },
  "peers": [
    {
      "peer": "10.0.0.1",                // IPv4 or IPv6
      "interface": "Ethernet0" | null,   // single-hop binding; null for multihop
      "local_address": "10.0.0.2" | null,// required for multihop
      "multihop": false,
      "vrf": "VrfX" | null,              // null = default VRF
      "rx_interval_ms": int | null,      // null = FRR default (300)
      "tx_interval_ms": int | null,
      "multiplier": int | null,          // null = FRR default (3)
      "passive": false,
      "shutdown": false
    }
  ]
}
```

### PUT `/api/routing/bfd/peers`

Body = one peer object — **upsert**: replace the FRR `peer` block for its
identity atomically (delete + re-add in one vtysh transaction).

### POST `/api/routing/bfd/peers/delete`

Body `{ "peer", "interface": string|null, "vrf": string|null, "multihop": bool }`
— POST-with-body because peer addresses aren't path-safe (same pattern as
static routes).

### GET `/api/routing/bfd/sessions`

Every live bfdd session — **including** sessions raised dynamically by
BGP/OSPF (`neighbor … bfd`), not just the configured peers (what
`show bfd peers json` reports):

```json
{
  "capability": { ... },
  "sessions": [
    {
      "peer": "10.0.0.1",
      "local_address": "10.0.0.2" | null,
      "interface": "Ethernet0" | null,
      "vrf": "VrfX" | null,
      "multihop": false,
      "state": "up" | "down" | "init" | "admin_down",
      "remote_state": ...same... | null,
      "uptime_seconds": int | null,
      "rx_interval_ms": int | null,      // negotiated, not configured
      "tx_interval_ms": int | null,
      "multiplier": int | null,
      "diagnostic": "control detection time expired" | null,
      "clients": ["bgp"]                 // [] for static peers
    }
  ]
}
```

---

## 4. VXLAN / EVPN (`frontend/lib/device/sonic-vxlan.ts`)

Backed by CONFIG_DB `VXLAN_TUNNEL` (the single VTEP), `EVPN_NVO` (NVO →
VTEP binding), and `VXLAN_TUNNEL_MAP` (VLAN↔VNI, keys
`{vtep}|map_{vni}_Vlan{id}`). Status from STATE_DB / APP_DB
(`VXLAN_TUNNEL_TABLE`, EVPN remote VTEPs). Capability: supported when the
image's orchagent handles VXLAN (202012+ community); EVPN NVO additionally
needs FRR with EVPN support.

### GET `/api/routing/vxlan`

```json
{
  "capability": { ... },
  "vtep": { "name": "vtep1", "source_ip": "10.0.0.11" } | null,
  "evpn_nvo": bool,                     // an EVPN_NVO row binds the VTEP
  "vlan_vni_maps": [ { "vlan_id": 10, "vni": 10010 } ]
}
```

### PUT `/api/routing/vxlan/vtep`

Body `{ "name", "source_ip", "evpn_nvo": bool }` — upsert the VTEP and its
EVPN_NVO binding together. Changing `source_ip` on an existing VTEP is
allowed (recreate the row); changing `name` while maps exist should be
rejected with a clear error.

### DELETE `/api/routing/vxlan/vtep`

Reject with a clear error while VLAN↔VNI maps still exist.

### PUT `/api/routing/vxlan/maps`

Body `{ "maps": [ { "vlan_id", "vni" } ] }` — the **full desired set**; diff
against VXLAN_TUNNEL_MAP. Validate: VLAN exists; VNI 1–16777215; no VNI used
by two VLANs. Requires the VTEP to exist.

### GET `/api/routing/vxlan/status`

```json
{
  "capability": { ... },
  "vtep": { "name": "vtep1", "source_ip": "10.0.0.11" } | null,
  "remote_vteps": [
    { "ip": "10.0.0.12",
      "oper_status": "up" | "down" | "unknown",
      "source": "evpn" | "static" | "unknown",
      "vnis": [10010, 10020] }           // [] when the image doesn't report them
  ],
  "mappings": [
    { "vlan_id": 10, "vni": 10010, "oper_status": "up" | "down" | "unknown" }
  ]
}
```

---

## 5. QoS phase 1 (`frontend/lib/device/sonic-qos.ts`)

Trust mode + DSCP maps only. Backed by CONFIG_DB `DSCP_TO_TC_MAP` objects
and each port's `PORT_QOS_MAP` row (`dscp_to_tc_map` field). "Trust dscp"
means a map is bound in PORT_QOS_MAP; "none" means no binding. Queues,
scheduling, PFC/ECN, and dot1p trust are a later phase — don't expose them
yet. Capability: supported when qosorch handles the tables (core SONiC —
effectively always; read_only never).

### GET `/api/qos`

```json
{
  "capability": { ... },
  "dscp_tc_maps": [
    {
      "name": "AZURE",
      "entries": [ { "dscp": 46, "tc": 5 } ],   // only explicit mappings
      "bound_ports": ["Ethernet0"]              // ports whose PORT_QOS_MAP references it
    }
  ],
  "ports": [
    {
      "name": "Ethernet0",
      "alias": "Eth1/1" | null,
      "trust": "dscp" | "none",
      "dscp_to_tc_map": "AZURE" | null          // null when trust = none
    }
  ]
}
```

One `ports` row per front-panel port.

### PUT `/api/qos/dscp-maps/{name}`

Body `{ "entries": [ { "dscp": 0-63, "tc": 0-7 } ] }` — the full desired map
(replace the DSCP_TO_TC_MAP object). A DSCP appears at most once.

### DELETE `/api/qos/dscp-maps/{name}`

Reject with a clear error while any port's PORT_QOS_MAP references the map.

### PUT `/api/qos/ports/{port}`

Body `{ "trust": "dscp"|"none", "dscp_to_tc_map": string|null }` —
trust `dscp` requires an existing map name (bind it in PORT_QOS_MAP);
trust `none` removes the binding (delete the field / row if empty).

---

## Capability guidance per feature

| Feature      | supported when                                                        |
|--------------|-----------------------------------------------------------------------|
| mclag        | iccpd / MCLAG_DOMAIN orchestration present (Enterprise SONiC, community mclag builds) |
| vrrp         | vrrpd present (Enterprise SONiC; community generally unsupported)     |
| bfd          | bgp container running with bfdd (FRR reachable via vtysh)             |
| bfd sessions | same as bfd                                                           |
| vxlan        | VXLAN orchagent support (community 202012+); `evpn_nvo` writes additionally need FRR EVPN |
| vxlan status | same as vxlan                                                         |
| qos          | always (DSCP_TO_TC_MAP / PORT_QOS_MAP are core SONiC)                 |
