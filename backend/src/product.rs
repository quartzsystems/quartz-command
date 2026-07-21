//! Product lines managed by Quartz Command. The wire name (`as_str`) is what
//! the `product` columns on `devices` and `enrollment_tokens` store; the
//! device-ID prefix keys the on-device identity derivation (see
//! `pki::deviceid`).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Product {
    /// QuartzFire firewall (VyOS-based appliance).
    QuartzFire,
    /// QuartzSONiC switch agent (.deb on community/Enterprise SONiC).
    QuartzSonic,
}

impl Product {
    /// Wire/DB name, matching the CHECK constraint on the `product` columns.
    pub fn as_str(self) -> &'static str {
        match self {
            Product::QuartzFire => "quartzfire",
            Product::QuartzSonic => "quartzsonic",
        }
    }

    /// Device-ID prefix ("QF" / "QS"); the agent derives the same on-device.
    pub fn id_prefix(self) -> &'static str {
        match self {
            Product::QuartzFire => "QF",
            Product::QuartzSonic => "QS",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "quartzfire" => Some(Product::QuartzFire),
            "quartzsonic" => Some(Product::QuartzSonic),
            _ => None,
        }
    }
}
