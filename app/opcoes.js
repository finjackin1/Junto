'use strict';
// Options in <dados>/opcoes.json. win (start with Windows) is only persisted here; applying it is stage 4.
const fs = require('node:fs');
const path = require('node:path');

const PADRAO = Object.freeze({ win: false, rap: true, min: false, av: true });

function sanear(obj, base) {
  const saida = { ...base };
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(PADRAO)) {
      if (typeof obj[k] === 'boolean') saida[k] = obj[k];
    }
  }
  return saida;
}

function criarOpcoes({ dir, log = () => {} }) {
  const arquivo = path.join(dir, 'opcoes.json');
  let atual = null;

  function ler() {
    if (atual) return { ...atual };
    let lido = null;
    try { lido = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') log('opcoes ilegiveis, usando padrao');
    }
    atual = sanear(lido, PADRAO);
    return { ...atual };
  }

  async function salvar(obj) {
    const novo = sanear(obj, ler());
    atual = novo;
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${arquivo}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(novo));
    await fs.promises.rename(tmp, arquivo);
    return { ...novo };
  }

  return { ler, salvar, arquivo };
}

module.exports = { criarOpcoes, PADRAO, sanear };
