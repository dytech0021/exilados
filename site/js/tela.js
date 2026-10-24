// Assistir às telas que as pessoas compartilham numa sala de voz, cada uma na sua janela. O vídeo
// e o som vêm pelo LiveKit só para quem abriu a transmissão; quem não está na sala entra nela para assistir. Quem
// compartilha vê a própria tela. Com várias abertas, cada uma vem em 720p e a que estiver em tela cheia, na máxima
// (voz.js), para não pesar na internet de quem transmite nem na de quem assiste.
import { nomeDaSala } from './dados.js';
import { criarJanelaLive } from './janela-live.js';
import { estado, meuId, nomeDe, ouvir } from './estado.js';
import { contarAssistindo } from './presenca.js';
import { botaoIcone, el, erro, icone, limpar } from './ui.js';
import * as voz from './voz.js';

// As janelas abertas compartilham os ouvintes de voz e a trava da tela.
let vista = null;

/** As telas abertas na vista agora (na ordem em que foram abertas). */
export const telasAbertas = () => (vista ? [...vista.quadros.keys()] : []);

export function fecharTela() {
  if (!vista) return;
  const v = vista;
  vista = null;
  v.pararOuvir.forEach((f) => f());
  for (const q of v.quadros.values()) {
    soltarVideo(q);
    q.janela.destruir();
    if (document.fullscreenElement === q.elemento) document.exitFullscreen().catch(() => {});
  }
  v.wakeLock?.release?.().catch(() => {});
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

/** Fecha só esta transmissão e libera sua assinatura de vídeo. */
function fecharQuadro(id) {
  const q = vista?.quadros.get(id);
  if (!q) return;
  soltarVideo(q);
  q.janela.destruir();
  if (document.fullscreenElement === q.elemento) document.exitFullscreen().catch(() => {});
  vista.quadros.delete(id);
  if (id !== meuId()) voz.pararDeAssistir(id);
  if (!vista.quadros.size) return fecharTela();
  arrumar();
}

function telaCheia(q) {
  const doc = q.elemento.ownerDocument; // a janela separada é outro documento
  if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
  else if (q.elemento.requestFullscreen) q.elemento.requestFullscreen().catch(() => q.video.webkitEnterFullscreen?.());
  else q.video.webkitEnterFullscreen?.();
}

function atualizarSomDoQuadro(q, temSom) {
  q.botaoSom.hidden = !temSom || q.id === meuId();
  q.faixaVolume.hidden = q.botaoSom.hidden;
  q.faixaVolume.value = voz.volumeDaTela();
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
  q.janela?.definirTitulo(propria ? 'Sua tela' : `Tela de ${nomeDe(q.id)}`);
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
  q.faixaVolume = el('input', {
    type: 'range', min: 0, max: voz.VOLUME_MAXIMO, value: voz.volumeDaTela(),
    attrs: { 'aria-label': 'Volume de todas as telas', title: 'Volume de todas as telas' },
    oninput: () => {
      voz.definirVolumeDaTela(Number(q.faixaVolume.value));
      for (const quadro of vista?.quadros.values() || []) quadro.faixaVolume.value = voz.volumeDaTela();
    },
  });
  q.botaoParar = el('button', { class: 'botao vermelho pequeno', text: 'Parar de compartilhar', onclick: () => voz.pararTela().catch(erro) });
  q.botaoTela = botaoIcone('telaCheia', 'Tela cheia', () => telaCheia(q));
  const barra = el('div', { class: 'barra' },
    q.nome, q.rotulo, q.semSom, q.botaoSom, q.faixaVolume,
    el('span', { class: 'assistindo', attrs: { title: 'Assistindo agora' } }, icone('olho'), q.contagem),
    q.botaoParar, q.botaoTela);
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

function arrumar() {
  if (!vista) return;
  for (const q of vista.quadros.values()) atualizar(q);
}

function adicionar(id) {
  if (!vista) return;
  if (vista.quadros.has(id)) {
    vista.quadros.get(id).janela.focar();
    return;
  }
  const q = criarQuadro(id);
  vista.quadros.set(id, q);
  q.janela = criarJanelaLive({
    titulo: id === meuId() ? 'Sua tela' : `Tela de ${nomeDe(id)}`,
    conteudo: q.elemento, aoFechar: () => fecharQuadro(id),
  });
  dizer(q, 'Conectando...');
  // Tela de quem está em outra sala (ou sem estar em nenhuma): entra na sala dela, como no Discord.
  const salaDela = estado.presenca.get(id)?.voz;
  if (id !== meuId() && salaDela && voz.voz.sala !== salaDela && estado.presenca.get(id)?.tela && vista.quadros.size === 1) {
    entrarEAssistir(q);
  }
  arrumar();
}

/** Abre uma tela flutuante sem substituir a conversa que está aberta. */
export function montarTela(_corpo, id) {
  if (vista) {
    adicionar(id);
    return;
  }
  const v = { quadros: new Map(), pararOuvir: [] };
  vista = v;
  navigator.wakeLock?.request('screen').then((trava) => {
    if (vista !== v) trava.release().catch(() => {});
    else v.wakeLock = trava;
  }).catch(() => {});
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
