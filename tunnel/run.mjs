import {createServer as createHttpServer, request} from 'node:http';
import {connect} from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {accessSync, constants, writeFileSync, appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const protectedMode = process.argv[2] === 'protected';
const root = fileURLToPath(new URL('../', import.meta.url));
let vite, gatewayServer, child;
let stopping = false;
let publicUrl;
function showUrl() {
  console.log('\n' + '='.repeat(76));
  console.log(publicUrl ? `  🌐 公開網址：${publicUrl}` : '  公開網址尚在建立中，請稍候…');
  console.log(`  模式：${protectedMode ? '需要帳號密碼' : '無密碼'}`);
  console.log('  隨時按 Enter 再次顯示網址；Ctrl+C 停止。');
  console.log(`  網址檔案：${root}tunnel/url.txt`);
  console.log('='.repeat(76) + '\n');
}
if (process.stdin.isTTY) {
  createInterface({input: process.stdin}).on('line', showUrl);
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('\n停止 tunnel 與本次啟動的專案…');
  const force = setTimeout(() => {
    child?.kill('SIGKILL');
    process.exit(code);
  }, 5000);
  force.unref();
  const childExit = child && child.exitCode === null && child.signalCode === null
    ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
  child?.kill('SIGTERM');
  gatewayServer?.closeAllConnections();
  await Promise.allSettled([
    vite?.close(),
    gatewayServer ? new Promise(resolve => gatewayServer.close(resolve)) : Promise.resolve(),
    childExit,
  ]);
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

try {
  const binary = process.env.CLOUDFLARED_BIN || `${homedir()}/.local/bin/cloudflared`;
  accessSync(binary, constants.X_OK);
  const c = {username: process.env.TUNNEL_USERNAME, password: process.env.TUNNEL_PASSWORD};
  if (protectedMode && (!c.username || c.username.includes(':') || !c.password)) {
    throw new Error('請使用 start-with-password.sh，帳號不可含冒號，密碼不可空白。');
  }
  const expected = Buffer.from('Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64'));
  delete process.env.TUNNEL_USERNAME;
  delete process.env.TUNNEL_PASSWORD;
  function authorized(req) {
    const a = Buffer.from(req.headers.authorization || '');
    return a.length === expected.length && timingSafeEqual(a, expected);
  }
  vite = await createServer({root, configFile: `${root}vite.config.ts`, server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
  }});
  await vite.listen();
  vite.printUrls();
  if (protectedMode) {
const gateway=createHttpServer((req,res)=>{
 if(!authorized(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Travel Preview", charset="UTF-8"','Cache-Control':'no-store'});res.end('Authentication required');return}
 const headers={...req.headers,host:'localhost:5173'};delete headers.authorization;
 const upstream=request({hostname:'127.0.0.1',port:5173,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode,{...r.headers,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'SAMEORIGIN'});r.pipe(res)});
 upstream.on('error',()=>{res.writeHead(502);res.end('Upstream unavailable')});req.pipe(upstream);
});
gateway.on('upgrade',(req,socket,head)=>{
 if(!authorized(req)){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return}
 const upstream=connect(5173,'127.0.0.1',()=>{
 const headers={...req.headers,host:'localhost:5173'};delete headers.authorization;
 upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+Object.entries(headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
 });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
});

    gatewayServer = gateway;
    await new Promise((resolve, reject) => {
      gateway.once('error', reject);
      gateway.listen(15173, '127.0.0.1', resolve);
    });
    console.log('密碼保護入口：http://127.0.0.1:15173');
  }
  const port = protectedMode ? 15173 : 5173;
  console.log(protectedMode ? '模式：帳號密碼驗證' : '模式：無密碼，知道網址的人皆可存取');
  console.log('正在建立公開網址；隨時按 Enter 再次顯示網址；Ctrl+C 停止全部服務。');
  writeFileSync(`${root}tunnel/url.txt`, '建立中，尚未取得公開網址。\n', {mode: 0o600});
  writeFileSync(`${root}tunnel/cloudflared.log`, '', {mode: 0o600});
  child = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`,
    '--http-host-header', 'localhost:5173', '--no-autoupdate'], {stdio: ['ignore', 'pipe', 'pipe']});
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', chunk => {
      output.write(chunk);
      appendFileSync(`${root}tunnel/cloudflared.log`, chunk);
    });
    const lines = createInterface({input: stream});
    lines.on('line', line => {
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
      if (match && match[0] !== publicUrl) {
        publicUrl = match[0];
        writeFileSync(`${root}tunnel/url.txt`, publicUrl + '\n', {mode: 0o600});
        showUrl();
      }
      if (publicUrl && /Registered tunnel connection|precheck complete/.test(line)) showUrl();
    });
  }
  child.once('error', error => {console.error(error); void stop(1)});
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.log(`cloudflared 已結束（${signal || code}）`);
      void stop(code || (signal ? 1 : 0));
    }
  });
} catch (error) {
  console.error(error);
  await stop(1);
}
