// Assistir às telas que as pessoas compartilham numa sala de voz (como no Discord): uma ou várias lado a lado. O vídeo
// e o som vêm pelo LiveKit só para quem abriu a transmissão; quem não está na sala entra nela para assistir. Quem
// compartilha vê a própria tela. Com várias abertas, cada uma vem em 720p e a que estiver em tela cheia, na máxima
// (voz.js), para não pesar na internet de quem transmite nem na de quem assiste.
import { nomeDaSala } from './dados.js';
import { estado, meuId, nomeDe, ouvir } from './estado.js';
import { contarAssistindo } from './presenca.js';
import { botaoIcone, el, erro, icone, limpar } from './ui.js';
import * as voz from './voz.js';

// A vista aberta: { corpo, aoFechar, aoMudar, raiz, grade, sugestoes, quadros: Map(id → quadro), pararOuvir, ... }.
let vista = null;

/** As telas abertas na vista agora (na ordem em que foram abertas). */
export const telasAbertas = () => (vista ? [...vista.quadros.keys()] : []);

export function fecharTela() {
  if (!vista) return;
  const v = vista;
  vista = null;
  v.pararOuvir.forEach((f) => f());
  for (const q of v.quadros.values()) soltarVideo(q);
  v.wakeLock?.release?.().catch(() => {});
  if (document.fullscreenElement && v.raiz.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
  voz.pararDeAssistir();
}

function soltarVideo(q) {
  clearTimeout(q.timerImagem);
  q.timerImagem = null;
  if (q.faixa) q.faixa.detach(q.video);
  q.faixa = null;
  q.video.srcObject = null;
}

function dizer(q, texto, botao) {
  limpar(q.sobre, texto ? el('div', { text: texto }) : null, botao || null);
  q.sobre.hidden = !texto && !botao;
}

async function entrarEAssistir(q) {
  const salaDela = estado.presenca.get(q.id)?.voz;
  if (!salaDela || q.entrando) return;
  q.entrando = true;
  atualizar(q);
  try {
    await voz.entrar(salaDela);
  } catch (falha) {
    erro(falha);
  } finally {
    q.entrando = false;
  }
  atualizar(q);
}

/** Tira um quadro; sem nenhum, volta para a tela anterior. */
function fecharQuadro(id) {
  const q = vista?.quadros.get(id);
  if (!q) return;
  soltarVideo(q);
  q.elemento.remove();
  vista.quadros.delete(id);
  if (id !== meuId()) voz.pararDeAssistir(id);
  if (!vista.quadros.size) return vista.aoFechar();
  arrumar();
}

function telaCheia(q) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (q.elemento.requestFullscreen) q.elemento.requestFullscreen().catch(() => q.video.webkitEnterFullscreen?.());
  else q.video.webkitEnterFullscreen?.();
}

function atualizarSomDoQuadro(q, temSom) {
  q.botaoSom.hidden = !temSom || q.id === meuId();
  const mudo = voz.telaSilenciada(q.id);
  limpar(q.botaoSom, icone(mudo ? 'semSom' : 'som'));
  q.botaoSom.title = mudo ? 'Ativar o som desta tela' : 'Silenciar esta tela';
  q.botaoSom.setAttribute('aria-label', q.botaoSom.title);
}

function atualizar(q) {
  if (!vista || vista.quadros.get(q.id) !== q) return;
  const v = voz.voz;
  const p = estado.presenca.get(q.id);
  const propria = q.id === meuId();
  const fechar = el('button', { class: 'botao cinza', text: 'Fechar', onclick: () => fecharQuadro(q.id) });
  q.nome.textContent = propria ? 'Sua tela' : nomeDe(q.id);
  q.contagem.textContent = String(contarAssistindo(estado.presenca, q.id));
  q.botaoParar.hidden = !(propria && v.tela);
  q.rotulo.textContent = propria && v.tela
    ? `${voz.QUALIDADES[v.tela.qualidade]?.rotulo || ''}${v.tela.som ? '' : ' · sem áudio'}` : '';
  atualizarSomDoQuadro(q, false);

  // Quem assiste precisa estar na sala de voz de quem compartilha.
  const salaDela = propria ? v.sala : p?.voz;
  if (!propria && (v.situacao === 'desligada' || v.sala !== salaDela)) {
    soltarVideo(q);
    if (!p?.tela || !salaDela) return dizer(q, `${nomeDe(q.id)} não está compartilhando a tela agora.`, fechar);
    if (q.entrando) return dizer(q, `Entrando na sala ${nomeDaSala(salaDela)}...`);
    return dizer(q, `${nomeDe(q.id)} está compartilhando a tela na sala ${nomeDaSala(salaDela)}.`,
      el('button', {
        class: 'botao',
        text: v.sala ? 'Trocar de sala e assistir' : 'Entrar na sala e assistir',
        onclick: () => entrarEAssistir(q),
      }));
  }
  if (v.situacao !== 'conectada') {
    soltarVideo(q);
    if (v.situacao === 'desligada') return dizer(q, 'Você saiu da sala de voz, e a transmissão parou.', fechar);
    return dizer(q, v.situacao === 'reconectando' ? 'Reconectando...' : 'Conectando à sala de voz...');
  }
  if (!propria) voz.assistirTela(q.id);
  const t = voz.telaDe(q.id);
  if (!t) {
    soltarVideo(q);
    if (propria) {
      return dizer(q, 'Você não está compartilhando a tela.', el('button', {
        class: 'botao', text: 'Compartilhar a tela', onclick: () => voz.compartilharTelaComSom().catch(erro),
      }));
    }
    return p?.tela ? dizer(q, 'Conectando à transmissão...') : dizer(q, 'A transmissão terminou.', fechar);
  }
  atualizarSomDoQuadro(q, t.temSom);
  q.semSom.hidden = propria || t.temSom;
  if (!t.video) {
    soltarVideo(q);
    return dizer(q, 'Conectando à transmissão...');
  }
  if (q.faixa !== t.video) {
    soltarVideo(q);
    t.video.attach(q.video);
    q.faixa = t.video;
    q.video.muted = true; // o som da tela toca à parte (com o volume da transmissão)
    q.video.play().catch(() => {
      if (vista?.quadros.get(q.id) !== q || q.faixa !== t.video) return;
      q.reproducaoBloqueada = true;
      dizer(q, 'Toque para iniciar a imagem.', el('button', {
        class: 'botao', text: 'Ativar vídeo', onclick: () => {
          voz.iniciarVideo()?.then(() => q.video.play()).catch(erro);
        },
      }));
    });
    if (!propria) q.timerImagem = setTimeout(() => {
      if (vista?.quadros.get(q.id) !== q || q.faixa !== t.video || q.video.readyState >= 2) return;
      if (!q.tentativasImagem++) {
        dizer(q, 'A imagem demorou a chegar. Tentando novamente...');
        voz.reinscreverVideoDaTela(q.id);
      } else {
        dizer(q, 'A imagem não chegou. Feche e abra de novo, ou peça para quem transmite iniciar em 720p.', fechar);
      }
    }, 12000);
  }
  if (q.reproducaoBloqueada) return;
  if (q.video.readyState >= 2) dizer(q, '');
  else dizer(q, 'Carregando a imagem...');
}

function criarQuadro(id) {
  const video = el('video', { autoplay: true, playsInline: true, muted: true, attrs: { playsinline: true, muted: true } });
  const q = {
    id, video, sobre: el('div', { class: 'sobre' }), nome: el('span', { class: 'nome-tela' }), contagem: el('span'),
    rotulo: el('span', { class: 'rotulo' }), faixa: null, entrando: false, tentativasImagem: 0,
  };
  q.semSom = el('span', {
    class: 'rotulo', text: 'sem áudio', hidden: true,
    attrs: { title: 'Quem transmite precisa ativar “Compartilhar áudio do sistema” ao escolher a tela.' },
  });
  q.botaoSom = botaoIcone('som', 'Silenciar esta tela', () => {
    voz.silenciarTela(id, !voz.telaSilenciada(id));
    atualizarSomDoQuadro(q, true);
  });
  q.botaoParar = el('button', { class: 'botao vermelho pequeno', text: 'Parar de compartilhar', onclick: () => voz.pararTela().catch(erro) });
  q.botaoTela = botaoIcone('telaCheia', 'Tela cheia', () => telaCheia(q));
  const barra = el('div', { class: 'barra' },
    q.nome, q.rotulo, q.semSom, q.botaoSom,
    el('span', { class: 'assistindo', attrs: { title: 'Assistindo agora' } }, icone('olho'), q.contagem),
    q.botaoParar, q.botaoTela, botaoIcone('fechar', 'Fechar esta tela', () => fecharQuadro(id)));
  q.elemento = el('div', { class: 'live quadro-tela' }, video, q.sobre, barra);
  video.addEventListener('playing', () => {
    if (vista?.quadros.get(id) !== q || !q.faixa) return;
    clearTimeout(q.timerImagem);
    q.timerImagem = null;
    q.tentativasImagem = 0;
    q.reproducaoBloqueada = false;
    dizer(q, '');
  });
  video.addEventListener('dblclick', () => telaCheia(q));
  return q;
}

/** Reorganiza a grade, os atalhos para as outras telas da sala e o título lá em cima. */
function arrumar() {
  if (!vista) return;
  vista.grade.dataset.n = String(Math.min(vista.quadros.size, 6));
  const v = voz.voz;
  const outras = [];
  if (v.sala) {
    for (const [id, p] of estado.presenca) {
      if (id !== meuId() && p.tela && p.voz === v.sala && !vista.quadros.has(id)) outras.push(id);
    }
    if (v.tela && !vista.quadros.has(meuId())) outras.push(meuId());
  }
  limpar(vista.sugestoes, outras.length ? el('span', { class: 'rotulo', text: 'Também ao vivo:' }) : null,
    ...outras.map((id) => el('button', {
      class: 'botao pequeno cinza', text: `+ ${id === meuId() ? 'Sua tela' : nomeDe(id)}`,
      title: 'Assistir junto, lado a lado', onclick: () => adicionar(id),
    })));
  const volume = voz.volumeDaTela();
  limpar(vista.botaoSomGeral, icone(volume === 0 ? 'semSom' : 'som'));
  vista.faixaVolume.value = volume;
  for (const q of vista.quadros.values()) atualizar(q);
  vista.aoMudar?.(telasAbertas());
}

function adicionar(id) {
  if (!vista || vista.quadros.has(id)) return;
  const q = criarQuadro(id);
  vista.quadros.set(id, q);
  vista.grade.append(q.elemento);
  dizer(q, 'Conectando...');
  // Tela de quem está em outra sala (ou sem estar em nenhuma): entra na sala dela, como no Discord.
  const salaDela = estado.presenca.get(id)?.voz;
  if (id !== meuId() && salaDela && voz.voz.sala !== salaDela && estado.presenca.get(id)?.tela && vista.quadros.size === 1) {
    entrarEAssistir(q);
  }
  arrumar();
}

/**
 * Mostra em `corpo` a tela que `id` compartilha (ou a própria). Com a vista já aberta, a tela entra ao lado das
 * outras. `aoFechar` volta para a tela anterior; `aoMudar(ids)` avisa quais telas estão abertas (para o título).
 */
export function montarTela(corpo, id, aoFechar, aoMudar) {
  if (vista && vista.corpo === corpo && corpo.contains(vista.raiz)) {
    vista.aoFechar = aoFechar;
    vista.aoMudar = aoMudar;
    if (vista.quadros.has(id)) arrumar();
    else adicionar(id);
    return;
  }
  fecharTela();
  const faixaVolume = el('input', {
    type: 'range', min: 0, max: voz.VOLUME_MAXIMO, value: voz.volumeDaTela(), attrs: { 'aria-label': 'Volume das transmissões' },
  });
  const v = {
    corpo, aoFechar, aoMudar, quadros: new Map(), pararOuvir: [], volumeAntes: 100, faixaVolume,
    grade: el('div', { class: 'telas-grade' }), sugestoes: el('span', { class: 'sugestoes-tela' }),
  };
  v.botaoSomGeral = botaoIcone('som', 'Som das transmissões', () => {
    const volume = voz.volumeDaTela();
    if (volume > 0) v.volumeAntes = volume;
    voz.definirVolumeDaTela(volume > 0 ? 0 : v.volumeAntes || 100);
    arrumar();
  });
  faixaVolume.addEventListener('input', () => {
    voz.definirVolumeDaTela(Number(faixaVolume.value));
    limpar(v.botaoSomGeral, icone(Number(faixaVolume.value) === 0 ? 'semSom' : 'som'));
  });
  v.raiz = el('div', { class: 'telas' }, v.grade,
    el('div', { class: 'telas-rodape' }, el('span', { class: 'controles-som' }, v.botaoSomGeral, faixaVolume), v.sugestoes));
  limpar(corpo, v.raiz);
  vista = v;

  navigator.wakeLock?.request('screen').then((trava) => { v.wakeLock = trava; }).catch(() => {});
  for (const evento of ['telas', 'voz', 'presenca']) v.pararOuvir.push(ouvir(evento, () => arrumar()));
  // A tela em tela cheia vem na qualidade máxima; as outras continuam em 720p.
  const cheia = () => {
    if (vista !== v) return;
    let emDestaque = null;
    for (const q of v.quadros.values()) {
      const dela = document.fullscreenElement === q.elemento;
      limpar(q.botaoTela, icone(dela ? 'sairTelaCheia' : 'telaCheia'));
      if (dela) emDestaque = q.id;
    }
    voz.destacarTela(emDestaque);
  };
  document.addEventListener('fullscreenchange', cheia);
  v.pararOuvir.push(() => document.removeEventListener('fullscreenchange', cheia));
  adicionar(id);
}
