'use strict';
// Session token storage: encrypted with Electron safeStorage (injected) at <dados>/sessao.bin.
// If encryption is unavailable the token lives in memory only. The token is never logged.
const fs = require('node:fs');
const path = require('node:path');

function criarSessao({ dir, safeStorage, log = () => {}, fetchFn = globalThis.fetch, servidor = () => '' }) {
  const arquivo = path.join(dir, 'sessao.bin');
  let token = null;

  function cifraOk() {
    try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
  }

  function carregar() {
    if (token) return token;
    if (!cifraOk()) return null;
    try {
      const bin = fs.readFileSync(arquivo);
      const t = safeStorage.decryptString(bin);
      token = t && typeof t === 'string' ? t : null;
    } catch (e) {
      if (e.code !== 'ENOENT') log('sessao: arquivo ilegivel, ignorado');
      token = null;
    }
    return token;
  }

  async function salvar(t) {
    token = t;
    if (!cifraOk()) { log('sessao: criptografia indisponivel, so em memoria'); return false; }
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${arquivo}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, safeStorage.encryptString(t));
      await fs.promises.rename(tmp, arquivo);
      return true;
    } catch (e) {
      log('sessao: nao gravou', e && e.code);
      return false;
    }
  }

  function apagar() {
    token = null;
    try { fs.rmSync(arquivo, { force: true }); } catch (e) { log('sessao: nao apagou', e && e.code); }
  }

  // Logout: tell the server (best effort, short timeout), then forget locally.
  async function sair() {
    const t = token;
    apagar();
    const base = String(servidor() || '').replace(/\/+$/, '');
    if (!t || !base) return;
    try {
      await fetchFn(`${base}/sair`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(5000) });
    } catch { log('sessao: /sair sem resposta'); }
  }

  return { carregar, salvar, apagar, sair, token: () => token, arquivo };
}

module.exports = { criarSessao };
