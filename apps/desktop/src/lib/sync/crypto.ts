// End-to-end encryption for sync. The server this talks to (see
// packages/sync-server) never sees a "password" or the plaintext ledger —
// it only ever stores an opaque ciphertext blob plus a hashed auth token.
// Losing the sync secret means losing the cloud copy: there is no reset
// flow, deliberately, because a reset flow is a way for *someone else* to
// get back in too. That trade-off gets surfaced in the Settings UI, not
// just buried in this comment.
//
// One secret, two derived, unrelated values (same pattern as deriving
// several keys from one root via HKDF):
//   - encryptionKey: AES-256-GCM key, used to encrypt/decrypt the payload.
//     Never sent anywhere.
//   - authToken: sent to the server as a bearer credential. Derived with a
//     different HKDF "info" string than encryptionKey, so even a full
//     server compromise (which would expose authToken, or its hash)
//     cannot be used to derive encryptionKey and read anyone's data.
//   - accountId: a stable, non-secret identifier derived from the secret,
//     used as the row key on the server. Also one-way — the server can't
//     recover the secret from it.

const ENC = new TextEncoder();

async function importSecretKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", ENC.encode(secret), "HKDF", false, ["deriveBits", "deriveKey"]);
}

async function hkdfBits(secret: string, info: string, lengthBits: number): Promise<ArrayBuffer> {
  const keyMaterial = await importSecretKey(secret);
  return crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: ENC.encode("ledgerone-sync-v1"), info: ENC.encode(info) },
    keyMaterial,
    lengthBits,
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generates a fresh, high-entropy sync secret. 32 random bytes, shown to
 *  the user as base32-ish groups of 5 characters (Crockford's alphabet —
 *  no 0/O/1/I/L confusion) so it's realistic to type by hand onto a
 *  second device if needed, while still being effectively unguessable. */
export function generateSyncSecret(): string {
  const bytes = new Uint8Array(20); // 160 bits
  crypto.getRandomValues(bytes);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out.match(/.{1,5}/g)!.join("-");
}

export async function deriveAccountId(secret: string): Promise<string> {
  return toHex(await hkdfBits(secret, "ledgerone-account-id", 128));
}

export async function deriveAuthToken(secret: string): Promise<string> {
  return toHex(await hkdfBits(secret, "ledgerone-auth-token", 256));
}

async function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await importSecretKey(secret);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: ENC.encode("ledgerone-sync-v1"), info: ENC.encode("ledgerone-encryption-key") },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts a JSON-serializable payload with a fresh random IV, and
 *  returns it base64-encoded as `${iv}.${ciphertext}` — a single string,
 *  convenient to store/transmit as one opaque blob. */
export async function encryptPayload(secret: string, payload: unknown): Promise<string> {
  const key = await deriveEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = ENC.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${bufToB64(iv.buffer)}.${bufToB64(ciphertext)}`;
}

export async function decryptPayload<T = unknown>(secret: string, blob: string): Promise<T> {
  const [ivB64, ctB64] = blob.split(".");
  if (!ivB64 || !ctB64) throw new Error("Malformed sync blob");
  const key = await deriveEncryptionKey(secret);
  const iv = new Uint8Array(b64ToBuf(ivB64));
  const ciphertext = b64ToBuf(ctB64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function bufToB64(buf: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
