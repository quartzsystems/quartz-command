# QuartzSONiC agent contract — Static Routes, Routing Policy, System, Security

Hand this document to Claude Code in the **quartz-sonic** repo. Quartz Command's
cloud console now ships configure pages for the features below; every call
travels through the per-device proxy and lands on the agent's local management
API (`src/mgmtapi.rs`), which must implement these endpoints. The agent is the
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

## 1. Static routes (`frontend/lib/device/sonic-static-routes.ts`)

Backed by the `STATIC_ROUTE` CONFIG_DB table (key `vrf|prefix`, or bare
`prefix` for the default VRF; parallel comma-separated `nexthop`, `ifname`,
`nexthop-vrf`, `distance`, `blackhole` fields) rendered by bgpcfgd into FRR
staticd.

### GET `/api/routing/static-routes`

```json
{
  "capability": { ... },
  "routes": [
    {
      "vrf": "Vrf_blue" | null,          // null = default VRF
      "prefix": "10.20.0.0/16",           // IPv4 or IPv6 CIDR
      "next_hops": [
        {
          "gateway": "10.0.0.1" | null,
          "interface": "Ethernet0" | null,
          "nexthop_vrf": "default" | "VrfX" | null,  // route leaking; null = route's own VRF
          "blackhole": false,
          "distance": 1-255 | null        // null = FRR default (1)
        }
      ]
    }
  ]
}
```

### PUT `/api/routing/static-routes`

Body = one route object (same shape as above). **Upsert**: replace the whole
`STATIC_ROUTE` row for (vrf, prefix). The prefix travels in the body because
it contains `/`.

### POST `/api/routing/static-routes/delete`

Body `{ "vrf": string|null, "prefix": string }` — delete the row. POST-with-
body for the same slash-in-prefix reason.

Validation: at least one next hop; each hop is gateway and/or interface, or
blackhole. Multiple hops = ECMP (comma-joined fields in the row).

---

## 2. Routing policy (`frontend/lib/device/sonic-routing-policy.ts`)

Prefix lists + route maps. Community SONiC has no CONFIG_DB schema for these,
so program FRR directly in the bgp container (vtysh / frr.conf), same as the
existing OSPF/IS-IS panels. Report `supported: false` when the bgp container
isn't running.

### GET `/api/routing/policy`

```json
{
  "capability": { ... },
  "prefix_lists": [
    {
      "name": "LAN-PREFIXES",
      "family": "ipv4" | "ipv6",
      "rules": [
        { "seq": 5, "action": "permit"|"deny", "prefix": "10.0.0.0/8",
          "ge": int|null, "le": int|null }
      ]
    }
  ],
  "route_maps": [
    {
      "name": "RM-UPSTREAM-IN",
      "entries": [
        {
          "seq": 10, "action": "permit"|"deny", "description": string|null,
          "match": {
            "ip_prefix_list": string|null, "ipv6_prefix_list": string|null,
            "community": string|null, "metric": int|null, "tag": int|null
          },
          "set": {
            "local_preference": int|null, "metric": int|null,
            "community": string|null,          // space-separated values
            "as_path_prepend": string|null,    // space-separated ASNs
            "ip_next_hop": string|null,
            "origin": "igp"|"egp"|"incomplete"|null,
            "tag": int|null
          }
        }
      ]
    }
  ]
}
```

### PUT `/api/routing/policy/prefix-lists/{name}` — body = whole prefix list; atomically replace the FRR object (delete + re-add inside one vtysh transaction).
### DELETE `/api/routing/policy/prefix-lists/{name}` — reject with a clear error while a route map references it.
### PUT `/api/routing/policy/route-maps/{name}` — body = whole route map, entries replace the live set.
### DELETE `/api/routing/policy/route-maps/{name}` — reject while BGP/OSPF references it.

---

## 3. System (`frontend/lib/device/sonic-system.ts`)

### GET/PUT `/api/system/general`

GET:

```json
{
  "capability": { ... },
  "hostname": "sonic",             // DEVICE_METADATA localhost hostname
  "timezone": "Etc/UTC",           // DEVICE_METADATA timezone / timedatectl
  "timezones": ["..."],            // IANA names for the picker; [] = free-form input
  "ntp_servers": ["pool.ntp.org"], // NTP_SERVER table keys
  "syslog_servers": [ { "address": "10.0.0.50", "port": 514|null } ]  // SYSLOG_SERVER
}
```

PUT body: `{ hostname, timezone, ntp_servers, syslog_servers }` — full desired
state; diff each list.

### GET/PUT `/api/system/management`

GET:

```json
{
  "capability": { ... },
  "interface_name": "eth0",
  "dhcp": true,                    // true when no MGMT_INTERFACE row exists
  "ip_address": "10.0.10.5/24" | null,
  "gateway": "10.0.10.1" | null,
  "mgmt_vrf_enabled": bool,        // MGMT_VRF_CONFIG (display only here)
  "mac_address": "aa:bb:..." | null,
  "oper_status": "up"|"down"|"unknown"
}
```

PUT body: `{ dhcp, ip_address, gateway }`. dhcp=true ⇒ remove the
MGMT_INTERFACE row. **Apply carefully**: this can drop the cloud tunnel;
apply after responding, or respond first and reconnect.

### `/api/system/users`

GET: `{ capability, users: [ { "name", "role": "admin"|"operator", "builtin": bool } ] }`
— map sudo/admin group membership to `admin`, others `operator`; mark the
image's stock account(s) `builtin`.

- POST `/api/system/users` body `{ name, role, password }`
- PUT `/api/system/users/{name}` body `{ role, password: string|null }` (null = unchanged)
- DELETE `/api/system/users/{name}` — reject deleting builtin accounts and the
  last admin.

### GET/PUT `/api/system/snmp`

GET:

```json
{
  "capability": { ... },
  "enabled": bool,                 // FEATURE snmp state
  "location": string|null,         // SNMP|LOCATION
  "contact": string|null,          // SNMP|CONTACT
  "communities": [ { "name": "public", "access": "ro"|"rw" } ]  // SNMP_COMMUNITY
}
```

PUT body: same minus capability; `communities` is the full desired set.

### `/api/system/maintenance`

GET:

```json
{
  "capability": { ... },
  "current_image": "SONiC-OS-...",     // sonic-installer list
  "next_image": "SONiC-OS-...",
  "available_images": ["..."],
  "last_config_save": "2026-07-22T14:00:00Z" | null,  // mtime of /etc/sonic/config_db.json
  "uptime_seconds": int|null
}
```

- POST `/api/system/maintenance/save-config` — `config save -y`
- POST `/api/system/maintenance/set-next-image` body `{ image }` — `sonic-installer set-next-boot`
- POST `/api/system/maintenance/install-image` body `{ url }` — `sonic-installer install -y <url>`; long-running, stream/await before responding
- POST `/api/system/maintenance/reboot` — respond 200 first, then reboot
- GET `/api/system/maintenance/backup` — raw `/etc/sonic/config_db.json` (Content-Type application/json; it's downloaded as a file client-side)
- POST `/api/system/maintenance/restore` body `{ "config": <config_db object> }` — write config_db.json + `config reload -y`; validate it's a plausible CONFIG_DB dump first

---

## 4. Security — ACLs (`frontend/lib/device/sonic-acl.ts`)

Backed by `ACL_TABLE` / `ACL_RULE`. Rule rows are named `RULE_<priority>` and
`priority` is the rule's identity in this API.

### GET `/api/security/acls`

```json
{
  "capability": { ... },
  "tables": [
    {
      "name": "SERVER-PROTECT",
      "type": "L3" | "L3V6" | "MAC",
      "stage": "ingress" | "egress",
      "description": string|null,           // policy_desc
      "ports": ["Ethernet0","PortChannel0001","Vlan10"],
      "rules": [                            // sorted by priority descending
        {
          "priority": 100,
          "action": "forward" | "drop",     // PACKET_ACTION
          "description": string|null,
          "src": "10.0.0.0/24" | "00:11:22:33:44:55" | null,  // null = any
          "dst": ...same...,
          "protocol": "tcp"|"udp"|"icmp"|"<number>"|null,     // L3/L3V6 only
          "src_port": "22" | "1024-65535" | null,             // tcp/udp only
          "dst_port": ...same...
        }
      ]
    }
  ]
}
```

- POST `/api/security/acls` body `{ name, type, stage, description, ports }`
- PUT `/api/security/acls/{name}` body `{ type, stage, description, ports }` —
  reject changing `type` (immutable in SONiC)
- DELETE `/api/security/acls/{name}` — remove the table and all its rules
- PUT `/api/security/acls/{name}/rules/{priority}` body = rule object — upsert
  (map to SRC_IP/DST_IP or SRC_IPV6/DST_IPV6 or SRC_MAC/DST_MAC by table type;
  L4_SRC_PORT vs L4_SRC_PORT_RANGE by whether the value contains `-`)
- DELETE `/api/security/acls/{name}/rules/{priority}`

---

## 5. Security — AAA (`frontend/lib/device/sonic-aaa.ts`)

Backed by `AAA`, `TACPLUS` / `TACPLUS_SERVER`, `RADIUS` / `RADIUS_SERVER`
(hostcfgd rewrites PAM/NSS). **Secrets are write-only**: never return `passkey`
values, only `*_key_set` booleans.

### GET `/api/security/aaa`

```json
{
  "capability": { ... },
  "login_order": ["tacacs+","local"],   // AAA|authentication login
  "failthrough": bool,
  "tacacs": {
    "auth_type": "pap"|"chap"|"mschapv2"|"login",
    "timeout": int|null,
    "global_key_set": bool,
    "servers": [
      { "address": "10.0.0.20", "priority": int|null, "port": int|null,
        "timeout": int|null, "key_set": bool }
    ]
  },
  "radius": { ...same shape... }
}
```

- PUT `/api/security/aaa/authentication` body `{ login_order, failthrough }` —
  **reject an order that omits `"local"`** (lockout guard; the UI enforces it
  too, but the agent is the backstop)
- PUT `/api/security/aaa/tacacs` and `/api/security/aaa/radius` body
  `{ auth_type, timeout, key }` — `key`: null = unchanged, `""` = clear
- POST `/api/security/aaa/{tacacs|radius}/servers` body
  `{ address, priority, port, timeout, key }`
- PUT `/api/security/aaa/{tacacs|radius}/servers/{address}` — same body minus address
- DELETE `/api/security/aaa/{tacacs|radius}/servers/{address}`

---

## Capability guidance per feature

| Feature        | supported when                                          |
|----------------|---------------------------------------------------------|
| static-routes  | bgp container (staticd) running — effectively always    |
| routing policy | bgp container running (FRR reachable via vtysh)         |
| system general | always                                                  |
| management     | always (read_only if the platform has no eth0)          |
| users          | always                                                  |
| snmp           | snmp FEATURE present (read_only if docker missing)      |
| maintenance    | always (install-image requires sonic-installer)         |
| acls           | always (ACL orchagent is core SONiC)                    |
| aaa            | always (hostcfgd handles TACPLUS/RADIUS tables)         |
