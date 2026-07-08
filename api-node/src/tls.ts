import { execFileSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Self-signed TLS for the app↔cloud link, minted with the **openssl 3.5 CLI** (Node's bundled OpenSSL)
 * — no node-forge. This is what makes the certs **post-quantum**: openssl 3.5 signs with ML-DSA
 * (FIPS 204), which no pure-JS library offers. Node's built-in crypto can make ML-DSA keys but has no
 * X.509 builder, so cert *minting* goes through the CLI.
 *
 *   * CA + server signatures follow CERT_ALG (default `mldsa65`; `ec` or `rsa` for max client compat).
 *   * The client leaf **key is always EC P-256** so Android's KeyManager can parse it; the CA still
 *     signs it with CERT_ALG, so the mutual-TLS chain is post-quantum on the signature.
 *   * Key exchange is separately post-quantum (hybrid X25519MLKEM768) via serverTlsOptions().
 *
 * The app pins the server cert by SHA-256 of its DER (signature-algorithm-agnostic), so switching
 * CERT_ALG needs no app change.
 */
const TLS_DIR = process.env.TLS_DIR ?? "/data/tls";
const CA_CERT = join(TLS_DIR, "ca-cert.pem");
const CA_KEY = join(TLS_DIR, "ca-key.pem");
const SRV_CERT = join(TLS_DIR, "cert.pem");
const SRV_KEY = join(TLS_DIR, "key.pem");

// CA/server signature algorithm. `mldsa65` = ML-DSA-65 (post-quantum signatures); `ec` (P-256) / `rsa`
// = classical. DEFAULT is `ec`: an ML-DSA server cert requires the CLIENT's TLS stack to verify ML-DSA
// too, and a client without it (verified: OpenSSL 3.0, and likely Android Conscrypt in 2026) fails the
// handshake. So we ship the compatible default and make PQC signatures a deliberate opt-in
// (CERT_ALG=mldsa65) — test your device first. Key exchange is post-quantum regardless (ML-KEM below).
const CERT_ALG = (process.env.CERT_ALG ?? "ec").toLowerCase();

function genpkeyArgs(alg: string): string[] {
  switch (alg) {
    case "rsa": return ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"];
    case "ec": return ["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256"];
    case "mldsa65": default: return ["genpkey", "-algorithm", "ML-DSA-65"];
  }
}

function openssl(args: string[]): void {
  execFileSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"] });
}

export function certExists(): boolean {
  return existsSync(SRV_CERT) && existsSync(SRV_KEY) && existsSync(CA_CERT);
}

/** Generate the CA + a CA-signed server cert once (idempotent). Pinned, so CN/SAN don't matter. */
export function ensureCert(): void {
  if (certExists()) return;
  mkdirSync(dirname(SRV_CERT), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "noop-tls-"));
  try {
    // CA (self-signed, CERT_ALG).
    openssl([...genpkeyArgs(CERT_ALG), "-out", CA_KEY]);
    openssl(["req", "-x509", "-new", "-key", CA_KEY, "-out", CA_CERT, "-days", "3650",
      "-subj", "/CN=noop-cloud-ca", "-addext", "basicConstraints=critical,CA:TRUE"]);
    // Server key + CA-signed cert.
    openssl([...genpkeyArgs(CERT_ALG), "-out", SRV_KEY]);
    const csr = join(work, "srv.csr");
    openssl(["req", "-new", "-key", SRV_KEY, "-out", csr, "-subj", "/CN=noop-cloud"]);
    openssl(["x509", "-req", "-in", csr, "-CA", CA_CERT, "-CAkey", CA_KEY, "-CAcreateserial",
      "-out", SRV_CERT, "-days", "3650"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** SHA-256 hex of the server cert's DER — the exact value the app pins (colon-free, lowercase). */
export function fingerprint(): string {
  const cert = new X509Certificate(readFileSync(SRV_CERT));
  return createHash("sha256").update(cert.raw).digest("hex");
}

/** Mint a client cert (EC leaf key, CA-signed) for full mutual TLS, handed to the app at pairing. */
export function mintClientCert(cn: string): { certPem: string; keyPem: string } {
  const work = mkdtempSync(join(tmpdir(), "noop-cc-"));
  try {
    const key = join(work, "c.key");
    const csr = join(work, "c.csr");
    const crt = join(work, "c.crt");
    const ext = join(work, "ext.cnf");
    writeFileSync(ext, "extendedKeyUsage=clientAuth\n");
    // Leaf key is EC P-256 (Android KeyManager-parseable), regardless of CERT_ALG.
    openssl(["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", key]);
    openssl(["req", "-new", "-key", key, "-out", csr, "-subj", `/CN=${cn}`]);
    openssl(["x509", "-req", "-in", csr, "-CA", CA_CERT, "-CAkey", CA_KEY, "-CAcreateserial",
      "-out", crt, "-days", "3650", "-extfile", ext]);
    return { certPem: readFileSync(crt, "utf8"), keyPem: readFileSync(key, "utf8") };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Server cert/key + the CA to verify client certs under mTLS (shape for node's https server). */
export interface ServerTlsOptions {
  cert: string;
  key: string;
  ca: string;
  requestCert: boolean;
  rejectUnauthorized: boolean;
  minVersion: "TLSv1.2";
  ecdhCurve: string;
}

// Post-quantum key exchange: hybrid X25519MLKEM768 (classical X25519 + ML-KEM-768) first, classical
// fallback after — quantum-resistant forward secrecy today, defeating harvest-now-decrypt-later.
const PQC_GROUPS = "X25519MLKEM768:X25519:secp256r1";

export function serverTlsOptions(): ServerTlsOptions {
  return {
    cert: readFileSync(SRV_CERT, "utf8"),
    key: readFileSync(SRV_KEY, "utf8"),
    ca: readFileSync(CA_CERT, "utf8"),
    // Request the client cert and validate it against our CA, but DON'T reject at the TLS layer:
    // pairing happens before the app has a cert, so we surface `socket.authorized` and enforce
    // per-route instead (opt-in via MTLS_REQUIRED). This is what makes mutual TLS additive.
    requestCert: true,
    rejectUnauthorized: false,
    // Floor at TLS 1.2 so Android 8–9 (API 26–28, the app's minSdk) can still use the secure link;
    // PQC-capable clients negotiate up to 1.3 + the ML-KEM group below with no extra config.
    minVersion: "TLSv1.2",
    ecdhCurve: PQC_GROUPS,
  };
}

/** The CA/server signature algorithm in effect (for startup logging). */
export function certAlg(): string {
  return CERT_ALG;
}
