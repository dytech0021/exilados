// Exilados: início, navegação entre as telas, painéis do celular e avisos.
import {
  esquecerConvite, infoConvite, lerConviteDaUrl, telaAviso, telaConvite, telaLogin, telaNovaSenha, telaSemGrupo,
} from './auth.js';
import {
  abrirDM, aceitarAmizade, desenharAmigos, desenharListaDM, desenharTopoDM, iniciarAmigos, pedidosRecebidos, pedirAmizade,
} from './amigos.js';
import { BASE } from './config.js';
import { blocoComeco, conversaAberta, fecharConversa, montarConversa, quandoClicarNoAutor } from './chat.js';
import { abrirConfig, convidar } from './config-ui.js';
import { carregarTudo, conectar, nomeDaSala } from './dados.js';
import {
  agoraServidor, avisar, estado, meuId, nomeDe, ouvir,
} from './estado.js';
import { cartaoPerfil, desenharSalas, desenharTopoGrupo, iniciarGrupo } from './grupo.js';
import { fecharLive, fecharTodasLives, haLivesAbertas, montarLive } from './live.js';
import { liveNoAr } from './presenca.js';
import {
  atualizarPrograma, iniciarPrograma, noPrograma, quandoAtualizacao,
} from './programa.js';
import { conferir, sb } from './supa.js';
import { fecharTela, montarTela } from './tela.js';
import {
  avatar, aviso, botaoIcone, confirmar, el, icone, janela, limpar,
} from './ui.js';
import {
  avisoDeVideo, avisoDeVoz, ENDERECO_APK, noApp,
} from './android.js';
import { svgDoQr } from './qr.js';
import * as voz from './voz.js';

const $ = (id) => document.getElementById(id);
const partes = {
  lista: $('lateral-lista'),
  topoLateral: $('lateral-topo'),
  membros: $('membros'),
  painelVoz: $('painel-voz'),
  painelUsuario: $('painel-usuario'),
  topo: $('centro-topo'),
  centro: $('centro-corpo'),
};
const celular = () => window.matchMedia('(max-width: 760px)').matches;
const CHAVE_SALA = 'exilados-ultima-sala';
// Vistas de assistir (live do programa do Windows ou tela compartilhada na voz): "Voltar" leva para antes delas.
const assistindo = (tipo) => tipo === 'live' || tipo === 'tela';
let vistaAnterior = null;

// ---------- painéis (celular) e topo ----------

function painel(qual) {
  const app = $('app');
  const classe = `mostrar-${qual}`;
  const estava = app.classList.contains(classe);
  app.classList.remove('mostrar-esquerda', 'mostrar-membros');
  if (!estava) app.classList.add(classe);
}

function fecharPaineis() {
  $('app').classList.remove('mostrar-esquerda', 'mostrar-membros');
}

const botaoMenu = () => botaoIcone('menu', 'Salas e conversas', () => painel('esquerda'), 'botao-menu');
const botaoMembros = () => botaoIcone('pessoas', 'Membros', () => painel('membros'), 'botao-membros');

function gestos() {
  let inicio = null;
  const app = $('app');
  app.addEventListener('touchstart', (e) => {
    if (!celular() || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (e.target.closest('input[type="range"], .mensagens .imagem, video')) return;
    inicio = { x: t.clientX, y: t.clientY, quando: Date.now() };
  }, { passive: true });
  app.addEventListener('touchend', (e) => {
    if (!inicio) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - inicio.x;
    const dy = t.clientY - inicio.y;
    const rapido = Date.now() - inicio.quando < 600;
    inicio = null;
    if (!rapido || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const aberto = app.classList.contains('mostrar-esquerda') ? 'esquerda' : app.classList.contains('mostrar-membros') ? 'membros' : null;
    if (aberto === 'esquerda' && dx < 0) fecharPaineis();
    else if (aberto === 'membros' && dx > 0) fecharPaineis();
    else if (!aberto && dx > 0) painel('esquerda');
    else if (!aberto && dx < 0) painel('membros');
  }, { passive: true });
  $('cortina').addEventListener('click', fecharPaineis);
}

// ---------- navegação ----------

function atualizarTrilho() {
  $('trilho-dm').classList.toggle('ativo', estado.modo === 'dm');
  $('trilho-grupo').classList.toggle('ativo', estado.modo === 'grupo');
  const dmNaoLidas = [...estado.naoLidas].filter((id) => estado.conversas.has(id)).length + pedidosRecebidos().length;
  const grupoNaoLido = estado.salas.some((s) => estado.naoLidas.has(s.id));
  $('trilho-grupo').classList.toggle('nao-lido', grupoNaoLido && estado.modo !== 'grupo');
  const dm = $('trilho-dm');
  dm.querySelector('.selo')?.remove();
  if (dmNaoLidas) dm.append(el('span', { class: 'selo', text: String(dmNaoLidas) }));
  const total = dmNaoLidas + (grupoNaoLido ? 1 : 0);
  document.title = total ? `(${total}) Exilados` : 'Exilados';
}

function desenharLateral() {
  if (estado.modo === 'grupo') {
    desenharTopoGrupo(partes.topoLateral);
    desenharSalas(partes.lista);
  } else {
    desenharTopoDM(partes.topoLateral);
    desenharListaDM(partes.lista);
  }
  atualizarTrilho();
}

function mudarModo(modo) {
  estado.modo = modo;
  desenharLateral();
}

function salaDeTexto(id) {
  const textos = estado.salas.filter((s) => s.tipo === 'texto');
  return textos.find((s) => s.id === id) || textos[0] || null;
}

function desenharCentro() {
  const v = estado.vista;
  const topo = partes.topo;
  if (v.tipo === 'live') {
    const m = estado.membros.get(v.id) || { user_id: v.id, nome: 'Alguém' };
    limpar(topo, botaoMenu(),
      el('div', { class: 'titulo' }, avatar(m, { tamanho: 24 }), el('span', { text: m.nome }), el('span', { class: 'ao-vivo', text: 'Ao vivo' })),
      botaoMembros(), botaoIcone('fechar', 'Fechar a live', voltar));
    montarLive(partes.centro, v.id, voltar, () => irPara({ tipo: 'live', id: v.id }));
    return;
  }
  if (v.tipo === 'tela') {
    const m = estado.membros.get(v.id) || { user_id: v.id, nome: 'Alguém' };
    const salaVoz = estado.presenca.get(v.id)?.voz;
    limpar(topo, botaoMenu(),
      el('div', { class: 'titulo' }, avatar(m, { tamanho: 24 }), el('span', { text: v.id === meuId() ? 'Sua tela' : m.nome }),
        el('span', { class: 'ao-vivo', text: 'Ao vivo' }), salaVoz ? el('span', { class: 'sub', text: nomeDaSala(salaVoz) }) : null),
      botaoMembros(), botaoIcone('fechar', 'Fechar a transmissão', voltar));
    montarTela(partes.centro, v.id, voltar);
    return;
  }
  if (v.tipo === 'amigos') {
    desenharAmigos(partes.centro, topo);
    return;
  }
  if (v.tipo === 'conversa') {
    const c = estado.conversas.get(v.id);
    const outro = v.outro || (c && (c.a === meuId() ? c.b : c.a));
    const m = estado.membros.get(outro) || { user_id: outro, nome: 'Alguém' };
    limpar(topo, botaoMenu(), el('div', { class: 'titulo' }, avatar(m, { tamanho: 24 }), el('span', { text: m.nome })), botaoMembros());
    montarConversa(partes.centro, {
      tipo: 'conversa',
      id: v.id,
      rotulo: `Conversar com @${m.nome}`,
      comeco: blocoComeco({ pessoa: m, titulo: m.nome, texto: `Este é o começo do seu histórico de mensagens diretas com ${m.nome}.` }),
    });
    return;
  }
  const sala = salaDeTexto(v.id);
  if (!sala) {
    limpar(topo, botaoMenu(), el('div', { class: 'titulo' }, el('span', { text: 'Exilados' })), botaoMembros());
    limpar(partes.centro, el('div', { class: 'mensagens' }, blocoComeco({ icone: 'hash', titulo: 'Nenhuma sala de texto', texto: 'O dono do grupo cria as salas em Configurações → Salas.' })));
    return;
  }
  v.id = sala.id;
  try { localStorage.setItem(CHAVE_SALA, sala.id); } catch { /* sem armazenamento */ }
  limpar(topo, botaoMenu(), el('div', { class: 'titulo' }, icone('hash'), el('span', { text: sala.nome })), botaoMembros());
  montarConversa(partes.centro, {
    tipo: 'sala',
    id: sala.id,
    rotulo: `Conversar em #${sala.nome}`,
    comeco: blocoComeco({ icone: 'hash', titulo: `Boas-vindas a #${sala.nome}!`, texto: `Este é o começo da sala #${sala.nome}.` }),
  });
}

function irPara(vista) {
  if (estado.vista.tipo === 'live' && vista.tipo !== 'live') fecharLive();
  if (estado.vista.tipo === 'tela' && vista.tipo !== 'tela') fecharTela();
  if (assistindo(vista.tipo) && !assistindo(estado.vista.tipo)) vistaAnterior = { ...estado.vista };
  fecharConversa();
  estado.vista = { ...vista };
  if (vista.tipo === 'grupo') estado.modo = 'grupo';
  if (vista.tipo === 'amigos' || vista.tipo === 'conversa') estado.modo = 'dm';
  if (vista.id) estado.naoLidas.delete(vista.id);
  desenharLateral();
  desenharCentro();
  avisar('vista');
  if (celular()) fecharPaineis();
}

function voltar() {
  irPara(vistaAnterior && !assistindo(vistaAnterior.tipo) ? vistaAnterior : { tipo: 'grupo', id: null });
}

const nav = {
  irPara,
  abrirConfig,
  convidar,
  abrirDM,
  pedirAmizade,
  aceitarAmizade,
  botaoMenu,
};

// ---------- avisos do que acontece ----------

function acompanhar() {
  ouvir('mensagem', (m) => {
    if (m.autor === meuId()) return;
    const alvo = m.sala_id || m.conversa_id;
    const aberta = conversaAberta();
    if (aberta?.id === alvo && !document.hidden) return;
    estado.naoLidas.add(alvo);
    avisar('naoLidas');
    atualizarTrilho();
    if (m.conversa_id && aberta?.id !== alvo) {
      const resumo = m.texto ? (m.texto.length > 60 ? `${m.texto.slice(0, 60)}…` : m.texto) : 'mandou uma imagem';
      aviso(`${nomeDe(m.autor)}: ${resumo}`, { acao: { rotulo: 'Abrir', fn: () => irPara({ tipo: 'conversa', id: m.conversa_id }) } });
    }
  });
  document.addEventListener('visibilitychange', () => {
    const aberta = conversaAberta();
    if (!document.hidden && aberta && estado.naoLidas.delete(aberta.id)) {
      avisar('naoLidas');
      atualizarTrilho();
    }
  });
  ouvir('amizades', atualizarTrilho);
  ouvir('liveComecou', (live) => {
    if (!liveNoAr(live, agoraServidor())) return;
    aviso(`${nomeDe(live.user_id)} entrou ao vivo`, {
      tipo: 'vivo',
      duracao: 12000,
      acao: { rotulo: 'Assistir', fn: () => irPara({ tipo: 'live', id: live.user_id }) },
    });
  });
  ouvir('telaComecou', (id) => {
    const salaVoz = estado.presenca.get(id)?.voz;
    if (!salaVoz || (estado.vista.tipo === 'tela' && estado.vista.id === id)) return;
    aviso(`${nomeDe(id)} está compartilhando a tela na ${nomeDaSala(salaVoz)}`, {
      tipo: 'vivo',
      duracao: 12000,
      acao: { rotulo: 'Assistir', fn: () => irPara({ tipo: 'tela', id }) },
    });
  });
  ouvir('salas', () => {
    if (estado.vista.tipo !== 'grupo') return;
    const sala = estado.salas.find((s) => s.id === estado.vista.id);
    if (!sala) irPara({ tipo: 'grupo', id: null });
    else limpar(partes.topo, botaoMenu(), el('div', { class: 'titulo' }, icone('hash'), el('span', { text: sala.nome })), botaoMembros());
  });
  ouvir('removido', async () => {
    await voz.sair().catch(() => {});
    fecharTodasLives();
    fecharTela();
    telaAviso('Você não faz mais parte do Exilados', 'Sua entrada no grupo foi desfeita pelo dono. Só ele pode te readmitir.', estado.eu);
  });
  let faixa = null;
  ouvir('conexao', (conectado) => {
    faixa?.remove();
    faixa = null;
    if (!conectado) {
      faixa = el('div', { class: 'sem-conexao', text: 'Sem conexão. Reconectando...' });
      document.querySelector('.centro').append(faixa);
    }
  });
}

// ---------- início ----------

async function abrirApp() {
  $('carregando-texto').textContent = 'Carregando o grupo...';
  await carregarTudo();
  voz.preferencias();
  $('entrada').hidden = true;
  $('carregando').hidden = true;
  $('app').hidden = false;
  limpar($('ir-dm'), icone('balao'));
  $('ir-dm').addEventListener('click', () => {
    if (estado.modo === 'dm') return;
    irPara(vistaAnterior?.tipo === 'conversa' ? vistaAnterior : { tipo: 'amigos' });
  });
  $('ir-grupo').addEventListener('click', () => irPara({ tipo: 'grupo', id: estado.vista.tipo === 'grupo' ? estado.vista.id : lembrada() }));
  botaoBaixar();
  iniciarGrupo(nav, partes);
  iniciarAmigos(nav, partes);
  quandoClicarNoAutor((id, x, y) => cartaoPerfil(id, x, y));
  // No app do celular: na sala de voz, o app mantém a voz com a tela apagada (notificação "Na sala de voz").
  const avisarApp = avisoDeVoz(window.ExiladosAndroid);
  ouvir('voz', () => avisarApp(voz.voz.situacao !== 'desligada', voz.voz.sala ? nomeDaSala(voz.voz.sala) : ''));
  // Com live ou tela compartilhada na tela, o app vira janela flutuante ao sair dele; nela, só o vídeo aparece.
  const avisarVideo = avisoDeVideo(window.ExiladosAndroid);
  ouvir('vista', () => avisarVideo(estado.vista?.tipo));
  window.exiladosJanelaFlutuante = (ligada) => document.body.classList.toggle('modo-pip', Boolean(ligada));
  acompanhar();
  gestos();
  ouvir('vista', () => { if (estado.vista.tipo === 'conversa' || estado.vista.tipo === 'grupo') vistaAnterior = { ...estado.vista }; });
  irPara({ tipo: 'grupo', id: lembrada() });
  if (celular()) painel('esquerda');
  await conectar();
}

/** Numa sala de voz ou assistindo a algo: o programa não reinicia sem perguntar. */
const ocupado = () => voz.voz.situacao !== 'desligada' || assistindo(estado.vista?.tipo) || haLivesAbertas();

/**
 * Botão de baixar no trilho (como o "Baixar aplicativos" do Discord): o programa no navegador do Windows e o app no
 * navegador do Android. Dentro do programa, o mesmo lugar mostra a setinha verde de atualização pronta (como a do
 * Discord), e outro botão mostra o QR code para baixar o app no celular. Dentro do app, nada.
 */
function botaoBaixar() {
  if (noPrograma) {
    botaoCelular();
    return setinhaAtualizacao();
  }
  if (noApp) return;
  const android = /Android/i.test(navigator.userAgent);
  const windows = navigator.userAgentData?.platform === 'Windows' || /Windows NT/.test(navigator.userAgent);
  if (!windows && !android) return;
  $('trilho-baixar').hidden = false;
  $('trilho-baixar-separador').hidden = false;
  const botao = $('baixar-programa');
  const rotulo = android ? 'Baixar o app do Exilados para Android' : 'Baixar o Exilados para Windows';
  botao.href = android ? `${BASE}atualizacao/Exilados.apk` : `${BASE}atualizacao/Exilados.exe`;
  botao.setAttribute('download', android ? 'Exilados.apk' : 'Exilados.exe');
  botao.title = rotulo;
  botao.setAttribute('aria-label', rotulo);
  limpar(botao, icone('baixar'));
  botao.addEventListener('click', () => (android
    ? aviso('Baixando o app do Exilados. Abra o Exilados.apk e permita instalar (o Android pede uma vez); depois entre com a mesma conta daqui.', { duracao: 12000 })
    : aviso('Baixando o Exilados para Windows. Abra o Exilados.exe e entre com a mesma conta daqui.', {
      acao: { rotulo: 'Como usar', fn: () => abrirConfig('transmitir') },
      duracao: 10000,
    })));
}

/** Dentro do programa: QR code para baixar o app no celular (Android). */
function botaoCelular() {
  $('trilho-baixar-separador').hidden = false;
  $('trilho-celular').hidden = false;
  const botao = $('baixar-celular');
  limpar(botao, icone('celular'));
  botao.addEventListener('click', () => janela({
    titulo: 'Exilados no celular',
    conteudo: el('div', { class: 'qr-celular' },
      el('div', { class: 'qr' }, svgDoQr(ENDERECO_APK, 'QR code para baixar o app do Exilados')),
      el('p', { text: 'Aponte a câmera do celular Android para o código e abra o link: o app do Exilados começa a baixar. Abra o Exilados.apk, permita instalar (o Android pede uma vez) e entre com a mesma conta daqui.' }),
      el('p', { class: 'ajuda', text: 'No iPhone, use o site: filabox3d.com.br/exilados' })),
    botoes: [{ rotulo: 'Fechar' }],
  }));
}

function setinhaAtualizacao() {
  const botao = el('button', { class: 'trilho-botao baixar', id: 'atualizar-programa' }, icone('baixar'));
  $('baixar-programa').replaceWith(botao);
  let versao = null;
  botao.addEventListener('click', async () => {
    if (!versao) return;
    if (ocupado()) {
      const ok = await confirmar({
        titulo: 'Atualizar o Exilados',
        texto: `O programa reinicia na versão ${versao} em alguns segundos, e você sai da sala de voz (é só entrar de novo depois).`,
        botao: 'Reiniciar agora',
      });
      if (!ok) return;
    }
    atualizarPrograma();
  });
  quandoAtualizacao((nova) => {
    versao = nova;
    const rotulo = nova ? `Atualização pronta (versão ${nova}): clique para reiniciar` : '';
    botao.title = rotulo;
    botao.setAttribute('aria-label', rotulo);
    $('trilho-baixar').hidden = !nova;
  });
}

function lembrada() {
  try { return localStorage.getItem(CHAVE_SALA); } catch { return null; }
}

let decidindo = null;

/** Logado: entra no grupo, mostra o convite ou explica por que não dá. */
function decidir(usuario) {
  if (decidindo) return decidindo;
  decidindo = (async () => {
    estado.eu = { id: usuario.id, email: usuario.email };
    const membro = conferir(await sb.from('exilados_membros').select('user_id,ativo').eq('user_id', usuario.id).maybeSingle());
    if (membro?.ativo) {
      esquecerConvite();
      return abrirApp();
    }
    if (membro) return telaAviso('Você não faz mais parte do Exilados', 'Sua entrada no grupo foi desfeita pelo dono. Só ele pode te readmitir.', usuario);
    const codigo = lerConviteDaUrl();
    const info = await infoConvite(codigo);
    if (info?.valido) return telaConvite(info, usuario, async () => { decidindo = null; await decidir(usuario); });
    const entrouDepois = async () => { decidindo = null; await decidir(usuario); };
    if (codigo) {
      esquecerConvite();
      return telaSemGrupo(usuario, entrouDepois, 'Este convite não vale mais (eles valem por 7 dias). Peça um link novo ou mande o seu ID para alguém do grupo te adicionar.');
    }
    return telaSemGrupo(usuario, entrouDepois);
  })().catch((falha) => {
    decidindo = null;
    $('carregando-texto').textContent = `Não deu para abrir: ${falha.message} Tentando de novo...`;
    setTimeout(() => decidir(usuario), 5000);
  });
  return decidindo;
}

async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: BASE }).catch(() => {});
  // Um link de convite aberto com o site já aberto nesta aba só troca o "#": recomeça para ler o convite.
  window.addEventListener('hashchange', () => { if (/convite=/.test(location.hash)) location.reload(); });
  const codigo = lerConviteDaUrl();
  iniciarPrograma({
    sessao: async () => {
      const { data: { session: s } } = await sb.auth.getSession();
      return s ? { token: s.access_token, usuario: s.user.id, email: s.user.email || '', nome: estado.membros.get(s.user.id)?.nome || '' } : null;
    },
    ocupado,
  });
  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'PASSWORD_RECOVERY') setTimeout(telaNovaSenha);
    else if (evento === 'SIGNED_IN' && sessao && !estado.eu) setTimeout(() => decidir(sessao.user));
    else if (evento === 'SIGNED_OUT' && estado.eu) location.replace(BASE);
  });
  const { data: { session: sessao } } = await sb.auth.getSession();
  if (sessao) return decidir(sessao.user);
  telaLogin(await infoConvite(codigo));
}

iniciar().catch((falha) => {
  $('carregando-texto').textContent = `Não deu para abrir o Exilados: ${falha.message}`;
});
