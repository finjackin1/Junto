/* Peças da sessão usadas pelas 3 propostas: faixa de estado, fila, adicionar, pessoas. */
(function(){
const {ic,av,achar,MODOS,S,dica,hms,podeAdicionar,podeControlar}=M;
M.faixaEstado=function(){
  const f=S.faixa;
  if(f==='esperando')return `<div class="faixa esp"><span class="gira">${ic('gira',18)}</span><span style="flex:1">Esperando Caio carregar. Volta em até 5 s.</span></div>`;
  if(f==='erro-link')return `<div class="faixa erro">${ic('aviso',18)}<span style="flex:1">Sem permissão para abrir esse link, então ele foi pulado.</span></div>`;
  if(f==='perdeu')return `<div class="faixa erro"><span class="gira">${ic('gira',18)}</span><span style="flex:1">Conexão perdida com Marina. Tentando de novo…</span><button class="btn" style="height:32px" data-act="desconectar" ${dica('Sair da sessão')}>Sair</button></div>`;
  if(f==='enviando')return `<div class="faixa">${ic('arquivo',18)}<span style="flex:1">Recebendo “Making of da série”: 42%, faltam 3 min.</span><button class="ibtn" style="width:32px;height:32px" data-act="noop" ${dica('Cancelar envio')}>${ic('x',16)}</button></div>`;
  return '';
};
M.seloModo=function(a){const m=MODOS[a.modo];return `<span class="selo" ${dica(m[0],m[1])}>${ic(a.modo==='todos'?'pessoas':a.modo==='dono'?'cad':'coroa',14)}${m[0]}</span>`};
M.linhasFila=function(a,prefixo){
  return a.fila.map((f,i)=>`<div class="linha-fila${i===0?' atual':''}">
    <span class="mini arte a${f[3]}"></span>
    <span class="corta" style="flex:1"><span class="corta nomef" style="display:block;${i===0?'font-weight:600':''}">${f[0]}</span><span class="fra corta" style="display:flex;gap:4px;align-items:center;font-size:12px;line-height:16px">${f[4]==='arq'?ic('arquivo',12):ic('link',12)}<span class="corta">${f[1]}</span></span></span>
    <span class="fra" style="font:400 12px/16px Consolas,monospace">${f[2]}</span>
    ${podeControlar()&&i>0?`<button class="ibtn acao" style="width:28px;height:28px" data-act="noop" ${dica('Tirar da fila')}>${ic('x',14)}</button>`:''}
  </div>`).join('');
};
M.adicionar=function(){
  if(!podeAdicionar())return `<div class="faixa">${ic('cad',18)}<span>Só o dono adiciona nesta sessão.</span></div>`;
  return `<div style="display:flex;gap:8px"><input class="campo" placeholder="Cole um link ou escolha um arquivo" aria-label="Link ou arquivo para a fila"><button class="btn" style="width:40px;padding:0;flex:none" data-act="noop" ${dica('Enviar arquivo','Vai do seu PC para os outros')}>${ic('arquivo',20)}</button></div>`;
};
M.gente=function(a){const g=[a.id,...a.gente,'eu'];return '<span style="display:inline-flex;align-items:center">'+g.map((id,i)=>`<span style="margin-left:${i?-8:0}px;border-radius:50%;box-shadow:0 0 0 2px var(--gente-b,var(--fundo));display:inline-flex" ${dica(achar(id).nome+(id===a.id?' (dono)':''))}>${av(id,28,false)}</span>`).join('')+'</span>'};
})();
