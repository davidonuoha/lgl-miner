/* ==========================================================================
   $LGL Miner — minimal ZIP reader
   --------------------------------------------------------------------------
   Just enough to pull the .apk out of the Android package the PWABuilder
   service returns. Handles stored (method 0) and deflate (method 8) entries
   using the native DecompressionStream. No dependencies.
   ========================================================================== */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Locates the End Of Central Directory record by scanning backwards. */
function findEOCD(view) {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/** Lists the central-directory entries of a ZIP ArrayBuffer. */
export function listEntries(buffer) {
  const view = new DataView(buffer);
  const eocd = findEOCD(view);
  if (eocd < 0) return [];

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CEN_SIG) break;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const uncompSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLen));
    entries.push({ name, method, compSize, uncompSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Decompresses a single entry to a Uint8Array. */
export async function readEntry(buffer, entry) {
  const view = new DataView(buffer);
  const lo = entry.localOffset;
  if (view.getUint32(lo, true) !== LOC_SIG) throw new Error('Corrupt ZIP: bad local header');

  const nameLen = view.getUint16(lo + 26, true);
  const extraLen = view.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const data = buffer.slice(start, start + entry.compSize);

  if (entry.method === 0) return new Uint8Array(data);
  if (entry.method !== 8) throw new Error(`Unsupported ZIP compression (method ${entry.method})`);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack ZIP files');

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Extracts the first entry whose name satisfies `test`.
 * @returns {Promise<{name: string, bytes: Uint8Array}|null>}
 */
export async function extractFirst(buffer, test) {
  const entry = listEntries(buffer).find((e) => test(e.name));
  if (!entry) return null;
  return { name: entry.name, bytes: await readEntry(buffer, entry) };
}
