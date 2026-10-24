// Assistir a uma live no site: vídeo por WebRTC (WHEP) do MediaMTX, com a permissão de leitura que o
// exilados-api entrega a membros ativos. Reconecta sozinho; avisa "A live terminou" quando ela acaba.
import { AO_VIVO } from './config.js';
import { estado, meuId, ouvir } from './estado.js';
import { criarJanelaLive } from './janela-live.js';
import { vigiarVideo } from './estabilidade.js';
import { api } from './supa.js';
import { botaoIcone, el, icone, limpar } from './ui.js';

const flutuantes = new Map();

function juntarCaminhos(conexao) {
  if (conexao.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const pronto = () => {
      if (conexao.iceGatheringState !== 'complete') return;
      conexao.removeEventListener('icegatheringstatechange', pronto);
      resolve();
    };
    conexao.addEventListener('icegatheringstatechange', pronto);
    setTimeout(resolve, 3000);
  });
}

export function fecharTodasLives() {
  for (const a of [...flutuantes.values()]) fecharInstancia(a);
}

export const haLivesAbertas = () => flutuantes.size > 0;

function fecharInstancia(a) {
  flutuantes.delete(a.usuario);
  a.janela?.destruir();
  a.encerrada = true;
  clearTimeout(a.timerRetentar);
  clearTimeout(a.timerQueda);
  clearInterval(a.timerContagem);
  clearInterval(a.timerVigia);
  a.pararOuvir.forEach((f) => f());
  fecharSessao(a);
  a.video.srcObject = null;
  a.wakeLock?.release?.().catch(() => {});
  if (document.fullscreenElement && a.palco.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
}

function fecharSessao(a) {
  if (a.sessao) {
    fetch(a.sessao, { method: 'DELETE', keepalive: true }).catch(() => {});
    a.sessao = null;
  }
  if (a.pc) {
    a.pc.ontrack = null;
    a.pc.onconnectionstatechange = null;
    a.pc.close();
    a.pc = null;
  }
}

function dizer(a, texto, { botao } = {}) {
  limpar(a.sobre, texto ? el('div', { text: texto }) : null, botao || null);
  a.sobre.hidden = !texto && !botao;
}

function retentar(a, texto, ms = 3000) {
  fecharSessao(a);
  if (a.encerrada) return;
  dizer(a, texto);
  clearTimeout(a.timerRetentar);
  a.timerRetentar = setTimeout(() => conectar(a), ms);
}

function terminou(a) {
  if (a.encerrada) return;
  a.encerrada = true;
  fecharSessao(a);
  clearInterval(a.timerContagem);
  clearInterval(a.timerVigia);
  a.video.srcObject = null;
  dizer(a, 'A live terminou.', { botao: el('button', {
    class: 'botao', text: 'Fechar', onclick: () => fecharInstancia(a),
  }) });
  a.assistindo.textContent = '';
}

async function pedirPermissao(a) {
  try {
    const dados = await api.chamar('/live/assistir', { usuario: a.usuario });
    const novoCaminho = a.caminho && a.caminho !== dados.caminho;
    a.caminho = dados.caminho;
    a.token = dados.token;
    if (dados.assistindo >= 0) a.assistindo.textContent = String(dados.assistindo);
    if (novoCaminho && a.pc) {
      retentar(a, 'A nova live está começando...', 300);
      return false;
    }
    return true;
  } catch (erro) {
    // Uma checagem periódica pode falhar enquanto o vídeo já toca: preserve a sessão.
    if (a.pc?.connectionState === 'connected' && erro.status !== 401 && erro.status !== 403) return false;
    if (erro.status === 404) {
      if (!estado.lives.has(a.usuario)) terminou(a);
      else retentar(a, 'A transmissão foi interrompida. Aguardando voltar...', 4000);
    }
    else if (erro.status === 403 || erro.status === 401) {
      a.encerrada = true;
      dizer(a, erro.message);
    } else retentar(a, 'Sem conexão com o servidor. Tentando de novo...', 4000);
    return false;
  }
}

async function conectar(a) {
  if (a.encerrada) return;
  fecharSessao(a);
  if (!(await pedirPermissao(a)) || a.encerrada) return;
  const conexao = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  a.pc = conexao;
  conexao.addTransceiver('video', { direction: 'recvonly' });
  conexao.addTransceiver('audio', { direction: 'recvonly' });
  const fluxo = new MediaStream();
  conexao.ontrack = (e) => {
    fluxo.addTrack(e.track);
    if (a.video.srcObject !== fluxo) a.video.srcObject = fluxo;
    if (a.propria) a.video.muted = true;
    a.video.play().catch(() => {
      // O navegador não deixou tocar com som: começa mudo e oferece o som.
      a.video.muted = true;
      atualizarSom(a);
      a.video.play().catch(() => {});
    });
  };
  conexao.onconnectionstatechange = () => {
    if (a.pc !== conexao) return;
    const situacao = conexao.connectionState;
    if (situacao === 'connected') clearTimeout(a.timerQueda);
    else if (situacao === 'failed') retentar(a, 'Reconectando...', 1500);
    else if (situacao === 'disconnected') {
      clearTimeout(a.timerQueda);
      a.timerQueda = setTimeout(() => {
        if (a.pc === conexao && conexao.connectionState !== 'connected') retentar(a, 'Reconectando...', 300);
      }, 5000);
    }
  };
  try {
    await conexao.setLocalDescription(await conexao.createOffer());
    await juntarCaminhos(conexao);
  } catch {
    a.encerrada = true;
    dizer(a, 'Este navegador não consegue tocar a live. Tente o Chrome, o Safari ou o Firefox atualizados.');
    return;
  }
  const endereco = `${location.origin}${AO_VIVO}/${a.caminho}/whep`;
  let resposta;
  try {
    resposta = await fetch(endereco, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${a.token}` },
      body: conexao.localDescription.sdp,
    });
  } catch {
    retentar(a, 'Sem conexão com o servidor. Tentando de novo...', 4000);
    return;
  }
  if (a.pc !== conexao) return;
  if (resposta.status === 404) return retentar(a, 'A live está começando ou voltando. A imagem aparece aqui sozinha.', 3000);
  if (resposta.status === 401 || resposta.status === 403) return retentar(a, 'Reconectando à transmissão...', 3000);
  if (!resposta.ok) return retentar(a, `O servidor respondeu com erro (${resposta.status}). Tentando de novo...`, 4000);
  const sessao = resposta.headers.get('Location');
  a.sessao = sessao ? new URL(sessao, endereco).href : null;
  try {
    await conexao.setRemoteDescription({ type: 'answer', sdp: await resposta.text() });
  } catch {
    retentar(a, 'Reconectando...', 3000);
  }
}

function atualizarSom(a) {
  const mudo = a.video.muted || a.video.volume === 0;
  limpar(a.botaoSom, icone(mudo ? 'semSom' : 'som'));
  a.botaoSom.title = mudo ? 'Ativar o som' : 'Silenciar';
  a.faixaVolume.value = a.video.muted ? 0 : Math.round(a.video.volume * 100);
}

function telaCheia(a) {
  const doc = a.palco.ownerDocument; // a janela separada é outro documento
  if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
  else if (a.palco.requestFullscreen) a.palco.requestFullscreen().catch(() => a.video.webkitEnterFullscreen?.());
  else a.video.webkitEnterFullscreen?.();
}

/** Abre a live numa janela independente; reabrir traz a existente para frente. */
export function montarLive(_corpo, usuario) {
  const existente = flutuantes.get(usuario);
  if (existente?.encerrada) fecharInstancia(existente);
  else if (existente) {
    existente.janela.focar();
    return;
  }
  // A própria live toca sem som: o programa capta o som do computador, e o som dela voltaria para a live (retorno).
  const propria = usuario === meuId();
  const video = el('video', { autoplay: true, playsInline: true, muted: propria, attrs: { playsinline: true } });
  const sobre = el('div', { class: 'sobre' });
  const assistindo = el('span');
  const faixaVolume = el('input', { type: 'range', min: 0, max: 100, value: 100, attrs: { 'aria-label': 'Volume da live' } });
  const a = {
    usuario, propria, video, sobre, assistindo, faixaVolume,
    pararOuvir: [], encerrada: false, pc: null, sessao: null,
  };
  a.botaoSom = botaoIcone('som', 'Silenciar', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
    video.play().catch(() => {});
    atualizarSom(a);
  });
  faixaVolume.addEventListener('input', () => {
    video.volume = Number(faixaVolume.value) / 100;
    video.muted = video.volume === 0;
    atualizarSom(a);
  });
  const botaoTela = botaoIcone('telaCheia', 'Tela cheia', () => telaCheia(a));
  const barra = el('div', { class: 'barra' },
    propria ? el('span', { class: 'rotulo', text: 'Sua live, sem som aqui para não dar retorno' }) : [a.botaoSom, faixaVolume],
    el('span', { class: 'assistindo', attrs: { title: 'Assistindo agora' } }, icone('olho'), assistindo),
    botaoTela);
  a.palco = el('div', { class: 'live' }, video, sobre, barra);
  video.addEventListener('playing', () => dizer(a, ''));
  video.addEventListener('dblclick', () => telaCheia(a));
  flutuantes.set(usuario, a);
  a.janela = criarJanelaLive({
    titulo: `Live de ${estado.membros.get(usuario)?.nome || 'Alguém'}`,
    conteudo: a.palco, aoFechar: () => fecharInstancia(a),
  });
  dizer(a, 'Conectando à live...');

  navigator.wakeLock?.request('screen').then((trava) => {
    if (a.encerrada) trava.release().catch(() => {});
    else a.wakeLock = trava;
  }).catch(() => {});
  a.pararOuvir.push(ouvir('lives', () => {
    if (!estado.lives.has(usuario)) terminou(a);
  }));
  const tela = () => limpar(botaoTela, icone(document.fullscreenElement === a.palco ? 'sairTelaCheia' : 'telaCheia'));
  document.addEventListener('fullscreenchange', tela);
  a.pararOuvir.push(() => document.removeEventListener('fullscreenchange', tela));
  const visivel = () => {
    if (!document.hidden && !a.encerrada && (!a.pc || a.pc.connectionState !== 'connected')) conectar(a);
  };
  document.addEventListener('visibilitychange', visivel);
  a.pararOuvir.push(() => document.removeEventListener('visibilitychange', visivel));
  const sair = () => fecharSessao(a);
  window.addEventListener('pagehide', sair);
  a.pararOuvir.push(() => window.removeEventListener('pagehide', sair));

  // "N assistindo" a cada 15 s (a mesma chamada renova a permissão para a próxima reconexão).
  a.timerContagem = setInterval(() => { if (!a.encerrada) pedirPermissao(a); }, 15000);
  // Só reabre uma sessão se o vídeo ficar parado de fato, sem contar abas suspensas.
  let vigia = null;
  a.timerVigia = setInterval(() => {
    if (a.encerrada) return;
    const ativo = !document.hidden && a.pc?.connectionState === 'connected' && !video.paused;
    vigia = vigiarVideo(vigia, { tempo: video.currentTime, agora: performance.now(), ativo });
    if (vigia.reconectar) {
      vigia = null;
      retentar(a, 'A imagem parou. Reconectando...', 300);
    }
  }, 2000);

  atualizarSom(a);
  conectar(a);
}
