import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Just enough zip to read a GitHub Actions artifact (one file inside)
 * and to build one for tests — no dependency, no temp files. Reading is
 * central-directory driven: streamed zips leave the LOCAL headers with
 * zero sizes (data-descriptor flag), the directory always has them.
 */
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function findEocd(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

function* centralEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('corrupt zip central directory');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    yield {
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      localOffset: buf.readUInt32LE(p + 42),
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
}

/** the entry names, for error messages */
export const zipNames = (buf) => [...centralEntries(buf)].map((e) => e.name);

/** the decompressed bytes of ONE entry (stored or deflated) */
export function zipEntry(buf, name) {
  for (const e of centralEntries(buf)) {
    if (e.name !== name) continue;
    if (buf.readUInt32LE(e.localOffset) !== SIG_LOCAL) throw new Error('corrupt zip local header');
    const start = e.localOffset + 30 + buf.readUInt16LE(e.localOffset + 26) + buf.readUInt16LE(e.localOffset + 28);
    const data = buf.subarray(start, start + e.compressedSize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`zip entry ${name} uses unsupported compression method ${e.method}`);
  }
  throw new Error(`zip has no entry named ${name} (entries: ${zipNames(buf).join(', ') || 'none'})`);
}

/** build a zip from {name: Buffer|string} — deflated unless told otherwise */
export function zipBuild(entries, { deflate = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(entries)) {
    const content = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
    const data = deflate ? deflateRawSync(content) : content;
    const nameBuf = Buffer.from(name, 'utf8');
    const method = deflate ? 8 : 0;
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(centrals.length / 2, 8);
  eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}
