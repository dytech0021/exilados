// Celular -> conexão privada da conta -> PC -> câmera da chamada e/ou da live.
// O envio do celular nunca leva áudio e só começa por um clique explícito.
import { api } from './supa.js';
import { estado, meuId, nomeDe, ouvir, avisar } from './estado.js';
import { criarJanelaLive } from './janela-live.js';
import { el, limpar, erro } from './ui.js';
import { limitarWebcam } from './webcam-geometria.js';
import * as voz from './voz.js';

const webcam = { privada: null, local: null, recebida: null, live: null, publicacaoLive: null,
  naChamada: false, naLive: false, conectando: false, erro: '', geracao: 0, wake: null };
const quadros = new Map(), palcos = new Map(), ocultas = new Set(), livesRecebidas = new Map();
const celular = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const mudou = () => avisar('webcamEstado');
const faixaRecebida = () => webcam.recebida?.mediaStreamTrack;

async function conectar(papel, usuario, aoTrack, aoRemover) {
  const [LK, permissao] = await Promise.all([voz.carregarLiveKit(), api.chamar('/webcam/conectar', {
    papel, usuario, aparelho: crypto.randomUUID(),
  })]);
  const room = new LK.Room({ adaptiveStream: true, dynacast: true, singlePeerConnection: false,
    disconnectOnPageLeave: true });
  room.on(LK.RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'video') aoTrack?.(track); });
  room.on(LK.RoomEvent.TrackUnsubscribed, () => aoRemover?.());
  room.on(LK.RoomEvent.Disconnected, () => aoRemover?.());
  try { await room.connect(permissao.url, permissao.token); return { room, LK }; }
  catch (e) { await room.disconnect(); throw e; }
}

async function limparEnvios() {
  webcam.naChamada = false;
  webcam.naLive = false;
  await voz.pararWebcam().catch(() => {});
  const live = webcam.live;
  webcam.live = null;
  webcam.publicacaoLive?.stop();
  webcam.publicacaoLive = null;
  await live?.disconnect();
  mudou();
}

export async function pararWebcam() {
  ++webcam.geracao;
  await limparEnvios();
  const privada = webcam.privada;
  webcam.privada = null;
  webcam.local?.stop();
  webcam.local = null;
  webcam.recebida = null;
  webcam.conectando = false;
  await privada?.disconnect();
  await webcam.wake?.release?.().catch(() => {});
  webcam.wake = null;
  mudou();
}

export async function conectarCelular(frontal = true) {
  if (webcam.local) {
    await webcam.local.restartTrack({ facingMode: frontal ? 'user' : 'environment' });
    mudou();
    return;
  }
  await pararWebcam();
  const geracao = webcam.geracao;
  webcam.conectando = true;
  webcam.erro = '';
  mudou();
  let nova;
  try {
    // Abrir a câmera pelo gesto do usuário, antes da conexão de rede. Sem pedir microfone.
    const LK = await voz.carregarLiveKit();
    nova = await LK.createLocalVideoTrack({ facingMode: frontal ? 'user' : 'environment',
      resolution: { width: 1280, height: 720, frameRate: 30 } });
    if (geracao !== webcam.geracao) { nova.stop(); return; }
    const { room } = await conectar('celular', undefined, null, () => {
      if (geracao === webcam.geracao) pararWebcam().catch(() => {});
    });
    if (geracao !== webcam.geracao) { nova.stop(); await room.disconnect(); return; }
    webcam.privada = room;
    webcam.local = nova;
    nova.mediaStreamTrack.addEventListener('ended', () => pararWebcam().catch(() => {}), { once: true });
    await room.localParticipant.publishTrack(nova, { source: LK.Track.Source.Camera,
      videoCodec: 'h264', simulcast: true, videoEncoding: { maxBitrate: 2500000, maxFramerate: 30 } });
    webcam.wake = await navigator.wakeLock?.request('screen').catch(() => null);
  } catch (e) {
    nova?.stop();
    await pararWebcam();
    webcam.erro = e.name === 'NotAllowedError' ? 'Libere a câmera nas permissões do aplicativo ou navegador.' : e.message;
    throw e;
  } finally { webcam.conectando = false; mudou(); }
}

export async function receberCelular() {
  await pararWebcam();
  const geracao = webcam.geracao;
  webcam.conectando = true;
  webcam.erro = '';
  mudou();
  try {
    const { room } = await conectar('pc', undefined, (track) => {
      if (geracao !== webcam.geracao) return;
      webcam.recebida = track;
      mudou();
    }, () => {
      if (geracao !== webcam.geracao) return;
      webcam.recebida = null;
      limparEnvios().catch(() => {});
      mudou();
    });
    if (geracao !== webcam.geracao) { await room.disconnect(); return; }
    webcam.privada = room;
  } catch (e) { webcam.erro = e.message; throw e; }
  finally { webcam.conectando = false; mudou(); }
}

async function mostrarNaChamada() {
  if (webcam.naChamada) { webcam.naChamada = false; await voz.pararWebcam(); }
  else {
    const track = faixaRecebida();
    if (!track) throw Error('Conecte a câmera do celular primeiro.');
    const geracao = webcam.geracao;
    await voz.publicarWebcam(track);
    if (geracao !== webcam.geracao || faixaRecebida() !== track) { await voz.pararWebcam(); return; }
    webcam.naChamada = true;
  }
  mudou();
}

async function mostrarNaLive() {
  if (webcam.naLive) {
    webcam.naLive = false;
    const room = webcam.live;
    webcam.live = null;
    webcam.publicacaoLive?.stop();
    webcam.publicacaoLive = null;
    await room?.disconnect();
  } else {
    const track = faixaRecebida();
    if (!track) throw Error('Conecte a câmera do celular primeiro.');
    const geracao = webcam.geracao;
    const { room, LK } = await conectar('publicar', undefined, null, () => {
      webcam.naLive = false; mudou();
    });
    if (geracao !== webcam.geracao || faixaRecebida() !== track) { await room.disconnect(); return; }
    const camera = new LK.LocalVideoTrack(track.clone(), undefined, true);
    try {
      await room.localParticipant.publishTrack(camera, { source: LK.Track.Source.Camera,
        videoCodec: 'h264', simulcast: true, videoEncoding: { maxBitrate: 1800000, maxFramerate: 30 } });
      if (geracao !== webcam.geracao || faixaRecebida() !== track) { camera.stop(); await room.disconnect(); return; }
      webcam.live = room;
      webcam.publicacaoLive = camera;
      webcam.naLive = true;
    } catch (e) { camera.stop(); await room.disconnect(); throw e; }
  }
  mudou();
}

/** Configuração comum aos dois aparelhos. Fechar a página mantém a câmera; o botão Parar encerra. */
export function paginaWebcam(secao) {
  const preview = el('video', { autoplay: true, muted: true, playsInline: true, class: 'webcam-previa' });
  const status = el('p', { class: 'ajuda', attrs: { role: 'status' } });
  const controles = el('div', { class: 'webcam-controles' });
  let frontal = true, faixa = null;
  const acao = (texto, executar, disabled = false) => el('button', { class: 'botao', text: texto, disabled,
    onclick: async (e) => { e.currentTarget.disabled = true; try { await executar(); } catch (falha) { erro(falha); } finally { atualizar(); } } });
  const atualizar = () => {
    const atual = webcam.local || webcam.recebida;
    preview.hidden = !atual;
    if (faixa !== atual) {
      faixa?.detach(preview);
      preview.srcObject = null;
      faixa = atual;
      faixa?.attach(preview);
      if (faixa) preview.play().catch(() => {});
    }
    status.textContent = webcam.erro || (webcam.conectando ? 'Conectando...'
      : webcam.local ? 'Enviando só a câmera para o seu PC. Mantenha o app aberto e a tela acesa.'
        : webcam.recebida ? 'Celular conectado. A prévia é privada até você escolher onde mostrar.'
          : webcam.privada ? 'Aguardando o celular. Entre na mesma conta e toque em Usar como webcam.'
            : 'Entre na mesma conta no celular e no PC. A câmera só liga quando você autoriza.');
    limpar(controles, celular()
      ? [acao(webcam.local ? 'Trocar câmera' : 'Usar como webcam', async () => {
        if (webcam.local) frontal = !frontal;
        await conectarCelular(frontal);
      }, webcam.conectando)]
      : [acao('Conectar meu celular', receberCelular, webcam.conectando),
        acao(webcam.naChamada ? 'Ocultar na chamada' : 'Mostrar na chamada de voz', mostrarNaChamada, !webcam.recebida || voz.voz.situacao !== 'conectada'),
        acao(webcam.naLive ? 'Ocultar na live' : 'Mostrar na minha live', mostrarNaLive, !webcam.recebida),
        acao('Mostrar webcams da chamada', () => { ocultas.clear(); sincronizarQuadros(); })],
    acao('Parar webcam', pararWebcam, !webcam.privada && !webcam.conectando));
  };
  limpar(secao, el('h2', { text: 'Webcam do celular' }),
    el('p', { text: 'Use a câmera frontal ou traseira do celular no Exilados. O microfone continua sendo o do PC.' }),
    preview, status, controles,
    el('p', { class: 'ajuda' }, 'No Android: ', el('a', {
      href: 'https://filabox3d.com.br/exilados/atualizacao/webcam/Exilados.apk',
      text: 'Baixar Exilados Webcam', attrs: { download: 'Exilados-Webcam.apk' },
    }), '. Instale no celular e entre na mesma conta. Também funciona pelo navegador do celular.'),
    el('p', { class: 'ajuda', text: 'Quem assiste pode escolher Janela separada ou Sobre a transmissão no menu da webcam. Arraste para mover e use o canto para redimensionar. Na chamada de voz, só quem está na chamada recebe a imagem. Na live, os membros que assistem também podem abrir sua câmera.' }));
  const parar = [ouvir('webcamEstado', atualizar), ouvir('voz', atualizar)];
  atualizar();
  return () => { parar.forEach((p) => p()); faixa?.detach(preview); preview.srcObject = null; };
}

export function registrarPalcoWebcam(chave, titulo, elemento) {
  palcos.set(chave, { titulo, elemento });
  for (const quadro of quadros.values()) quadro.atualizarOpcoes();
  return () => {
    palcos.delete(chave);
    for (const quadro of quadros.values()) {
      if (quadro.alvo === chave) quadro.posicionar('');
      quadro.atualizarOpcoes();
    }
  };
}

function abrirQuadro(id, track) {
  if (ocultas.has(id)) return;
  const existente = quadros.get(id);
  if (existente) { existente.trocarTrack(track); return; }
  const video = el('video', { autoplay: true, muted: true, playsInline: true });
  const seletor = el('select', { attrs: { 'aria-label': 'Posição da webcam' } });
  const caixa = el('div', { class: 'webcam-quadro' });
  const mover = el('div', { class: 'webcam-barra' }, el('span', { text: `Webcam · ${nomeDe(id)}` }), seletor,
    el('button', { text: '×', title: 'Ocultar esta webcam', onclick: () => { ocultas.add(id); fecharQuadro(id); } }));
  const canto = el('button', { class: 'webcam-redimensionar', title: 'Redimensionar webcam', attrs: { 'aria-label': 'Redimensionar webcam' } });
  caixa.append(mover, video, canto);
  const q = { caixa, video, track: null, janela: null, alvo: '', geometria: limitarWebcam(),
    trocarTrack(atual) {
      if (q.track === atual) return;
      q.track?.detach(video); video.srcObject = null;
      q.track = atual; atual.attach(video); video.play().catch(() => {});
    },
    atualizarOpcoes() {
      limpar(seletor, el('option', { value: '', text: 'Janela separada' }),
        [...palcos].map(([chave, palco]) => el('option', { value: chave, text: `Sobre: ${palco.titulo}` })));
      seletor.value = q.alvo;
    },
    posicionar(alvo) {
      q.alvo = palcos.has(alvo) ? alvo : '';
      const janelaAnterior = q.janela;
      q.janela = null;
      if (q.alvo) {
        const palco = palcos.get(q.alvo).elemento;
        palco.classList.add('webcam-destino');
        palco.append(caixa);
        caixa.classList.add('webcam-sobreposta');
        try { q.geometria = limitarWebcam(JSON.parse(localStorage.getItem(`webcam-posicao-${meuId()}-${id}-${q.alvo}`) || '{}')); } catch { q.geometria = limitarWebcam(); }
        aplicar();
      } else {
        caixa.classList.remove('webcam-sobreposta');
        caixa.removeAttribute('style');
        q.janela = criarJanelaLive({ titulo: `Webcam de ${nomeDe(id)}`, conteudo: caixa,
          modoForcado: 'com-botao', aoFechar: () => { ocultas.add(id); fecharQuadro(id); } });
      }
      janelaAnterior?.destruir();
      q.atualizarOpcoes();
      video.play().catch(() => {});
    } };
  function aplicar() {
    const g = q.geometria;
    Object.assign(caixa.style, { left: `${g.x}%`, top: `${g.y}%`, width: `${g.largura}%`, height: `${g.altura}%` });
  }
  function arrastar(evento, tamanho) {
    if (!q.alvo || (!tamanho && evento.target !== mover && evento.target.tagName !== 'SPAN')) return;
    evento.preventDefault();
    const alvo = evento.currentTarget;
    alvo.setPointerCapture(evento.pointerId);
    const r = palcos.get(q.alvo).elemento.getBoundingClientRect();
    const inicio = { ...q.geometria }, x = evento.clientX, y = evento.clientY;
    const mexer = (e) => {
      const dx = (e.clientX - x) / r.width * 100, dy = (e.clientY - y) / r.height * 100;
      q.geometria = limitarWebcam(tamanho ? { ...inicio, largura: inicio.largura + dx, altura: inicio.altura + dy }
        : { ...inicio, x: inicio.x + dx, y: inicio.y + dy });
      aplicar();
    };
    const fim = () => {
      alvo.removeEventListener('pointermove', mexer);
      alvo.removeEventListener('pointerup', fim);
      alvo.removeEventListener('pointercancel', fim);
      try { localStorage.setItem(`webcam-posicao-${meuId()}-${id}-${q.alvo}`, JSON.stringify(q.geometria)); } catch { /* armazenamento indisponível */ }
    };
    alvo.addEventListener('pointermove', mexer);
    alvo.addEventListener('pointerup', fim);
    alvo.addEventListener('pointercancel', fim);
  }
  mover.addEventListener('pointerdown', (e) => arrastar(e, false));
  canto.addEventListener('pointerdown', (e) => arrastar(e, true));
  seletor.addEventListener('change', () => q.posicionar(seletor.value));
  quadros.set(id, q);
  q.trocarTrack(track);
  q.posicionar('');
}

function fecharQuadro(id) {
  const q = quadros.get(id);
  if (!q) return;
  quadros.delete(id);
  q.track?.detach(q.video);
  q.janela?.destruir();
  q.caixa.remove();
}

function sincronizarQuadros() {
  const cameras = voz.webcamsNaSala();
  for (const [id, live] of livesRecebidas) if (live.track) cameras.set(id, live.track);
  for (const id of quadros.keys()) if (!cameras.has(id)) { fecharQuadro(id); ocultas.delete(id); }
  for (const [id, track] of cameras) abrirQuadro(id, track);
}

/** Webcam opcional de quem transmite pelo programa, sem entrar na sala de voz. */
export async function assistirWebcamLive(id) {
  const existente = livesRecebidas.get(id);
  if (existente) { ocultas.delete(id); sincronizarQuadros(); return; }
  const registro = { room: null, track: null };
  livesRecebidas.set(id, registro);
  try {
    const { room } = await conectar('assistir', id, (track) => {
      if (livesRecebidas.get(id) !== registro) return;
      registro.track = track; sincronizarQuadros();
    }, () => { registro.track = null; sincronizarQuadros(); });
    if (livesRecebidas.get(id) !== registro) { await room.disconnect(); return; }
    registro.room = room;
  } catch (e) { livesRecebidas.delete(id); throw e; }
}

export function fecharWebcamLive(id) {
  const registro = livesRecebidas.get(id);
  livesRecebidas.delete(id);
  registro?.room?.disconnect();
  sincronizarQuadros();
}

ouvir('webcams', sincronizarQuadros);
ouvir('voz', () => {
  if (voz.voz.situacao === 'desligada') { webcam.naChamada = false; mudou(); sincronizarQuadros(); }
});
ouvir('lives', () => {
  const live = estado.lives.get(meuId());
  if (webcam.naLive && (!live || Date.now() - Date.parse(live.ultimo_sinal) > 60000)) mostrarNaLive().catch(() => {});
});
