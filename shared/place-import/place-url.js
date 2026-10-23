const domains = ['google.com', 'google.com.tw', 'google.co.jp', 'google.co.uk'];

export function parsePlaceUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (!domains.some(domain => [domain, `www.${domain}`, `maps.${domain}`].includes(url.hostname))) return null;
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return null; }
  const place = path.match(/^\/maps\/place\/([^/]+)(?:\/|$)/);
  if (!place) return null;
  const name = place[1].replace(/\+/g, ' ').trim();
  if (!name || /^[\d\s.,+-]+$/.test(name)) return null;

  // @lat,lng is the camera center. Only use explicit place pin coordinates.
  const data = `${path}${url.search}`;
  const number = '(-?\\d+(?:\\.\\d+)?)';
  const matches = [...data.matchAll(new RegExp(`!3d${number}!4d${number}(?=!|[/?&#]|$)`, 'g'))];
  const coordinates = new Map();
  for (const match of matches) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    coordinates.set(`${latitude},${longitude}`, { latitude, longitude });
  }
  if (coordinates.size !== 1) return null;
  return { name, coordinate: [...coordinates.values()][0], sourceUrl: url.href };
}
