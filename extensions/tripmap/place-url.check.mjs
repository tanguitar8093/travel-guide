import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaceUrl } from './place-url.js';

const valid = 'https://www.google.com/maps/place/Kaichu+Rd,+Uruma,+Okinawa,+%E6%97%A5%E6%9C%AC/@26.3316587,127.9254157,17z/data=!3m1!4b1!4m6!3m5!1sanything!8m2!3d26.3316539!4d127.927996!16s%2Fm%2F0j_5g8l';
test('extracts decoded name and pin rather than camera center, without Place ID', () => {
  assert.deepEqual(parsePlaceUrl(valid), {
    name: 'Kaichu Rd, Uruma, Okinawa, 日本',
    coordinate: { latitude: 26.3316539, longitude: 127.927996 }, sourceUrl: valid,
  });
  assert.ok(parsePlaceUrl('https://www.google.co.jp/maps/place/店名/data=!3d35.1!4d139.2'));
  assert.ok(parsePlaceUrl('https://maps.google.com/maps/place/Shop/data=!3d-35.1!4d-139.2'));
});
test('rejects searches, camera-only views, missing names, short URLs, and invalid coordinates', () => {
  for (const url of [
    'https://www.google.com/maps/search/restaurants/@26.2,127.6,15z/data=!3d26.2!4d127.6',
    'https://www.google.com/maps/place/Shop/@26.2,127.6,15z',
    'https://www.google.com/maps/@26.2,127.6,15z',
    'https://www.google.com/maps/place/26.2,127.6/data=!3d26.2!4d127.6',
    'https://www.google.com/maps/place/Shop/data=!3d99!4d127.6',
    'https://www.google.com/maps/place/Shop/data=!3d26.2!4d999',
    'https://www.google.com/maps/place/Shop/data=!3d26.2!4d127.6!3d27.2!4d128.6',
    'https://maps.app.goo.gl/example',
    valid.replace('www.google.com','www.google.com.evil.test'),
    valid.replace('https:', 'http:'),
    valid.replace('/place/', '/place/%ZZ'),
    'not a url',
  ]) assert.equal(parsePlaceUrl(url), null, url);
});
