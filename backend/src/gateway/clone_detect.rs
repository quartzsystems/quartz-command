//! First-pass clone detection: a device's private key should exist in exactly
//! one place, so the same device_id talking from two places at once — or
//! flapping between source IPs — suggests a cloned key.
//!
//! There is no long-lived control channel yet, so "an active session" is
//! approximated as "seen within the last 10 minutes". Every authenticated
//! device contact (today: certificate renewal; later: the control channel)
//! should be reported via [`CloneDetector::record`]; a returned signal means
//! the caller should raise a "Possible cloned device" event in the org.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a source IP counts as an "active session" after last contact.
const ACTIVE_WINDOW: Duration = Duration::from_secs(10 * 60);
/// Source-IP alternations within [`ACTIVE_WINDOW`] that trigger on their own.
const MAX_SWITCHES: usize = 3;
/// Minimum spacing between alerts for the same device (avoid event spam).
const ALERT_COOLDOWN: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloneSignal {
    /// Contact from a new IP while the previous IP's session is still active.
    ConcurrentSources { previous: IpAddr, current: IpAddr },
    /// Source IP alternated more than [`MAX_SWITCHES`] times in the window.
    FlappingSources { switches: usize },
}

struct DeviceHistory {
    last_ip: IpAddr,
    last_seen: Instant,
    switches: VecDeque<Instant>,
    last_alert: Option<Instant>,
}

#[derive(Default)]
pub struct CloneDetector {
    inner: Mutex<HashMap<String, DeviceHistory>>,
}

impl CloneDetector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an authenticated contact from `ip` for `device_id`; returns a
    /// signal when the pattern looks like a cloned device (rate-limited to
    /// one alert per device per cooldown).
    pub fn record(&self, device_id: &str, ip: IpAddr) -> Option<CloneSignal> {
        let now = Instant::now();
        let mut map = self.inner.lock().expect("clone detector lock");

        let Some(hist) = map.get_mut(device_id) else {
            map.insert(
                device_id.to_string(),
                DeviceHistory {
                    last_ip: ip,
                    last_seen: now,
                    switches: VecDeque::new(),
                    last_alert: None,
                },
            );
            return None;
        };

        let previous_ip = hist.last_ip;
        let previous_seen = hist.last_seen;
        let switched = previous_ip != ip;
        hist.last_ip = ip;
        hist.last_seen = now;

        if switched {
            hist.switches.push_back(now);
        }
        while hist
            .switches
            .front()
            .is_some_and(|t| now - *t >= ACTIVE_WINDOW)
        {
            hist.switches.pop_front();
        }

        let signal = if switched && now - previous_seen < ACTIVE_WINDOW {
            if hist.switches.len() > MAX_SWITCHES {
                Some(CloneSignal::FlappingSources {
                    switches: hist.switches.len(),
                })
            } else {
                Some(CloneSignal::ConcurrentSources {
                    previous: previous_ip,
                    current: ip,
                })
            }
        } else {
            None
        };

        // Apply the per-device alert cooldown.
        if signal.is_some() {
            if hist
                .last_alert
                .is_some_and(|t| now - t < ALERT_COOLDOWN)
            {
                return None;
            }
            hist.last_alert = Some(now);
        }
        signal
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn same_ip_never_signals() {
        let d = CloneDetector::new();
        assert_eq!(d.record("QF-A", ip("1.1.1.1")), None);
        assert_eq!(d.record("QF-A", ip("1.1.1.1")), None);
    }

    #[test]
    fn concurrent_source_signals_once_per_cooldown() {
        let d = CloneDetector::new();
        assert_eq!(d.record("QF-A", ip("1.1.1.1")), None);
        assert!(matches!(
            d.record("QF-A", ip("2.2.2.2")),
            Some(CloneSignal::ConcurrentSources { .. })
        ));
        // Immediately flapping again is inside the alert cooldown.
        assert_eq!(d.record("QF-A", ip("1.1.1.1")), None);
    }

    #[test]
    fn devices_are_independent() {
        let d = CloneDetector::new();
        assert_eq!(d.record("QF-A", ip("1.1.1.1")), None);
        assert_eq!(d.record("QF-B", ip("2.2.2.2")), None);
    }
}
