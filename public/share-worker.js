// Share transport only. Ordinary app pages, auth and API responses are never cached.
const inboxName = 'tripmap-share-inbox-v1';
const lifetime = 24 * 60 * 60 * 1000;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/share/place' || event.request.method !== 'POST') return;
  event.respondWith(receive(event.request));
});
async function receive(request) {
  try {
    const form = await request.formData();
    const payload = { createdAt: Date.now() };
    for (const key of ['title', 'text', 'url']) {
      const value = form.get(key) ?? '';
      if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid share');
      payload[key] = value;
    }
    const cache = await caches.open(inboxName);
    const keys = await cache.keys();
    for (const [index, key] of keys.entries()) {
      const response = await cache.match(key);
      const old = await response?.json().catch(() => null);
      if (!old || Date.now() - old.createdAt > lifetime || index < keys.length - 29) await cache.delete(key);
    }
    const id = crypto.randomUUID();
    await cache.put(new URL(`/share/inbox/${id}`, self.location.origin), new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }));
    return Response.redirect(new URL(`/share/place?receipt=${id}`, self.location.origin), 303);
  } catch {
    return Response.redirect(new URL('/share/place?error=receive', self.location.origin), 303);
  }
}
