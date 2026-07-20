//! Internal device CA — issues the mTLS client certificates QuartzFire
//! devices receive at enrollment. Deliberately separate from anything
//! web-facing: one CA, with the owning organization embedded in each cert as
//! a SAN URI (`quartz://org/<org_id>/device/<device_id>`).
//!
//! The CA key+cert live on disk next to the JWT secrets and are generated on
//! first start (same pattern as `security::load_or_create_secret`). The
//! stored DER is what devices get in `ca_chain_der`; reloading rebuilds an
//! rcgen signer from it, so the distributed CA cert stays byte-stable across
//! restarts.

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use rcgen::{
    BasicConstraints, CertificateParams, CertificateSigningRequestParams, DistinguishedName,
    DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType, SerialNumber,
};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;
use x509_parser::prelude::*;

/// Client certs live 30 days; devices renew at 2/3 lifetime (20 days).
pub const DEVICE_CERT_DAYS: i64 = 30;

/// OID of the Ed25519 signature/key algorithm (RFC 8410).
const OID_ED25519: &str = "1.3.101.112";

pub struct DeviceCa {
    /// The CA certificate exactly as persisted — distributed to devices.
    ca_cert_der: Vec<u8>,
    ca_cert_pem: String,
    /// Signer reconstructed from the stored cert + key (used only to sign).
    issuer: rcgen::Certificate,
    key: KeyPair,
}

/// A freshly issued device client certificate.
pub struct IssuedCert {
    pub cert_der: Vec<u8>,
    pub serial_hex: String,
    pub not_after: DateTime<Utc>,
}

/// TLS identity for the gateway listener, issued by the device CA:
/// `cert_pem` is the full presented chain (leaf + issuing CA) and `key_pem`
/// the leaf's key. Held in memory only — see [`DeviceCa::issue_gateway_cert`].
pub struct GatewayTlsIdentity {
    pub cert_pem: String,
    pub key_pem: String,
}

impl DeviceCa {
    /// Load the CA from `dir`, generating and persisting a new one on first
    /// start. Fails (rather than silently regenerating) if the files exist
    /// but cannot be parsed — regenerating would orphan every issued cert.
    pub fn load_or_create(dir: &Path) -> Result<Self> {
        let key_path = dir.join("device-ca-key.pem");
        let cert_path = dir.join("device-ca-cert.der");

        if key_path.exists() && cert_path.exists() {
            let key_pem = std::fs::read_to_string(&key_path)
                .with_context(|| format!("reading {}", key_path.display()))?;
            let key = KeyPair::from_pem(&key_pem).map_err(|e| anyhow!("parsing CA key: {e}"))?;
            let ca_cert_der = std::fs::read(&cert_path)
                .with_context(|| format!("reading {}", cert_path.display()))?;
            let params =
                CertificateParams::from_ca_cert_der(&ca_cert_der.clone().into())
                    .map_err(|e| anyhow!("parsing stored CA cert: {e}"))?;
            // Re-signing yields fresh signature bytes, but the issuer object is
            // only used to sign leaves (DN/SKI/key are what matter); devices
            // always receive the stored `ca_cert_der`.
            let issuer = params
                .self_signed(&key)
                .map_err(|e| anyhow!("rebuilding CA signer: {e}"))?;
            return Ok(Self {
                ca_cert_pem: pem_encode_cert(&ca_cert_der),
                ca_cert_der,
                issuer,
                key,
            });
        }

        let key = KeyPair::generate().map_err(|e| anyhow!("generating CA key: {e}"))?;
        let mut params = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::OrganizationName, "Quartz Command");
        dn.push(DnType::CommonName, "Quartz Command Device CA");
        params.distinguished_name = dn;
        params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        params.serial_number = Some(random_serial());
        let now = ::time::OffsetDateTime::now_utc();
        params.not_before = now - ::time::Duration::minutes(5);
        params.not_after = now + ::time::Duration::days(3650);

        let cert = params
            .self_signed(&key)
            .map_err(|e| anyhow!("self-signing CA cert: {e}"))?;
        let ca_cert_der = cert.der().to_vec();

        std::fs::create_dir_all(dir)?;
        std::fs::write(&cert_path, &ca_cert_der)?;
        std::fs::write(&key_path, key.serialize_pem())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
        }
        tracing::info!("generated new device CA in {}", dir.display());

        Ok(Self {
            ca_cert_pem: pem_encode_cert(&ca_cert_der),
            ca_cert_der,
            issuer: cert,
            key,
        })
    }

    /// The CA chain devices receive alongside their client cert.
    pub fn ca_chain_der(&self) -> Vec<Vec<u8>> {
        vec![self.ca_cert_der.clone()]
    }

    /// PEM form of the CA cert (tonic wants PEM for the client-cert root).
    pub fn ca_cert_pem(&self) -> &str {
        &self.ca_cert_pem
    }

    /// SHA-256 fingerprint of the CA cert DER, lowercase hex.
    pub fn fingerprint_hex(&self) -> String {
        hex(&Sha256::digest(&self.ca_cert_der))
    }

    /// Issue a TLS server certificate for the gateway listener, covering
    /// `host` (DNS name or IP literal) plus loopback for on-box checks.
    ///
    /// Reissued on every startup and never persisted: devices trust the CA
    /// fingerprint pinned in their enrollment token, not the leaf, so a fresh
    /// key per boot costs nothing and keeps the private key off disk. Validity
    /// is kept well inside the CA's own 10-year window.
    pub fn issue_gateway_cert(&self, host: &str) -> Result<GatewayTlsIdentity> {
        let key = KeyPair::generate().map_err(|e| anyhow!("generating gateway TLS key: {e}"))?;

        let mut params = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::OrganizationName, "Quartz Command");
        dn.push(DnType::CommonName, host);
        params.distinguished_name = dn;
        params.is_ca = IsCa::ExplicitNoCa;
        params.serial_number = Some(random_serial());
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let now = ::time::OffsetDateTime::now_utc();
        params.not_before = now - ::time::Duration::minutes(5);
        params.not_after = now + ::time::Duration::days(730);

        let mut sans = vec![san_for_host(host)?];
        for local in ["localhost", "127.0.0.1"] {
            if host != local {
                sans.push(san_for_host(local)?);
            }
        }
        params.subject_alt_names = sans;

        let cert = params
            .signed_by(&key, &self.issuer, &self.key)
            .map_err(|e| anyhow!("signing gateway TLS cert: {e}"))?;

        // Present leaf + issuing CA: devices pin the CA by SHA-256 and look
        // for it in the presented chain, so a leaf alone can never match.
        Ok(GatewayTlsIdentity {
            cert_pem: format!("{}{}", cert.pem(), self.ca_cert_pem),
            key_pem: key.serialize_pem(),
        })
    }

    /// Validate a device CSR and issue a 30-day client certificate.
    ///
    /// Checks (all must hold): the CSR is well-formed with a valid
    /// self-signature, its key is Ed25519 and equals `expected_pubkey`, and
    /// its subject CN equals `device_id`. Cert contents (validity, serial,
    /// SAN URI, usages) are set here — nothing from the CSR is trusted
    /// beyond the public key.
    pub fn issue_device_cert(
        &self,
        csr_der: &[u8],
        device_id: &str,
        org_id: Uuid,
        expected_pubkey: &[u8],
    ) -> Result<IssuedCert> {
        let (_, csr) = X509CertificationRequest::from_der(csr_der)
            .map_err(|e| anyhow!("malformed CSR: {e}"))?;
        csr.verify_signature()
            .map_err(|e| anyhow!("CSR signature invalid: {e}"))?;

        let info = &csr.certification_request_info;
        let alg = info
            .subject_pki
            .algorithm
            .algorithm
            .to_id_string();
        if alg != OID_ED25519 {
            bail!("CSR key is not Ed25519 (algorithm {alg})");
        }
        if info.subject_pki.subject_public_key.data.as_ref() != expected_pubkey {
            bail!("CSR public key does not match the enrolled device key");
        }
        let cn = info
            .subject
            .iter_common_name()
            .next()
            .and_then(|c| c.as_str().ok())
            .ok_or_else(|| anyhow!("CSR has no CN"))?;
        if cn != device_id {
            bail!("CSR CN {cn:?} does not match device id {device_id:?}");
        }

        let mut csr_params = CertificateSigningRequestParams::from_der(&csr_der.to_vec().into())
            .map_err(|e| anyhow!("unsupported CSR: {e}"))?;

        let serial = random_serial();
        let serial_hex = hex(serial.as_ref());
        let now = ::time::OffsetDateTime::now_utc();
        let not_after = now + ::time::Duration::days(DEVICE_CERT_DAYS);

        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, device_id);
        csr_params.params.distinguished_name = dn;
        csr_params.params.serial_number = Some(serial);
        csr_params.params.not_before = now - ::time::Duration::minutes(5);
        csr_params.params.not_after = not_after;
        csr_params.params.is_ca = IsCa::ExplicitNoCa;
        csr_params.params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        csr_params.params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
        csr_params.params.subject_alt_names = vec![SanType::URI(
            rcgen::Ia5String::try_from(format!("quartz://org/{org_id}/device/{device_id}"))
                .map_err(|e| anyhow!("building SAN URI: {e}"))?,
        )];

        let cert = csr_params
            .signed_by(&self.issuer, &self.key)
            .map_err(|e| anyhow!("signing device cert: {e}"))?;

        Ok(IssuedCert {
            cert_der: cert.der().to_vec(),
            serial_hex,
            not_after: Utc
                .timestamp_opt(not_after.unix_timestamp(), 0)
                .single()
                .ok_or_else(|| anyhow!("cert expiry out of range"))?,
        })
    }
}

/// Identity asserted by a presented device client certificate.
#[derive(Debug, Clone)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub org_id: Uuid,
    pub pubkey: Vec<u8>,
}

/// Parse a presented client certificate (DER) into the device identity it
/// asserts: CN = device_id, SAN URI carries the org, SPKI is the Ed25519 key.
/// Trust in the cert itself comes from the TLS handshake (client CA root).
pub fn identity_from_cert_der(cert_der: &[u8]) -> Result<DeviceIdentity> {
    let (_, cert) = X509Certificate::from_der(cert_der)
        .map_err(|e| anyhow!("malformed client cert: {e}"))?;
    let device_id = cert
        .subject()
        .iter_common_name()
        .next()
        .and_then(|c| c.as_str().ok())
        .ok_or_else(|| anyhow!("client cert has no CN"))?
        .to_string();
    let pubkey = cert
        .public_key()
        .subject_public_key
        .data
        .as_ref()
        .to_vec();

    let mut org_id = None;
    for ext in cert.extensions() {
        if let ParsedExtension::SubjectAlternativeName(san) = ext.parsed_extension() {
            for name in &san.general_names {
                if let GeneralName::URI(uri) = name {
                    if let Some(rest) = uri.strip_prefix("quartz://org/") {
                        if let Some((org, _)) = rest.split_once("/device/") {
                            org_id = org.parse::<Uuid>().ok();
                        }
                    }
                }
            }
        }
    }
    let org_id = org_id.ok_or_else(|| anyhow!("client cert has no quartz org SAN"))?;

    Ok(DeviceIdentity {
        device_id,
        org_id,
        pubkey,
    })
}

/// SHA-256 hex fingerprint for the `sha256:` field of enrollment tokens: the
/// CA that issued the gateway's TLS cert when configured (PEM or DER file),
/// otherwise the device CA cert — correct for self-hosted setups where the
/// gateway serves a cert from the internal CA, and harmless for the hosted
/// service where devices prefer WebPKI validation anyway.
pub fn gateway_ca_fingerprint_hex(
    gateway_ca_file: Option<&Path>,
    device_ca: &DeviceCa,
) -> Result<String> {
    let Some(path) = gateway_ca_file else {
        return Ok(device_ca.fingerprint_hex());
    };
    let bytes =
        std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let der = if bytes.starts_with(b"-----BEGIN") {
        x509_parser::pem::parse_x509_pem(&bytes)
            .map_err(|e| anyhow!("parsing PEM {}: {e}", path.display()))?
            .1
            .contents
    } else {
        bytes
    };
    Ok(hex(&Sha256::digest(&der)))
}

/// SAN entry for a host that may be a DNS name or an IP literal.
fn san_for_host(host: &str) -> Result<SanType> {
    Ok(match host.parse::<std::net::IpAddr>() {
        Ok(ip) => SanType::IpAddress(ip),
        Err(_) => SanType::DnsName(
            rcgen::Ia5String::try_from(host)
                .map_err(|e| anyhow!("invalid gateway host {host:?}: {e}"))?,
        ),
    })
}

/// Positive random 16-byte certificate serial.
fn random_serial() -> SerialNumber {
    let mut bytes: [u8; 16] = rand::random();
    bytes[0] &= 0x7f; // keep the INTEGER positive
    SerialNumber::from(bytes.to_vec())
}

fn hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

fn pem_encode_cert(der: &[u8]) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(der);
    let mut out = String::from("-----BEGIN CERTIFICATE-----\n");
    for chunk in b64.as_bytes().chunks(64) {
        out.push_str(std::str::from_utf8(chunk).expect("base64 is ascii"));
        out.push('\n');
    }
    out.push_str("-----END CERTIFICATE-----\n");
    out
}
