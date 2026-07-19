//! Device PKI: the internal CA issuing device mTLS client certificates, and
//! the pubkey → device-ID derivation both sides of enrollment agree on.

pub mod ca;
pub mod deviceid;
