import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImportPayload } from './payload.js';
const id = '11111111-1111-4111-8111-111111111111';
const place = { name: '  名稱  ', coordinate: { latitude: 26.2, longitude: 127.6 }, sourceUrl: 'https://www.google.com/maps/place/Example' };
test('only emits API-owned fields and requires no Place ID', () => {
  assert.deepEqual(createImportPayload({ ...place, userId: 'someone-else', token: 'not-in-body' }, id), {
    p_name: '名稱', p_latitude: 26.2, p_longitude: 127.6, p_operation_id: id, p_source_url: place.sourceUrl,
  });
});
test('rejects missing names, invalid coordinates, credentials in URLs and invalid operation IDs', () => {
  for (const candidate of [null, { ...place, name: '' }, { ...place, name: 'x'.repeat(301) },
    { ...place, coordinate: { latitude: Infinity, longitude: 127.6 } },
    { ...place, coordinate: { latitude: '26.2', longitude: 127.6 } },
    { ...place, sourceUrl: 'https://user:password@example.com/maps' }, { ...place, sourceUrl: 'javascript:alert(1)' }]) {
    assert.throws(() => createImportPayload(candidate, id));
  }
  assert.throws(() => createImportPayload(place, 'invalid'));
});
