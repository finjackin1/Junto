// GERADO de ESCOLHIDA/proposta-B.html; nao editar aqui
const {ic,av,eq,achar,AMIGOS,S,dica,hms,podeControlar}=M;
function card(a){return `<button class="card arte a${a.arte}" data-lista data-act="conectar:${a.id}" data-menu="${a.id}" ${dica('Conectar em '+a.nome,'Botão direito: mais opções')}>
  <span class="veu"></span>
  <span class="cima"><span class="selo fg">${ic(a.tipo==='ver'?'tela':'fones',14)}${M.tipoNome(a.tipo)}</span>${a.gente.length?`<span class="selo fg">${ic('pessoas',14)}${a.gente.length+1}</span>`:''}</span>
  <span class="baixo"><span class="dono" style="margin-bottom:4px">${av(a,24,false)}${a.nome}<span style="color:#fff">${eq()}</span></span><span class="corta" style="display:block;font:600 16px/24px 'Segoe UI Variable Display','Segoe UI',sans-serif;padding-right:48px">${a.titulo}</span></span>
  <span class="pega">${ic('play',18)}</span></button>`}
function pess(a){return `<button class="pess" data-lista data-act="menu:${a.id}" data-menu="${a.id}" ${dica(a.nome,a.est==='on'?'Online, sem nada disponível':'Offline')}>${av(a,44)}<span class="corta" style="max-width:48px">${a.nome}</span></button>`}
function bar(){const a=achar(S.conn);return `<button class="flut-bar arte a${a.arte}" data-act="sessao" ${dica('Abrir sessão','Fila, controles e vídeo')}><span class="tinta"></span><span class="mini arte a${a.arte}" style="border-radius:10px"></span><span class="corta" style="flex:1"><span class="corta" style="display:block;font-weight:600">${a.titulo}</span><span class="corta" style="display:block;font-size:12px;line-height:16px;opacity:.8">com ${a.nome}</span></span>${eq(!S.tocando)}<span class="ibtn" style="color:#fff">${ic('cima')}</span></button>`}
M.iniciar({
 principal(s){
  const topo=`<div class="topo"><div class="tit" style="flex:1">Agora</div>${s.conn?`<button class="ibtn" data-act="camada:oferecer" ${dica("Disponibilizar","Escolha o que seus amigos podem ouvir ou ver")}>${ic("mais")}</button>`:""}<button class="ibtn" data-act="camada:amigos" ${dica('Adicionar amigos')}>${ic('add')}</button><button class="ibtn" data-act="camada:opcoes" ${dica('Opções')}>${ic('ajustes')}</button></div>`;
  const flut=(s.etapa1||!M.D.F.oferta)?`<button class="btn pri flut desl" data-act="noop" ${dica('Disponibilizar','Chega na próxima versão')}>${ic('mais',18)}Disponibilizar</button>`:`<button class="btn pri flut${s.oferecendo?' ativo':''}" data-act="${s.oferecendo?'parar-oferta':'camada:oferecer'}" ${s.oferecendo?dica('Parar de disponibilizar','Quem está conectado volta para a lista'):dica('Disponibilizar','Escolha o que seus amigos podem ouvir ou ver')}>${s.oferecendo?eq()+'Você está disponibilizando':ic('mais',18)+'Disponibilizar'}</button>`;
  const off=s.offline?`<div style="padding:0 16px 8px"><div class="faixa">${ic('aviso',18)}<span>Sem conexão com o Junto. Tentando de novo…</span></div></div>`:'';
  if(s.carregando)return `${topo}<div class="centro"><span class="gira" style="color:var(--t3)">${ic('gira',32)}</span></div>`;
  if(s.vazio)return `${topo}${off}<div class="centro entra"><span style="color:var(--t3)">${ic('pessoas',40)}</span><div class="tit">Ninguém por aqui ainda</div><div class="sub">Adicione um amigo pelo nome de usuário do Discord.</div><button class="btn pri" data-act="camada:amigos" ${dica('Adicionar amigos')}>${ic('add',18)}Adicionar amigos</button></div>${flut}`;
  const of=s.semOf?[]:AMIGOS.filter(a=>a.tipo),res=AMIGOS.filter(a=>s.semOf||!a.tipo);
  return `${topo}${off}<div class="rola entra" style="padding-bottom:88px"><div style="padding:0 16px">${of.length?of.map(card).join(''):`<div class="semof"><span style="color:var(--t3)">${ic('fones',32)}</span><div class="tit">Ninguém disponibilizando agora</div><div class="sub">Quando um amigo disponibilizar algo, aparece aqui.</div></div>`}</div>
   <div class="sec" style="padding-top:8px"><span>Sem nada agora</span><span>${res.length}</span></div><div class="tira">${res.map(pess).join('')}</div></div>${s.conn?bar():flut}`},
 sessao(s){const a=achar(s.conn),c=podeControlar();
  return `<div class="rola" style="display:flex;flex-direction:column"><div class="palco"><div class="luz arte a${a.arte}"></div><div class="veu"></div>
    <div class="topo2"><button class="ibtn" data-act="inicio" ${dica('Ver amigos','O som continua. Esc')}>${ic('baixo')}</button><span class="corta" style="flex:1;font-weight:600;text-align:center">Com ${a.nome}</span><button class="ibtn" data-act="desconectar" ${dica('Sair da sessão','Para de tocar no seu PC')}>${ic('sair')}</button></div>
    <div class="inf"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;--gente-b:transparent">${M.gente(a)}${M.seloModo(a)}</div><div class="tit" style="font-size:24px;line-height:32px;white-space:normal">${a.titulo}</div><div class="sub corta">${a.sub}</div></div></div>
   <div class="entra" style="flex:1;display:flex;flex-direction:column">
   <div style="padding:8px 16px 8px"><div class="barra-p"><i data-pos style="width:${s.pos/a.dur*100}%;background:var(--acento)"></i></div><div class="tempo"><span data-t1>${hms(s.pos)}</span><span>${hms(a.dur)}</span></div></div>
   <div class="ctlb"><button class="ibtn" ${c?'':'disabled'} data-act="voltar" ${dica('Voltar')}>${ic('ant')}</button><button class="grande" ${c?'':'disabled'} data-act="tocar" ${dica(s.tocando?'Pausar':'Tocar',c?'Espaço':'Só o dono controla')}>${ic(s.tocando?'pausa':'play',22)}</button><button class="ibtn" ${c?'':'disabled'} data-act="pular" ${dica('Próxima')}>${ic('prox')}</button><span style="flex:1"></span>
    ${a.tipo==='ver'?`<button class="btn" style="height:36px;padding:0 12px" data-act="ver-video" ${dica('Abrir vídeo','Abre em outra janela')}>${ic('tela',16)}Ver</button>`:`<span class="selo">${ic('fones',14)}Só som</span>`}
    <button class="ibtn" data-act="volume" data-vol ${dica(s.mudo?'Sem som':'Volume '+Math.round((s.vol??1)*100)+'%',s.mudo?'Clique para voltar o som':'Clique: tirar o som. Roda do mouse: ajustar')}>${ic(s.mudo?'mudo':'som')}</button></div>
   ${M.faixaEstado()?`<div style="padding:0 16px 8px">${M.faixaEstado()}</div>`:''}
   <div class="tabf"><b style="font-weight:600">Fila</b><span class="fra">${a.fila.length}</span></div>${M.linhasFila(a)}
   <div style="padding:12px 16px">${M.adicionar()}</div></div></div>`},
 agir(c){if(c==='ver-video')S.tela='video';if(c==='volume')S.mudo=!S.mudo},
 esc(s){s.tela='principal'}
});
