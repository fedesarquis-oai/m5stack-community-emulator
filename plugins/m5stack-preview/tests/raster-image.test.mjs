import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { decodePng, fitRgb565, loadWorkspaceImage } from '../server/raster-image.mjs';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
function header({ width = 1, height = 1, depth = 8, color = 2, compression = 0, filter = 0, interlace = 0 } = {}) {
  const out = Buffer.alloc(13); out.writeUInt32BE(width); out.writeUInt32BE(height, 4);
  out.set([depth,color,compression,filter,interlace], 8); return chunk('IHDR', out);
}
function png({ raw = [0,255,0,0], before = [], after = [], data, ...config } = {}) {
  return Buffer.concat([signature, header(config), ...before, chunk('IDAT', data ?? deflateSync(Buffer.from(raw))), ...after, chunk('IEND')]);
}
const words = buffer => Array.from({ length: buffer.length / 2 }, (_, i) => buffer.readUInt16LE(i * 2));
const rgba = (width, height, values) => ({ width, height, rgba: Buffer.from(values) });
const rejectImage = value => assert.throws(() => decodePng(value), error => ['INVALID_IMAGE','UNSUPPORTED_IMAGE','IMAGE_LIMIT'].includes(error.code));

test('known 2x2 corner colors survive PNG decode and exact little-endian RGB565', () => {
  const decoded = decodePng(png({ width: 2, height: 2, raw: [0,255,0,0,0,255,0,0,0,0,255,255,255,255] }));
  assert.deepEqual(decoded, rgba(2,2,[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]));
  assert.deepEqual(fitRgb565(decoded,2,2), Buffer.from([0,248,224,7,31,0,255,255]));
});
for (const [filter, rows] of [
  [0, [[10,20,30,40,50,60],[70,80,90,100,110,120]]],
  [1, [[10,20,30,30,30,30],[70,80,90,30,30,30]]],
  [2, [[10,20,30,40,50,60],[60,60,60,60,60,60]]],
  [3, [[10,20,30,35,40,45],[65,70,75,45,45,45]]],
  [4, [[10,20,30,30,30,30],[60,60,60,30,30,30]]],
]) test(`PNG filter ${filter} reconstructs hand-computed RGB rows`, () => {
  assert.deepEqual(decodePng(png({width:2,height:2,raw:[filter,...rows[0],filter,...rows[1]]})).rgba,
    Buffer.from([10,20,30,255,40,50,60,255,70,80,90,255,100,110,120,255]));
});
test('RGBA filter distance is four bytes and transparent pixels are composited', () => {
  const decoded = decodePng(png({width:2,color:6,raw:[1,255,0,0,128,1,0,255,128]}));
  assert.deepEqual(decoded.rgba,Buffer.from([255,0,0,128,0,0,255,0]));
  assert.deepEqual(words(fitRgb565(decoded,2,1,'contain',0xffff)),[0xfbef,0xffff]);
  assert.deepEqual(words(fitRgb565(decoded,2,1)),[0x8000,0]);
});
test('contain preserves aspect ratio with explicit background bars', () => {
  const decoded = rgba(2,1,[255,0,0,255,0,255,0,255]);
  assert.deepEqual(words(fitRgb565(decoded,4,4,'contain',31)),[
    31,31,31,31,0xf800,0xf800,0x07e0,0x07e0,0xf800,0xf800,0x07e0,0x07e0,31,31,31,31]);
});
test('cover crops centrally without distortion and nearest-neighbor downsamples', () => {
  const decoded = rgba(3,1,[255,0,0,255,0,255,0,255,0,0,255,255]);
  assert.deepEqual(words(fitRgb565(decoded,1,1,'cover')),[0x07e0]);
  assert.deepEqual(words(fitRgb565(decoded,3,3,'cover')),Array(9).fill(0x07e0));
});
test('target geometry and decoded pixels are bounded before rendering', () => {
  const decoded = decodePng(png());
  for (const args of [[321,240],[320,241],[0,1],[1.1,1],[1,1,'stretch'],[1,1,'contain',65536],[1,1,'contain',-1]])
    assert.throws(()=>fitRgb565(decoded,...args),{code:'INVALID_IMAGE_TARGET'});
  assert.throws(()=>fitRgb565({width:2,height:2,rgba:Buffer.alloc(4)},1,1),{code:'INVALID_IMAGE'});
  assert.equal(fitRgb565(decoded,320,240).length,153600);
});
test('compatible sRGB metadata and uncompressed text do not affect pixels or leak text', () => {
  const gamma=Buffer.alloc(4);gamma.writeUInt32BE(45455);
  const chrm=Buffer.alloc(32);[31270,32900,64000,33000,30000,60000,15000,6000].forEach((n,i)=>chrm.writeUInt32BE(n,i*4));
  const decoded=decodePng(png({before:[chunk('sRGB',Buffer.from([0])),chunk('gAMA',gamma),chunk('cHRM',chrm),chunk('tEXt',Buffer.from('Comment\0private test metadata'))]}));
  assert.deepEqual(Object.keys(decoded),['width','height','rgba']);
  assert.deepEqual(decoded.rgba,Buffer.from([255,0,0,255]));
});
test('split contiguous IDAT chunks form one stream', () => {
  const compressed=deflateSync(Buffer.from([0,255,0,0]));
  const bytes=Buffer.concat([signature,header(),chunk('IDAT',compressed.subarray(0,3)),chunk('IDAT'),chunk('IDAT',compressed.subarray(3)),chunk('IEND')]);
  assert.deepEqual(decodePng(bytes).rgba,Buffer.from([255,0,0,255]));
});
for (const config of [{depth:16},{depth:1},{color:3},{color:0},{color:4},{interlace:1},{compression:1},{filter:1}])
  test(`reject unsupported PNG encoding ${JSON.stringify(config)}`,()=>rejectImage(png(config)));
for (const type of ['acTL','fcTL','fdAT','iCCP','eXIf','tRNS','sBIT','iTXt','zTXt','ABCD','abCd'])
  test(`reject unsupported PNG chunk ${type}`,()=>rejectImage(png({before:[chunk(type,Buffer.alloc(8))]})));
test('reject non-sRGB gamma/chromaticity instead of silently changing colors', () => {
  const gamma=Buffer.alloc(4);gamma.writeUInt32BE(100000);
  rejectImage(png({before:[chunk('gAMA',gamma)]}));
  rejectImage(png({before:[chunk('cHRM',Buffer.alloc(32))]}));
});
test('reject incorrect CRC, invalid chunk name and oversized chunk length', () => {
  const corrupt=png();corrupt[29]^=1;rejectImage(corrupt);
  rejectImage(png({before:[chunk('abcd')]}));
  const length=png();length.writeUInt32BE(0xffffffff,33);rejectImage(length);
});
test('reject duplicate/missing/misordered/trailing PNG structural chunks', () => {
  rejectImage(png({before:[header()]}));
  rejectImage(Buffer.concat([signature,chunk('IDAT',deflateSync(Buffer.from([0,255,0,0]))),header(),chunk('IEND')]));
  rejectImage(png().subarray(0,png().length-12));
  rejectImage(Buffer.concat([png(),Buffer.from([0])]));
  rejectImage(Buffer.concat([signature,header(),chunk('IEND')]));
  rejectImage(png({before:[chunk('sRGB',Buffer.from([0])),chunk('sRGB',Buffer.from([0]))]}));
  rejectImage(png({after:[chunk('sRGB',Buffer.from([0]))]}));
  rejectImage(png({before:[chunk('PLTE',Buffer.from([255,0,0])),chunk('sRGB',Buffer.from([0]))]}));
  const compressed=deflateSync(Buffer.from([0,255,0,0]));
  rejectImage(Buffer.concat([signature,header(),chunk('IDAT',compressed.subarray(0,3)),chunk('tEXt',Buffer.from('A\0B')),chunk('IDAT',compressed.subarray(3)),chunk('IEND')]));
});
test('reject invalid metadata lengths, text keyword and sRGB intent', () => {
  for (const [type, data] of [['sRGB',[4]],['sRGB',[]],['gAMA',[0]],['cHRM',[0]],['pHYs',[0]],['PLTE',[1]],['tEXt',[0,1]],['tEXt',[65]]])
    rejectImage(png({before:[chunk(type,Buffer.from(data))]}));
});
test('reject too many chunks and image/file dimension limits', () => {
  rejectImage(png({before:Array.from({length:4096},()=>chunk('tEXt',Buffer.from('A\0B')))}));
  for(const config of [{width:0},{height:0},{width:2049},{height:2049},{width:0xffffffff,height:0xffffffff}]) rejectImage(png(config));
  rejectImage(Buffer.alloc(2*1024*1024+1));
});
test('inflate rejects short/long pixels, invalid filters, junk and concatenated streams', () => {
  for(const raw of [[0,255,0],[0,255,0,0,0],[5,255,0,0]])rejectImage(png({raw}));
  rejectImage(png({data:deflateSync(Buffer.alloc(30000))}));
  rejectImage(png({data:Buffer.from('not zlib')}));
  const compressed=deflateSync(Buffer.from([0,255,0,0]));
  rejectImage(png({data:Buffer.concat([compressed,Buffer.from([0])])}));
  rejectImage(png({data:Buffer.concat([compressed,compressed])}));
});
async function workspace(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'m5-raster-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'media-fixtures'));
  await fs.writeFile(path.join(root,'media-fixtures/image.png'),png());
  return root;
}
test('load named workspace fixture yields exact source hash, no source path and bounded pixels',async t=>{
  const root=await workspace(t),result=await loadWorkspaceImage(root,'media-fixtures/image.png',{width:320,height:240});
  assert.deepEqual(Object.keys(result),['width','height','rgb565','sourceSha256','fit']);
  assert.equal(result.sourceSha256,createHash('sha256').update(png()).digest('hex'));
  assert.equal(result.rgb565.length,153600);assert.equal(result.fit,'contain');
  assert.equal(result.rgb565.readUInt16LE((120*320+160)*2),0xf800);
});
test('traversal, arbitrary/private paths, URLs, encoded paths and unsupported files are rejected before reads',async t=>{
  const root=await workspace(t);
  for(const value of ['../private.png','/private/image.png','file:///private/image.png','https://example.test/x.png','media-fixtures/../image.png',
    'media-fixtures/%2e%2e.png','media-fixtures/sub/image.png','media-fixtures\\image.png','media-fixtures/.hidden.png',
    'media-fixtures/image.svg','media-fixtures/image.jpg','media-fixtures/image.png\0','media-fixtures/image.png?x'])
    await assert.rejects(loadWorkspaceImage(root,value,{width:320,height:240}),error=>error.code==='INVALID_IMAGE_PATH'&&!error.message.includes(root));
  await assert.rejects(loadWorkspaceImage('relative','media-fixtures/image.png',{width:320,height:240}),{code:'INVALID_IMAGE_PATH'});
});
test('all fixture file symlinks are rejected, including links within the allowed directory',async t=>{
  const root=await workspace(t);
  await fs.writeFile(path.join(root,'private.png'),png());
  await fs.symlink('image.png',path.join(root,'media-fixtures/inside.png'));
  await fs.symlink('../private.png',path.join(root,'media-fixtures/outside.png'));
  for(const filename of ['inside','outside'])await assert.rejects(loadWorkspaceImage(root,`media-fixtures/${filename}.png`,{width:1,height:1}),{code:'IMAGE_READ_FAILED'});
});
test('fixture directory and selected root symlinks are rejected',async t=>{
  const root=await workspace(t);
  await fs.rename(path.join(root,'media-fixtures'),path.join(root,'actual'));
  await fs.symlink('actual',path.join(root,'media-fixtures'));
  await assert.rejects(loadWorkspaceImage(root,'media-fixtures/image.png',{width:1,height:1}),{code:'IMAGE_READ_FAILED'});
  await fs.symlink(root,path.join(root,'root-link'));
  await assert.rejects(loadWorkspaceImage(path.join(root,'root-link'),'media-fixtures/image.png',{width:1,height:1}),{code:'IMAGE_READ_FAILED'});
});
test('missing/nonregular/oversize fixtures return bounded generic errors without paths',async t=>{
  const root=await workspace(t);
  await fs.mkdir(path.join(root,'media-fixtures/directory.png'));
  await fs.writeFile(path.join(root,'media-fixtures/large.png'),Buffer.alloc(2*1024*1024+1));
  for(const name of ['missing','directory','large'])await assert.rejects(loadWorkspaceImage(root,`media-fixtures/${name}.png`,{width:1,height:1}),error=>error.code==='IMAGE_READ_FAILED'&&!error.message.includes(root));
});
