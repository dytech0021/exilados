// Salas de voz pelo LiveKit: entrar e sair, silenciar, desligar o som, volume de cada pessoa (0–200%), escolha de
// microfone e de saída com troca na hora, e o volume de entrada.
//
// O microfone passa por um ganho (Web Audio) antes de ser publicado, para o volume de entrada valer na hora; a
// redução de ruído, o cancelamento de eco e o ajuste de ganho do navegador ficam sempre ligados.
import { LIVEKIT_SCRIPT } from './config.js';
import { atualizarPresenca, avisarQueFalo } from './dados.js';
import { avisar, estado, meuId } from './estado.js';
import { api } from './supa.js';
import { aviso } from './ui.js';

export const voz = { situacao: 'desligada', sala: null, mudo: false, surdo: false, semMicrofone: false };
estado.falandoNaSala = new Set();

let LK = null;
let sala = null;
let microfone = null; // { bruto, ctx, ganho, analisador, faixa, trilha }
let saindo = false;
const elementos = new Map(); // faixa -> <audio>

// ---------- preferências (guardadas neste aparelho, por conta) ----------

const chavePrefs = () => `exilados-voz-${meuId()}`;
let prefs = null;

export function preferencias() {
  if (!prefs) {
    try { prefs = JSON.parse(localStorage.getItem(chavePrefs()) || '{}'); } catch { prefs = {}; }
    prefs.volumes ||= {};
    prefs.volumeEntrada ??= 100;
    voz.mudo = Boolean(prefs.mudo);
    voz.surdo = Boolean(prefs.surdo);
  }
  return prefs;
}

function guardar() {
  try { localStorage.setItem(chavePrefs(), JSON.stringify(prefs)); } catch { /* sem armazenamento */ }
}

function mudou() {
  avisar('voz', voz);
}

export function volumeDe(id) {
  return preferencias().volumes[id] ?? 100;
}

export function definirVolume(id, porcento) {
  const valor = Math.max(0, Math.min(200, Math.round(porcento)));
  if (valor === 100) delete preferencias().volumes[id];
  else preferencias().volumes[id] = valor;
  guardar();
  aplicarVolume(id);
}

function aplicarVolume(id) {
  const participante = sala?.remoteParticipants.get(id);
  if (participante) participante.setVolume(voz.surdo ? 0 : volumeDe(id) / 100);
}

// ---------- LiveKit ----------

function carregarLiveKit() {
  if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LIVEKIT_SCRIPT;
    script.onload = () => resolve(window.LivekitClient);
    script.onerror = () => reject(new Error('Não deu para carregar a voz. Confira a internet e tente de novo.'));
    document.head.append(script);
  });
}

const restricoes = (deviceId) => ({
  deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
});

async function abrirMicrofone() {
  const p = preferencias();
  let bruto;
  try {
    bruto = await navigator.mediaDevices.getUserMedia({ audio: restricoes(p.entrada) });
  } catch (erro) {
    if (erro?.name === 'OverconstrainedError' && p.entrada) {
      // O microfone escolhido sumiu: usa o padrão.
      bruto = await navigator.mediaDevices.getUserMedia({ audio: restricoes(null) });
    } else {
      throw erro;
    }
  }
  const ctx = new AudioContext();
  const fonte = ctx.createMediaStreamSource(bruto);
  const ganho = ctx.createGain();
  ganho.gain.value = p.volumeEntrada / 100;
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 512;
  const destino = ctx.createMediaStreamDestination();
  fonte.connect(ganho);
  ganho.connect(analisador);
  ganho.connect(destino);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  return { bruto, ctx, ganho, analisador, faixa: destino.stream.getAudioTracks()[0] };
}

function fecharMicrofone(m) {
  if (!m) return;
  m.bruto.getTracks().forEach((t) => t.stop());
  m.faixa?.stop();
  m.ctx.close().catch(() => {});
}

async function ligarMicrofone() {
  try {
    microfone = await abrirMicrofone();
  } catch (erro) {
    voz.semMicrofone = true;
    mudou();
    const negado = erro?.name === 'NotAllowedError' || erro?.name === 'SecurityError';
    aviso(negado
      ? 'O microfone foi bloqueado: você entrou só ouvindo. Libere o microfone no cadeado ao lado do endereço e entre de novo na sala.'
      : 'Nenhum microfone encontrado: você entrou só ouvindo.', { tipo: 'erro', duracao: 10000 });
    return;
  }
  voz.semMicrofone = false;
  microfone.trilha = new LK.LocalAudioTrack(microfone.faixa, undefined, true);
  // Publicar pode falhar se a negociação com o servidor cruzar com a chegada do áudio de quem já está na sala:
  // tenta de novo; se não der, fica só ouvindo (a sala não cai por isso).
  const room = sala;
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      await room.localParticipant.publishTrack(microfone.trilha, {
        source: LK.Track.Source.Microphone,
        dtx: true,
        red: true,
        audioPreset: LK.AudioPresets.speech,
      });
      if (voz.mudo || voz.surdo) await microfone.trilha.mute();
      return;
    } catch (erro) {
      console.warn(`Exilados: o microfone não foi publicado (tentativa ${tentativa}):`, erro);
      if (sala !== room) return;
      await new Promise((r) => setTimeout(r, 1200 * tentativa));
      if (sala !== room) return;
    }
  }
  fecharMicrofone(microfone);
  microfone = null;
  voz.semMicrofone = true;
  mudou();
  aviso('Não deu para ligar o seu microfone agora: você está só ouvindo. Saia e entre de novo na sala para tentar outra vez.', { tipo: 'erro', duracao: 10000 });
}

function anexar(faixa, participante) {
  if (faixa.kind !== 'audio') return;
  const elemento = faixa.attach();
  elemento.dataset.quem = participante.identity;
  document.body.append(elemento);
  elementos.set(faixa, elemento);
  aplicarVolume(participante.identity);
}

function desanexar(faixa) {
  faixa.detach().forEach((e) => e.remove());
  elementos.delete(faixa);
}

function limpar() {
  for (const faixa of [...elementos.keys()]) desanexar(faixa);
  fecharMicrofone(microfone);
  microfone = null;
  sala = null;
  estado.falandoNaSala.clear();
  avisarQueFalo(false);
}

function montarEventos(LKC, room) {
  const E = LKC.RoomEvent;
  room
    .on(E.TrackSubscribed, (faixa, _pub, participante) => anexar(faixa, participante))
    .on(E.TrackUnsubscribed, (faixa) => desanexar(faixa))
    .on(E.ActiveSpeakersChanged, (quem) => {
      estado.falandoNaSala = new Set(quem.map((p) => p.identity));
      avisarQueFalo(!voz.mudo && !voz.surdo && estado.falandoNaSala.has(meuId()));
      avisar('falando');
    })
    .on(E.Reconnecting, () => { voz.situacao = 'reconectando'; mudou(); })
    .on(E.SignalReconnecting, () => { voz.situacao = 'reconectando'; mudou(); })
    .on(E.Reconnected, () => { voz.situacao = 'conectada'; mudou(); })
    .on(E.AudioPlaybackStatusChanged, () => {
      if (!room.canPlaybackAudio) {
        aviso('O navegador segurou o som da sala.', { acao: { rotulo: 'Ativar som', fn: () => room.startAudio() }, duracao: 0 });
      }
    })
    .on(E.MediaDevicesChanged, () => avisar('dispositivos'))
    .on(E.ParticipantConnected, () => mudou())
    .on(E.ParticipantDisconnected, () => mudou())
    .on(E.Disconnected, (motivo) => {
      if (room !== sala) return;
      const removido = motivo === LKC.DisconnectReason?.PARTICIPANT_REMOVED;
      limpar();
      const antes = voz.sala;
      voz.situacao = 'desligada';
      voz.sala = null;
      atualizarPresenca({ voz: null });
      mudou();
      if (!saindo && antes) {
        aviso(removido ? 'Você foi tirado da sala de voz.' : 'A conexão de voz caiu.', removido ? { tipo: 'erro' } : {
          acao: { rotulo: 'Entrar de novo', fn: () => entrar(antes).catch((e) => aviso(e.message, { tipo: 'erro' })) },
          duracao: 10000,
        });
      }
    });
}

export async function entrar(salaId) {
  preferencias();
  if (voz.sala === salaId && voz.situacao !== 'desligada') return;
  if (sala) await sair();
  voz.sala = salaId;
  voz.situacao = 'conectando';
  mudou();
  try {
    const [LKC, permissao] = await Promise.all([carregarLiveKit(), api.chamar('/voz/entrar', { sala: salaId })]);
    LK = LKC;
    if (voz.sala !== salaId) return; // saiu ou trocou de sala enquanto conectava
    const room = new LK.Room({
      adaptiveStream: false,
      dynacast: false,
      disconnectOnPageLeave: true,
      webAudioMix: true,
      // O modo de conexão única (padrão novo da biblioteca) às vezes falha ao negociar no Chrome do Android
      // ("Transceiver not found based on m-line index"); o modo clássico, com uma conexão para enviar e outra para
      // receber, é o testado.
      singlePeerConnection: false,
      audioOutput: { deviceId: preferencias().saida || 'default' },
    });
    sala = room;
    montarEventos(LK, room);
    await room.connect(permissao.url, permissao.token, { autoSubscribe: true });
    if (sala !== room) return;
    voz.situacao = 'conectada';
    atualizarPresenca({ voz: salaId, mudo: voz.mudo || voz.surdo, surdo: voz.surdo });
    mudou();
    await room.startAudio().catch(() => {});
    await ligarMicrofone();
  } catch (erro) {
    const room = sala;
    limpar();
    room?.disconnect().catch(() => {});
    voz.situacao = 'desligada';
    voz.sala = null;
    atualizarPresenca({ voz: null });
    mudou();
    // Erros do servidor do Exilados já vêm em português; os da conexão de voz, não.
    if (erro?.status !== undefined) throw erro;
    console.error('Exilados: não deu para entrar na sala de voz:', erro);
    throw new Error('Não deu para entrar na sala de voz agora (falha na conexão de áudio). Tente de novo.');
  }
}

export async function sair() {
  if (!sala && voz.situacao === 'desligada') return;
  saindo = true;
  const room = sala;
  limpar();
  voz.situacao = 'desligada';
  voz.sala = null;
  atualizarPresenca({ voz: null });
  mudou();
  try {
    await room?.disconnect();
  } finally {
    saindo = false;
  }
}

async function aplicarCalado() {
  for (const id of sala?.remoteParticipants.keys() || []) aplicarVolume(id);
  const calado = voz.mudo || voz.surdo;
  if (microfone?.trilha) await (calado ? microfone.trilha.mute() : microfone.trilha.unmute());
  if (calado) avisarQueFalo(false);
  if (voz.sala) atualizarPresenca({ mudo: calado, surdo: voz.surdo });
  prefs.mudo = voz.mudo;
  prefs.surdo = voz.surdo;
  guardar();
  mudou();
}

export async function alternarMudo() {
  preferencias();
  if (voz.surdo) {
    // Como no Discord: ligar o microfone com o som desligado liga os dois.
    voz.surdo = false;
    voz.mudo = false;
  } else {
    voz.mudo = !voz.mudo;
  }
  await aplicarCalado();
}

/** Desligar o som também cala o microfone; ao religar, o microfone volta como estava. */
export async function alternarSurdo() {
  preferencias();
  if (voz.surdo) {
    voz.surdo = false;
    voz.mudo = Boolean(prefs.mudoAntesDeSurdo);
  } else {
    prefs.mudoAntesDeSurdo = voz.mudo;
    voz.surdo = true;
  }
  await aplicarCalado();
}

// ---------- dispositivos (Configurações → Voz e áudio) ----------

export const saidaDisponivel = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export async function listarDispositivos() {
  if (!navigator.mediaDevices?.enumerateDevices) return { entradas: [], saidas: [], semNomes: true };
  const todos = await navigator.mediaDevices.enumerateDevices();
  const entradas = todos.filter((d) => d.kind === 'audioinput');
  const saidas = todos.filter((d) => d.kind === 'audiooutput');
  return { entradas, saidas, semNomes: entradas.length > 0 && entradas.every((d) => !d.label) };
}

/** Pede a permissão do microfone só para os nomes dos aparelhos aparecerem na lista. */
export async function liberarNomes() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  s.getTracks().forEach((t) => t.stop());
}

export async function definirEntrada(id) {
  preferencias().entrada = id || null;
  guardar();
  if (!sala || !microfone?.trilha) return;
  const novo = await abrirMicrofone();
  await microfone.trilha.replaceTrack(novo.faixa, { userProvidedTrack: true });
  const velho = microfone;
  microfone = { ...novo, trilha: velho.trilha };
  velho.bruto.getTracks().forEach((t) => t.stop());
  velho.ctx.close().catch(() => {});
  if (voz.mudo || voz.surdo) await microfone.trilha.mute();
  avisar('microfoneTrocado');
}

export async function definirSaida(id) {
  preferencias().saida = id || null;
  guardar();
  if (sala) await sala.switchActiveDevice('audiooutput', id || 'default');
}

export function definirVolumeEntrada(porcento) {
  preferencias().volumeEntrada = Math.max(0, Math.min(200, Math.round(porcento)));
  guardar();
  if (microfone) microfone.ganho.gain.setTargetAtTime(prefs.volumeEntrada / 100, microfone.ctx.currentTime, 0.05);
}

/**
 * Medidor do microfone: chama `aoNivel(0..1)` umas 20 vezes por segundo. Na sala, mede o próprio microfone dela;
 * fora, abre o microfone escolhido só para o teste. Devolve a função que para.
 */
export async function testarMicrofone(aoNivel) {
  let teste = microfone;
  let proprio = false;
  if (!teste) {
    teste = await abrirMicrofone();
    proprio = true;
  }
  const dados = new Float32Array(teste.analisador.fftSize);
  let parado = false;
  const medir = () => {
    if (parado) return;
    const atual = proprio ? teste : (microfone || teste);
    atual.analisador.getFloatTimeDomainData(dados);
    let soma = 0;
    for (const v of dados) soma += v * v;
    const rms = Math.sqrt(soma / dados.length);
    aoNivel(Math.min(1, rms * 4));
    setTimeout(medir, 50);
  };
  medir();
  return () => {
    parado = true;
    if (proprio) fecharMicrofone(teste);
  };
}
