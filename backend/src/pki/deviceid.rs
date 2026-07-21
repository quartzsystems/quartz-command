//! Device identity derivation.
//!
//! A device's ID is a pure function of its product line and Ed25519 public
//! key: `<prefix> + "-" + Crockford base32(SHA256(pubkey_raw))[0:16]`,
//! formatted in groups of four — `QF-A1B2-C3D4-E5F6-G7H8` for a QuartzFire,
//! `QS-…` for a QuartzSONiC. The agent derives the same string on-device;
//! enrollment verifies the device's claim against the derivation for the
//! token's product line.

use sha2::{Digest, Sha256};

use crate::product::Product;

/// Crockford base32 alphabet (no I, L, O, U).
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Raw Ed25519 public keys are exactly 32 bytes.
pub const ED25519_PUBKEY_LEN: usize = 32;

/// Standard MSB-first base32 over the Crockford alphabet, `n` output chars.
fn crockford_prefix(data: &[u8], n: usize) -> String {
    let mut out = String::with_capacity(n);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &b in data {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(CROCKFORD[((acc >> bits) & 0x1f) as usize] as char);
            if out.len() == n {
                return out;
            }
        }
    }
    // Zero-pad any trailing partial group (standard base32 behavior; never
    // reached for the 16-char prefix of a 32-byte digest).
    if bits > 0 && out.len() < n {
        out.push(CROCKFORD[((acc << (5 - bits)) & 0x1f) as usize] as char);
    }
    out
}

/// Derive the canonical device ID for a product line from a raw 32-byte
/// Ed25519 public key.
pub fn derive_device_id(product: Product, pubkey_raw: &[u8]) -> String {
    let digest = Sha256::digest(pubkey_raw);
    let chars = crockford_prefix(&digest, 16);
    let groups: Vec<&str> = chars
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).expect("ascii"))
        .collect();
    format!("{}-{}", product.id_prefix(), groups.join("-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_shape() {
        let id = derive_device_id(Product::QuartzFire, &[0u8; 32]);
        assert!(id.starts_with("QF-"));
        assert_eq!(id.len(), 3 + 16 + 3); // QF- + 16 chars + 3 inner dashes
        assert_eq!(id.split('-').count(), 5);
        // No excluded Crockford letters.
        for c in id.chars() {
            assert!(!"ILOU".contains(c), "invalid char {c} in {id}");
        }
    }

    #[test]
    fn derivation_is_stable_and_key_dependent() {
        let a = derive_device_id(Product::QuartzFire, &[1u8; 32]);
        assert_eq!(a, derive_device_id(Product::QuartzFire, &[1u8; 32]));
        assert_ne!(a, derive_device_id(Product::QuartzFire, &[2u8; 32]));
    }

    #[test]
    fn products_share_digest_but_not_prefix() {
        let qf = derive_device_id(Product::QuartzFire, &[1u8; 32]);
        let qs = derive_device_id(Product::QuartzSonic, &[1u8; 32]);
        assert!(qs.starts_with("QS-"));
        assert_ne!(qf, qs);
        assert_eq!(qf[3..], qs[3..]); // same key → same digest suffix
    }

    #[test]
    fn crockford_known_vector() {
        // 0xFF -> bits 11111 111(00) -> "Z" then "W" (11100).
        assert_eq!(crockford_prefix(&[0xff], 2), "ZW");
        assert_eq!(crockford_prefix(&[0x00], 1), "0");
    }
}
