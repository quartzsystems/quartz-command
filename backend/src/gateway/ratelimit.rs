//! Per-source-IP rate limiting for the unauthenticated enrollment bootstrap
//! path. In-memory sliding window — the gateway is a single process, and the
//! goal is blunting brute-force of token ids/secrets, not precise QoS.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    max_per_window: usize,
    window: Duration,
    inner: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new(max_per_window: usize, window: Duration) -> Self {
        Self {
            max_per_window,
            window,
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Record a hit from `ip`; returns false when the IP is over its budget.
    pub fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().expect("rate limiter lock");

        // Keep the map from growing without bound under address churn.
        if map.len() > 100_000 {
            let window = self.window;
            map.retain(|_, hits| hits.back().is_some_and(|t| now - *t < window));
        }

        let hits = map.entry(ip).or_default();
        while hits.front().is_some_and(|t| now - *t >= self.window) {
            hits.pop_front();
        }
        if hits.len() >= self.max_per_window {
            return false;
        }
        hits.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_ip() {
        let rl = RateLimiter::new(3, Duration::from_secs(60));
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        let b: IpAddr = "10.0.0.2".parse().unwrap();
        assert!(rl.check(a));
        assert!(rl.check(a));
        assert!(rl.check(a));
        assert!(!rl.check(a), "fourth hit in window must be rejected");
        assert!(rl.check(b), "other IPs are unaffected");
    }
}
