//! Cloud console (user realm): member auth and the org-scoped REST endpoints
//! behind it — organizations, device inventory, enrollment tokens.

pub mod auth;
pub mod device_proxy;
pub mod devices;
pub mod enroll_tokens;
pub mod organizations;
pub mod updates;
