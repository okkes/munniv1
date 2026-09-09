import test from 'node:test';
import assert from 'node:assert/strict';
import { zipBuild, zipEntry, zipNames } from '../modules/zip.mjs';

test('zip: an artifact-shaped archive round-trips, deflated and stored', () => {
  const b64 = 'MIIK'.repeat(60);
  for (const deflate of [true, false]) {
    const zip = zipBuild({ 'APPLE_DEV_CERT_P12.b64': b64, 'note.txt': 'hello' }, { deflate });
    assert.deepEqual(zipNames(zip), ['APPLE_DEV_CERT_P12.b64', 'note.txt']);
    assert.equal(zipEntry(zip, 'APPLE_DEV_CERT_P12.b64').toString('utf8'), b64);
    assert.equal(zipEntry(zip, 'note.txt').toString('utf8'), 'hello');
  }
});

test('zip: a missing entry names what IS there; garbage is refused', () => {
  const zip = zipBuild({ 'a.txt': 'x' });
  assert.throws(() => zipEntry(zip, 'b.txt'), /no entry named b\.txt \(entries: a\.txt\)/);
  assert.throws(() => zipEntry(Buffer.from('definitely not a zip file, just bytes'), 'a.txt'), /not a zip file/);
});
