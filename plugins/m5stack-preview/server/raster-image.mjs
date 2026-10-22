/** Bounded local PNG fixtures -> native RGB565. No network or arbitrary-path API. */
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 2048;
const MAX_RGBA_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = 4096;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SRGB_CHROMATICITY = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];
const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function invalid(message = 'The PNG fixture is malformed.') { return failure('INVALID_IMAGE', message); }
function unsupported() { return failure('UNSUPPORTED_IMAGE', 'Use a non-interlaced 8-bit RGB/RGBA PNG with sRGB-compatible color metadata.'); }
function checksum(buffer, begin, end) {
  let value = 0xffffffff;
  for (let i = begin; i < end; i++) value = CRC_TABLE[(value ^ buffer[i]) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Returns {width,height,rgba}; metadata and original filenames are not retained. */
export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45) throw invalid();
  if (buffer.length > MAX_FILE_BYTES) throw failure('IMAGE_LIMIT', 'The PNG fixture exceeds the 2 MiB file limit.');
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw invalid('Expected a PNG fixture.');
  let offset = 8, chunks = 0, width, height, channels, ended = false, seenData = false, dataClosed = false;
  const compressed = [], unique = new Set();
  while (offset < buffer.length) {
    if (++chunks > MAX_CHUNKS) throw failure('IMAGE_LIMIT', 'The PNG fixture has too many chunks.');
    if (buffer.length - offset < 12) throw invalid();
    const length = buffer.readUInt32BE(offset), end = offset + 12 + length;
    if (end > buffer.length) throw invalid();
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw invalid();
    if (checksum(buffer, offset + 4, end - 4) !== buffer.readUInt32BE(end - 4)) throw invalid('The PNG fixture failed its checksum.');
    const data = buffer.subarray(offset + 8, end - 4);
    if (width === undefined && type !== 'IHDR') throw invalid();
    if (seenData && type !== 'IDAT') dataClosed = true;
    if (type === 'IHDR') {
      if (width !== undefined || length !== 13 || chunks !== 1) throw invalid();
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height * 4 > MAX_RGBA_BYTES)
        throw failure('IMAGE_LIMIT', 'PNG dimensions must be between 1 and 2048 pixels per side, within 16 MiB of RGBA pixels.');
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw unsupported();
      channels = data[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      if (dataClosed) throw invalid('PNG image data chunks must be contiguous.');
      seenData = true; compressed.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || !seenData || end !== buffer.length) throw invalid();
      ended = true; offset = end; break;
    } else if (['sRGB', 'gAMA', 'cHRM', 'pHYs', 'PLTE'].includes(type)) {
      if (seenData || unique.has(type) || (['sRGB', 'gAMA', 'cHRM'].includes(type) && unique.has('PLTE'))) throw invalid();
      unique.add(type);
      if (type === 'sRGB' && (length !== 1 || data[0] > 3)) throw invalid();
      if (type === 'gAMA' && (length !== 4 || data.readUInt32BE(0) !== 45455)) throw unsupported();
      if (type === 'cHRM' && (length !== 32 || SRGB_CHROMATICITY.some((v, i) => data.readUInt32BE(i * 4) !== v))) throw unsupported();
      if (type === 'pHYs' && (length !== 9 || data[8] > 1)) throw invalid();
      if (type === 'PLTE' && (length < 3 || length > 768 || length % 3)) throw invalid();
    } else if (type === 'tEXt') {
      // Uncompressed text has no pixel effect. Drop it without exposing metadata.
      const separator = data.indexOf(0);
      if (separator < 1 || separator > 79) throw invalid();
    } else {
      // Includes APNG, ICC profiles, EXIF orientation, tRNS, significant bits,
      // compressed text, unrecognized ancillary data and unknown critical data.
      throw unsupported();
    }
    offset = end;
  }
  if (!ended || !seenData) throw invalid();
  const input = Buffer.concat(compressed), stride = width * channels, expected = (stride + 1) * height;
  let scanlines;
  try {
    const result = inflateSync(input, { maxOutputLength: expected, info: true });
    if (result.buffer.length !== expected || result.engine.bytesWritten !== input.length) throw invalid();
    scanlines = result.buffer;
  } catch { throw invalid('PNG compressed pixels do not match the declared dimensions.'); }
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const begin = y * (stride + 1) + 1, filter = scanlines[begin - 1];
    if (filter > 4) throw invalid('The PNG fixture uses an invalid row filter.');
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? scanlines[begin + x - channels] : 0;
      const above = y ? scanlines[begin + x - stride - 1] : 0;
      const upperLeft = y && x >= channels ? scanlines[begin + x - stride - 1 - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft);
      scanlines[begin + x] = (scanlines[begin + x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const source = begin + x * channels, target = (y * width + x) * 4;
      rgba[target] = scanlines[source]; rgba[target + 1] = scanlines[source + 1]; rgba[target + 2] = scanlines[source + 2];
      rgba[target + 3] = channels === 4 ? scanlines[source + 3] : 255;
    }
  }
  return { width, height, rgba };
}

function validateTarget(width, height, fit, background) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 320 || height > 240 ||
      !['contain', 'cover'].includes(fit) || !Number.isInteger(background) || background < 0 || background > 0xffff)
    throw failure('INVALID_IMAGE_TARGET', 'Use a display up to 320 × 240, contain/cover fit and a 16-bit RGB565 background.');
}

/** Nearest-neighbor pixel-center sampling; alpha composites over RGB565 background. */
export function fitRgb565(decoded, width, height, fit = 'contain', background = 0) {
  validateTarget(width, height, fit, background);
  if (!decoded || !Number.isInteger(decoded.width) || !Number.isInteger(decoded.height) || decoded.width < 1 || decoded.height < 1 ||
      decoded.width > MAX_SIDE || decoded.height > MAX_SIDE || !Buffer.isBuffer(decoded.rgba) || decoded.rgba.length !== decoded.width * decoded.height * 4)
    throw invalid('Decoded RGBA pixels have invalid dimensions.');
  const scale = Math[fit === 'contain' ? 'min' : 'max'](width / decoded.width, height / decoded.height);
  const left = (width - decoded.width * scale) / 2, top = (height - decoded.height * scale) / 2;
  const r5 = (background >>> 11) & 31, g6 = (background >>> 5) & 63, b5 = background & 31;
  const br = (r5 << 3) | (r5 >>> 2), bg = (g6 << 2) | (g6 >>> 4), bb = (b5 << 3) | (b5 >>> 2);
  const rgb565 = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x + 0.5 - left) / scale), sy = Math.floor((y + 0.5 - top) / scale);
    let pixel = background;
    if (sx >= 0 && sy >= 0 && sx < decoded.width && sy < decoded.height) {
      const offset = (sy * decoded.width + sx) * 4, alpha = decoded.rgba[offset + 3];
      const r = Math.floor((decoded.rgba[offset] * alpha + br * (255 - alpha) + 127) / 255);
      const g = Math.floor((decoded.rgba[offset + 1] * alpha + bg * (255 - alpha) + 127) / 255);
      const b = Math.floor((decoded.rgba[offset + 2] * alpha + bb * (255 - alpha) + 127) / 255);
      pixel = ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
    }
    rgb565.writeUInt16LE(pixel, (y * width + x) * 2);
  }
  return rgb565;
}

function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function contained(root, value) { const relative = path.relative(root, value); return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); }

/** Reads exactly one named fixture, with no recursive discovery or URL support. */
export async function loadWorkspaceImage(root, relativePath, { width, height, fit = 'contain', background = 0 } = {}) {
  validateTarget(width, height, fit, background);
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof relativePath !== 'string' ||
      !/^media-fixtures\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.png$/.test(relativePath))
    throw failure('INVALID_IMAGE_PATH', 'Select a named PNG under the current workspace media-fixtures directory.');
  let handle, bytes;
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error();
    const canonicalRoot = await fs.realpath(root), directory = path.join(canonicalRoot, 'media-fixtures');
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !contained(canonicalRoot, await fs.realpath(directory))) throw new Error();
    const file = path.join(canonicalRoot, relativePath), before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 45 || before.size > MAX_FILE_BYTES || !contained(directory, await fs.realpath(file))) throw new Error();
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!sameFile(before, await handle.stat())) throw new Error();
    // Read a bounded preallocated buffer: a file growing during the read cannot
    // force unbounded readFile allocation. Afterwards reject any source change.
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error();
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, bytes.length)).bytesRead || !sameFile(before, await handle.stat()) ||
        !sameFile(before, await fs.lstat(file)) || !sameFile(directoryStat, await fs.lstat(directory)) ||
        await fs.realpath(directory) !== directory || !sameFile(rootStat, await fs.lstat(root))) throw new Error();
  } catch {
    throw failure('IMAGE_READ_FAILED', 'The selected PNG fixture is unavailable, changed or outside the supported file limits.');
  } finally { await handle?.close().catch(() => {}); }
  const decoded = decodePng(bytes);
  return { width, height, rgb565: fitRgb565(decoded, width, height, fit, background), sourceSha256: createHash('sha256').update(bytes).digest('hex'), fit };
}
