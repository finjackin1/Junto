// Auto-update end to end on a COPY of dist: fake release v9.9.9 (file:// JSON + local zip), real Junto.exe,
// expects: app downloads, quits, helper robocopies the new folder over the copy, relaunches. Usage: node testes\e2e-atualizacao.js
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync, spawn, execSync } = require('child_process');
const dist = path.resolve(__dirname, '..', 'dist', 'Junto-win32-x64');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'junto-e2e-atu-'));
const copia = path.join(base, 'JuntoCopia'), pacote = path.join(base, 'pacote', 'Junto'), dados = path.join(base, 'dados');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const espera = ms => new Promise(r => setTimeout(r, ms));
const procs = () => execSync('powershell -NoProfile -Command "Get-Process Junto -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"').toString().split(/\r?\n/).filter(Boolean);

(async () => {
  fs.cpSync(dist, copia, { recursive: true });
  fs.cpSync(dist, pacote, { recursive: true });
  fs.writeFileSync(path.join(pacote, 'MARCA-9.9.9.txt'), 'nova');
  const zip = path.join(base, 'Junto-9.9.9-windows.zip');
  execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', path.dirname(pacote), 'Junto']);
  const buf = fs.readFileSync(zip);
  const json = path.join(base, 'releases.json');
  fs.writeFileSync(json, JSON.stringify({ tag_name: 'v9.9.9', draft: false, assets: [{ name: 'Junto-9.9.9-windows.zip', browser_download_url: 'file:///' + zip.replace(/\\/g, '/'), size: buf.length, digest: 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex') }] }));
  fs.mkdirSync(dados);
  spawn(path.join(copia, 'Junto.exe'), [], { detached: true, stdio: 'ignore', env: { ...process.env, JUNTO_TESTE_ATUALIZACAO: json, JUNTO_DADOS: dados, JUNTO_OCULTO: '1' } }).unref();
  const fim = Date.now() + 120000; let marca = false, relancou = false;
  while (Date.now() < fim) {
    marca = fs.existsSync(path.join(copia, 'MARCA-9.9.9.txt'));
    if (marca) { await espera(4000); relancou = procs().some(p => p.toLowerCase().startsWith(copia.toLowerCase())); break; }
    await espera(1000);
  }
  console.log((marca ? 'ok   ' : 'FALHA ') + 'pasta da copia recebeu a versao nova');
  console.log((relancou ? 'ok   ' : 'FALHA ') + 'Junto reabriu sozinho depois de atualizar');
  try { execSync(`powershell -NoProfile -Command "Get-Process Junto -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${copia}*' } | Stop-Process -Force"`); } catch (e) { }
  console.log('pasta do teste: ' + base);
  process.exit(marca && relancou ? 0 : 1);
})();
