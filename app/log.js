'use strict';
// Append-only log in <dados>/junto.log, rotated at 1 MB. Never receives tokens or codes;
// as a safety net long opaque strings and code/token/verifier params are masked.
const fs = require('node:fs');
const path = require('node:path');

function limpar(texto) {
  return String(texto)
    .replace(/\b(code|token|verifier|state|authorization|bearer)([=:\s"']+)[A-Za-z0-9._~+/-]{8,}/gi, '$1$2[oculto]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[oculto]');
}

function criarLog({ dir, maxBytes = 1024 * 1024 } = {}) {
  const arquivo = dir ? path.join(dir, 'junto.log') : null;
  let pronto = false;

  function escrever(nivel, ...partes) {
    if (!arquivo) return;
    try {
      if (!pronto) { fs.mkdirSync(dir, { recursive: true }); pronto = true; }
      try {
        if (fs.statSync(arquivo).size >= maxBytes) {
          fs.renameSync(arquivo, arquivo + '.1'); // replaces the previous rotation
        }
      } catch { /* no file yet */ }
      const msg = partes.map((p) => (p instanceof Error ? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
      fs.appendFileSync(arquivo, `${new Date().toISOString()} ${nivel} ${limpar(msg)}\n`);
    } catch { /* logging must never break the app */ }
  }

  const log = (...a) => escrever('info', ...a);
  log.erro = (...a) => escrever('erro', ...a);
  log.arquivo = arquivo;
  return log;
}

module.exports = { criarLog, limpar };
