// Minimal client-side ULID generator (Crockford base32: 48-bit ms timestamp +
// 80-bit randomness, 26 chars total). Needed because new blocks/pages minted
// in the editor must round-trip through Rust's `Ulid::from_string` when sent
// to `update_page_blocks` — any other id format fails deserialization on the
// backend (see `cobble-core`'s `PageId`/`BlockId`, both `#[serde(transparent)]`
// wrappers around `ulid::Ulid`). Not pulled in as an npm dependency since the
// algorithm is this small and the app only ever mints ids, never parses them.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(ms: number, len: number): string {
  let str = ''
  let remaining = ms
  for (let i = len - 1; i >= 0; i--) {
    const mod = remaining % ENCODING_LEN
    str = ENCODING[mod] + str
    remaining = (remaining - mod) / ENCODING_LEN
  }
  return str
}

function randomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len)
  let str = ''
  for (let i = 0; i < len; i++) {
    str += ENCODING[bytes[i] % ENCODING_LEN]
  }
  return str
}

/** Generates a fresh ULID string, matching the format `cobble_core::BlockId::new()` / `PageId::new()` produce. */
export function newUlid(): string {
  return encodeTime(Date.now(), TIME_LEN) + encodeRandom(RANDOM_LEN)
}
