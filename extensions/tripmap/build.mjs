import { build, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const directory = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
await writeFile(`${directory}place-url.js`, await readFile(`${root}shared/place-import/place-url.js`));
const env = loadEnv('development', root, 'VITE_');
const url = new URL(env.VITE_SUPABASE_URL);
const key = env.VITE_SUPABASE_ANON_KEY;
if (url.protocol !== 'https:' || !key) throw new Error('Missing public Supabase configuration');
if (key.startsWith('sb_secret_')) throw new Error('Secret keys must never be bundled');
if (key.split('.').length === 3) {
  const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
  if (role !== 'anon') throw new Error('Only a public anon key may be bundled');
}
await writeFile(`${directory}config.js`, `// Public browser configuration only.\nexport const supabaseUrl = ${JSON.stringify(url.origin)};\nexport const supabaseKey = ${JSON.stringify(key)};\n`);
const manifest = JSON.parse(await readFile(`${directory}manifest.json`, 'utf8'));
manifest.host_permissions = manifest.host_permissions.filter(value => !value.includes('supabase.co'));
manifest.host_permissions.push(`${url.origin}/*`);
await writeFile(`${directory}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await build({
  configFile: false, root, publicDir: false, logLevel: 'warn',
  build: {
    outDir: `${directory}vendor`, emptyOutDir: true, target: 'chrome120',
    lib: { entry: `${directory}auth.js`, formats: ['es'], fileName: () => 'auth.js' },
    sourcemap: false, minify: true,
  },
});
console.log('TripMap extension auth bundle built. No private environment variables included.');
