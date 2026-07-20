//! Registry of live device control streams. The gRPC ControlStream handler
//! registers each connected device here; the console's VyOS proxy endpoint
//! sends requests through it and awaits the matched response.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::gateway::pb::device::v1::{
    controller_message, ControllerMessage, ProxyRequest, ProxyResponse,
};

/// Why a proxied call produced no device response.
#[derive(Debug)]
pub enum ProxyError {
    /// No live control stream for the device.
    Offline,
    /// The device did not answer within the deadline.
    Timeout,
    /// The stream dropped while the request was in flight.
    Disconnected,
}

struct Connection {
    /// Monotonic id so a slow cleanup can't evict a newer connection.
    epoch: u64,
    org_id: Uuid,
    tx: mpsc::Sender<ControllerMessage>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<ProxyResponse>>>>,
}

#[derive(Default)]
pub struct DeviceRegistry {
    connections: Mutex<HashMap<String, Connection>>,
    epochs: AtomicU64,
}

impl DeviceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a freshly authenticated stream; a newer connection replaces
    /// any existing one (the old stream's send half just starts failing).
    /// Returns the epoch to pass to `deregister`.
    pub fn register(
        &self,
        device_id: &str,
        org_id: Uuid,
        tx: mpsc::Sender<ControllerMessage>,
    ) -> u64 {
        let epoch = self.epochs.fetch_add(1, Ordering::Relaxed) + 1;
        let conn = Connection {
            epoch,
            org_id,
            tx,
            pending: Arc::new(Mutex::new(HashMap::new())),
        };
        self.connections
            .lock()
            .unwrap()
            .insert(device_id.to_string(), conn);
        epoch
    }

    /// Drop the registration, but only if it is still the same connection.
    pub fn deregister(&self, device_id: &str, epoch: u64) {
        let mut conns = self.connections.lock().unwrap();
        if conns.get(device_id).is_some_and(|c| c.epoch == epoch) {
            conns.remove(device_id);
        }
    }

    pub fn is_online(&self, device_id: &str) -> bool {
        self.connections.lock().unwrap().contains_key(device_id)
    }

    /// Snapshot of every device with a live control stream right now. Taken in
    /// one lock so the console device list can mark connectivity without a
    /// per-device lock round-trip.
    pub fn online_ids(&self) -> std::collections::HashSet<String> {
        self.connections.lock().unwrap().keys().cloned().collect()
    }

    /// Route a response from the device's stream to its waiting caller.
    pub fn resolve(&self, device_id: &str, resp: ProxyResponse) {
        let waiter = {
            let conns = self.connections.lock().unwrap();
            let Some(conn) = conns.get(device_id) else {
                return;
            };
            let w = conn.pending.lock().unwrap().remove(&resp.request_id);
            w
        };
        if let Some(tx) = waiter {
            let _ = tx.send(resp);
        }
    }

    /// Send one local-API call to the device and await its response. `org_id`
    /// must match the org the stream authenticated under — a second tenant
    /// check on top of the caller's own device-row lookup.
    pub async fn proxy(
        &self,
        device_id: &str,
        org_id: Uuid,
        method: &str,
        path: &str,
        content_type: &str,
        body: Vec<u8>,
        timeout: Duration,
    ) -> Result<ProxyResponse, ProxyError> {
        let request_id = Uuid::new_v4().to_string();
        let (resp_tx, resp_rx) = oneshot::channel();

        let (tx, pending) = {
            let conns = self.connections.lock().unwrap();
            let conn = conns.get(device_id).ok_or(ProxyError::Offline)?;
            if conn.org_id != org_id {
                return Err(ProxyError::Offline);
            }
            conn.pending
                .lock()
                .unwrap()
                .insert(request_id.clone(), resp_tx);
            (conn.tx.clone(), conn.pending.clone())
        };

        let msg = ControllerMessage {
            msg: Some(controller_message::Msg::ProxyRequest(ProxyRequest {
                request_id: request_id.clone(),
                method: method.to_string(),
                path: path.to_string(),
                content_type: content_type.to_string(),
                body,
            })),
        };
        if tx.send(msg).await.is_err() {
            pending.lock().unwrap().remove(&request_id);
            return Err(ProxyError::Disconnected);
        }

        match tokio::time::timeout(timeout, resp_rx).await {
            Ok(Ok(resp)) => Ok(resp),
            Ok(Err(_)) => Err(ProxyError::Disconnected),
            Err(_) => {
                pending.lock().unwrap().remove(&request_id);
                Err(ProxyError::Timeout)
            }
        }
    }
}
