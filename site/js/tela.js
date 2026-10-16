// Assistir à tela que alguém compartilha numa sala de voz (como no Discord). O vídeo e o som vêm pelo LiveKit só
// para quem abriu a transmissão; quem não está na sala entra nela para assistir. Quem compartilha vê a própria tela.
import { nomeDaSala } from './dados.js';
import { estado, meuId, nomeDe, ouvir } from './estado.js';
import { contarAssistindo } from './presenca.js';
import { botaoIcone, el, erro, icone, limpar } from './ui.js';
import * as voz from './voz.js';

let atual = null;

export function fecharTela() {
  if (!atual) return;
  const a = atual;
  atual = null;
  a.pararOuvir.forEach((f) => f());
  soltarVideo(a);
  a.wakeLock?.release?.().catch(() => {});
  if (document.fullscreenElement && a.palco.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
  if (voz.voz.assistindo === a.id) voz.pararDeAssistir();
}

function soltarVideo(a) {
  if (a.faixa) a.faixa.detach(a.video);
  a.faixa = null;
  a.video.srcObject = null;
}

function dizer(a, texto, botao) {
  limpar(a.sobre, texto ? el('div', { text: texto }) : null, botao || null);
  a.sobre.hidden = !texto && !botao;
}

async function entrarEAssistir(a) {
  const salaDela = estado.presenca.get(a.id)?.voz;
  if (!salaDela || a.entrando) return;
  a.entrando = true;
  atualizar(a);
  try {
    await voz.entrar(salaDela);
  } catch (falha) {
    erro(falha);
  } finally {
    a.entrando = false;
  }
  atualizar(a);
}

function atualizarSom(a) {
  const volume = voz.volumeDaTela();
  limpar(a.botaoSom, icone(volume === 0 ? 'semSom' : 'som'));
  a.botaoSom.title = volume === 0 ? 'Ativar o som da transmissão' : 'Silenciar a transmissão';
  a.faixaVolume.value = volume;
}

function atualizar(a) {
  if (atual !== a) return;
  const v = voz.voz;
  const p = estado.presenca.get(a.id);
  const propria = a.id === meuId();
  const voltar = el('button', { class: 'botao cinza', text: 'Voltar', onclick: a.aoFechar });
  a.contagem.textContent = String(contarAssistindo(estado.presenca, a.id));
  a.controlesSom.hidden = true;
  a.semSom.hidden = true;
  a.botaoParar.hidden = !(propria && v.tela);
  a.rotulo.textContent = propria && v.tela
    ? `Sua tela · ${voz.QUALIDADES[v.tela.qualidade]?.rotulo || ''}${v.tela.som ? '' : ' · sem áudio'}` : '';

  // Quem assiste precisa estar na sala de voz de quem compartilha.
  const salaDela = propria ? v.sala : p?.voz;
  if (!propria && (v.situacao === 'desligada' || v.sala !== salaDela)) {
    soltarVideo(a);
    if (!p?.tela || !salaDela) return dizer(a, `${nomeDe(a.id)} não está compartilhando a tela agora.`, voltar);
    if (a.entrando) return dizer(a, `Entrando na sala ${nomeDaSala(salaDela)}...`);
    return dizer(a, `${nomeDe(a.id)} está compartilhando a tela na sala ${nomeDaSala(salaDela)}.`,
      el('button', {
        class: 'botao',
        text: v.sala ? 'Trocar de sala e assistir' : 'Entrar na sala e assistir',
        onclick: () => entrarEAssistir(a),
      }));
  }
  if (v.situacao !== 'conectada') {
    soltarVideo(a);
    if (v.situacao === 'desligada') return dizer(a, 'Você saiu da sala de voz, e a transmissão parou.', voltar);
    return dizer(a, v.situacao === 'reconectando' ? 'Reconectando...' : 'Conectando à sala de voz...');
  }
  if (!propria) voz.assistirTela(a.id);
  const t = voz.telaDe(a.id);
  if (!t) {
    soltarVideo(a);
    if (propria) {
      return dizer(a, 'Você não está compartilhando a tela.', el('button', {
        class: 'botao', text: 'Compartilhar a tela', onclick: () => voz.compartilharTela().catch(erro),
      }));
    }
    return p?.tela ? dizer(a, 'Conectando à transmissão...') : dizer(a, 'A transmissão terminou.', voltar);
  }
  a.controlesSom.hidden = !t.temSom;
  a.semSom.hidden = propria || t.temSom;
  if (!t.video) {
    soltarVideo(a);
    return dizer(a, 'Conectando à transmissão...');
  }
  if (a.faixa !== t.video) {
    soltarVideo(a);
    t.video.attach(a.video);
    a.faixa = t.video;
    a.video.muted = true; // o som da tela toca à parte (com o volume da transmissão)
    a.video.play().catch(() => {});
  }
  if (a.video.readyState >= 2) dizer(a, '');
  else dizer(a, 'Carregando a imagem...');
}

function telaCheia(a) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (a.palco.requestFullscreen) a.palco.requestFullscreen().catch(() => a.video.webkitEnterFullscreen?.());
  else a.video.webkitEnterFullscreen?.();
}

/** Mostra em `corpo` a tela que `id` compartilha (ou a própria). `aoFechar` volta para a tela anterior. */
export function montarTela(corpo, id, aoFechar) {
  fecharTela();
  const video = el('video', { autoplay: true, playsInline: true, muted: true, attrs: { playsinline: true, muted: true } });
  const sobre = el('div', { class: 'sobre' });
  const contagem = el('span');
  const faixaVolume = el('input', {
    type: 'range', min: 0, max: voz.VOLUME_MAXIMO, value: voz.volumeDaTela(), attrs: { 'aria-label': 'Volume da transmissão' },
  });
  const a = { id, video, sobre, contagem, faixaVolume, aoFechar, pararOuvir: [], faixa: null, entrando: false, volumeAntes: 100 };
  a.botaoSom = botaoIcone('som', 'Silenciar a transmissão', () => {
    const volume = voz.volumeDaTela();
    if (volume > 0) a.volumeAntes = volume;
    voz.definirVolumeDaTela(volume > 0 ? 0 : a.volumeAntes || 100);
    atualizarSom(a);
  });
  faixaVolume.addEventListener('input', () => {
    voz.definirVolumeDaTela(Number(faixaVolume.value));
    atualizarSom(a);
  });
  a.controlesSom = el('span', { class: 'controles-som' }, a.botaoSom, faixaVolume);
  a.semSom = el('span', {
    class: 'rotulo', text: 'Transmissão sem áudio',
    attrs: { title: 'Quem transmite precisa ativar “Compartilhar áudio do sistema” ao escolher a tela.' },
  });
  a.rotulo = el('span', { class: 'rotulo' });
  a.botaoParar = el('button', { class: 'botao vermelho pequeno', text: 'Parar de compartilhar', onclick: () => voz.pararTela().catch(erro) });
  const botaoTela = botaoIcone('telaCheia', 'Tela cheia', () => telaCheia(a));
  const barra = el('div', { class: 'barra' },
    a.controlesSom, a.semSom, a.rotulo,
    el('span', { class: 'assistindo', attrs: { title: 'Assistindo agora' } }, icone('olho'), contagem),
    a.botaoParar, botaoTela);
  a.palco = el('div', { class: 'live' }, video, sobre, barra);
  video.addEventListener('playing', () => { if (atual === a && a.faixa) dizer(a, ''); });
  video.addEventListener('dblclick', () => telaCheia(a));
  limpar(corpo, a.palco);
  atual = a;

  navigator.wakeLock?.request('screen').then((trava) => { a.wakeLock = trava; }).catch(() => {});
  for (const evento of ['telas', 'voz', 'presenca']) a.pararOuvir.push(ouvir(evento, () => atualizar(a)));
  const tela = () => limpar(botaoTela, icone(document.fullscreenElement ? 'sairTelaCheia' : 'telaCheia'));
  document.addEventListener('fullscreenchange', tela);
  a.pararOuvir.push(() => document.removeEventListener('fullscreenchange', tela));

  atualizarSom(a);
  // Clicou em "Ao vivo" de quem está em outra sala (ou sem estar em nenhuma): entra na sala dela, como no Discord.
  const salaDela = estado.presenca.get(id)?.voz;
  if (id !== meuId() && salaDela && voz.voz.sala !== salaDela && estado.presenca.get(id)?.tela) entrarEAssistir(a);
  else atualizar(a);
}
