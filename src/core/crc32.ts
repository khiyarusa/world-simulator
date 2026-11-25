/** CRC32 (IEEE 802.3, reflected) used for shard integrity and state checksums. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32Update(crc: number, byte: number): number {
  const index = (crc ^ byte) & 0xff;
  return ((crc >>> 8) ^ (TABLE[index] ?? 0)) >>> 0;
}

export function crc32(bytes: Uint8Array, seed = 0): number {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    crc = ((crc >>> 8) ^ (TABLE[(crc ^ b) & 0xff] ?? 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32OfU32(crc: number, value: number): number {
  let c = crc;
  c = crc32Update(c, value & 0xff);
  c = crc32Update(c, (value >>> 8) & 0xff);
  c = crc32Update(c, (value >>> 16) & 0xff);
  c = crc32Update(c, (value >>> 24) & 0xff);
  return c;
}

/** Stable hex for logs and reports. */
export function crcHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
