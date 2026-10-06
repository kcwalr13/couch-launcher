/**
 * Game ids for steam://rungameid/.
 *
 * Steam games: the app id itself.
 * Non-Steam shortcuts: a 64-bit id built from the shortcut's 32-bit app id:
 *     (appid as unsigned 32-bit) << 32 | 0x02000000
 * shortcuts.vdf stores `appid` as a signed int32; convert with `>>> 0`.
 * Very old shortcuts.vdf files have no `appid`; Steam then derived it as
 *     crc32(exe + appname) | 0x80000000
 * Verified against steam-rom-manager's generate-app-id.ts (see docs/DECISIONS.md D-011).
 */

let CRC_TABLE: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of data) crc = (CRC_TABLE[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Unsigned 32-bit shortcut app id from the signed value stored in shortcuts.vdf. */
export function shortcutAppId(signed: number): number {
  return signed >>> 0;
}

/** Legacy app id for shortcuts without an `appid` field. Exe is used exactly as stored (with quotes). */
export function legacyShortcutAppId(exe: string, appName: string): number {
  return (crc32(new TextEncoder().encode(exe + appName)) | 0x80000000) >>> 0;
}

/** The 64-bit game id string for steam://rungameid/ from an unsigned 32-bit shortcut app id. */
export function shortcutGameId(appId32: number): string {
  return ((BigInt(appId32 >>> 0) << 32n) | 0x02000000n).toString();
}
