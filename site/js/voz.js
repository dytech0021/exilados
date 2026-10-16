// Salas de voz pelo LiveKit: entrar e sair, silenciar, desligar o som, volume de cada pessoa (0–200%), escolha de
// microfone e de saída com troca na hora, o volume de entrada e compartilhar a tela (como no Discord).
//
// O microfone passa por um ganho (Web Audio) antes de ser publicado, para o volume de entrada valer na hora; a
// redução de ruído, o cancelamento de eco e o ajuste de ganho do navegador ficam sempre ligados. O RNNoise acrescenta
// supressão de sons externos antes do ganho, quando AudioWorklet/WebAssembly estão disponíveis.
//
// A voz de todos chega sozinha; a tela de alguém (vídeo e som) só chega para quem abriu a transmissão dela, para não
// gastar a internet de quem não está assistindo.
import { LIVEKIT_SCRIPT } from './config.js';
import { atualizarPresenca, avisarQueFalo } from './dados.js';
import { avisar, estado, meuId } from './estado.js';
import { api } from './supa.js';
import { opcoesPublicacaoTela, qualidadeRecebida } from './qualidade-tela.js';
import { conectarFiltroRuido } from './filtro-ruido.js';
import { aviso } from './ui.js';

// tela: { qualidade, som } enquanto compartilha a própria tela; assistindo: de quem é a tela aberta (ou null).
export const voz = {
  situacao: 'desligada', sala: null, mudo: false, surdo: false, semMicrofone: false, tela: null, assistindo: null,
};

/** Qualidades de compartilhamento de tela (o vídeo vai em H.264, que os computadores codificam no próprio chip). */
export const QUALIDADES = {
  '720p30': { rotulo: '720p · 30 fps', largura: 1280, altura: 720, fps: 30, bitrate: 2_500_000 },
  '1080p30': { rotulo: '1080p · 30 fps', largura: 1920, altura: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { rotulo: '1080p · 60 fps', largura: 1920, altura: 1080, fps: 60, bitrate: 6_000_000 },
};
export const QUALIDADE_PADRAO = '1080p30';

/**
 * No Android, o Chrome trata o microfone e o som da chamada como uma rota só (fone Bluetooth, fone com fio,
 * alto-falante ou celular no ouvido): escolher o microfone escolhe também por onde sai o som. Para isso o som da
 * sala toca pelo canal de chamada (sem a mixagem do Web Audio, que mandaria o som pelo canal de mídia e misturaria
 * fone e celular), e o volume de cada pessoa vai até 100%.
 */
export const ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
const CELULAR = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const VOLUME_MAXIMO = ANDROID ? 100 : 200;
estado.falandoNaSala = new Set();

let LK = null;
let sala = null;
let microfone = null; // { bruto, ctx, ganho, analisador, faixa, trilha }
let tela = null; // a própria tela compartilhada: { fluxo, video, som }
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
    prefs.volumeSaida ??= 100;
    prefs.cancelamentoRuido ??= true;
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
  const valor = Math.max(0, Math.min(VOLUME_MAXIMO, Math.round(porcento)));
  if (valor === 100) delete preferencias().volumes[id];
  else preferencias().volumes[id] = valor;
  guardar();
  aplicarVolume(id);
}

/** Volume de uma pessoa: o dela vezes o volume de saída geral, até o máximo do aparelho (200% ou, no Android, 100%). */
export function volumeEfetivo(id) {
  return Math.min(volumeDe(id) * (preferencias().volumeSaida / 100), VOLUME_MAXIMO) / 100;
}

function aplicarVolume(id) {
  const participante = sala?.remoteParticipants.get(id);
  if (!participante) return;
  participante.setVolume(voz.surdo ? 0 : volumeEfetivo(id));
  participante.setVolume(voz.surdo ? 0 : volumeDaTelaEfetivo(), LK.Track.Source.ScreenShareAudio);
}

/** Volume de saída geral (todos da sala), de 0 ao máximo do aparelho. */
export function definirVolumeSaida(porcento) {
  preferencias().volumeSaida = Math.max(0, Math.min(VOLUME_MAXIMO, Math.round(porcento)));
  guardar();
  for (const id of sala?.remoteParticipants.keys() || []) aplicarVolume(id);
}

/** Volume do som das telas compartilhadas (um só para todas), de 0 ao máximo do aparelho. */
export function volumeDaTela() {
  return preferencias().volumeTela ?? 100;
}

function volumeDaTelaEfetivo() {
  return Math.min(volumeDaTela() * (preferencias().volumeSaida / 100), VOLUME_MAXIMO) / 100;
}

export function definirVolumeDaTela(porcento) {
  preferencias().volumeTela = Math.max(0, Math.min(VOLUME_MAXIMO, Math.round(porcento)));
  guardar();
  for (const id of sala?.remoteParticipants.keys() || []) aplicarVolume(id);
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

/** Nome do aparelho em português (no Android, o Chrome dá nomes de rota em inglês). */
export function nomeDoAparelho(aparelho, i = 0) {
  const rotulo = String(aparelho?.label || '');
  if (!rotulo || aparelho.deviceId === 'default') return 'Padrão do sistema';
  if (/bluetooth/i.test(rotulo)) return ANDROID ? 'Fone Bluetooth' : rotulo;
  if (/speakerphone/i.test(rotulo)) return 'Alto-falante do celular';
  if (/earpiece/i.test(rotulo)) return 'Celular no ouvido';
  if (/wired headset/i.test(rotulo)) return 'Fone com fio';
  if (/usb audio/i.test(rotulo)) return 'Áudio USB';
  return rotulo || `Microfone ${i + 1}`;
}

const ehFone = (aparelho) => /bluetooth|headset|fone|airpods|buds/i.test(aparelho.label || '') && !/earpiece/i.test(aparelho.label || '');

const capturar = (deviceId) => navigator.mediaDevices.getUserMedia({ audio: restricoes(deviceId) });

async function abrirMicrofone() {
  const p = preferencias();
  let bruto;
  try {
    bruto = await capturar(p.entrada);
  } catch (erro) {
    if (erro?.name === 'OverconstrainedError' && p.entrada) {
      // O microfone escolhido sumiu: usa o padrão.
      bruto = await capturar(null);
    } else {
      throw erro;
    }
  }
  // No Android, sem escolha feita: com um fone conectado, usa o microfone dele (e assim o som também sai nele).
  if (ANDROID && !p.entrada) {
    const fone = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && ehFone(d));
    const atual = bruto.getAudioTracks()[0]?.getSettings?.().deviceId;
    if (fone && fone.deviceId !== atual) {
      try {
        const doFone = await capturar(fone.deviceId);
        bruto.getTracks().forEach((t) => t.stop());
        bruto = doFone;
      } catch {
        // Fica no padrão.
      }
    }
  }
  const pista = bruto.getAudioTracks()[0];
  let ctx;
  try { ctx = new AudioContext({ sampleRate: 48000 }); } catch { ctx = new AudioContext(); }
  const fonte = ctx.createMediaStreamSource(bruto);
  let filtroRuido = null;
  if (p.cancelamentoRuido && ctx.sampleRate === 48000 && ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      await ctx.audioWorklet.addModule(new URL('../vendor/noise-worklet.js', import.meta.url));
      filtroRuido = new AudioWorkletNode(ctx, 'exilados-cancelamento-ruido');
    } catch (falha) {
      console.warn('Exilados: RNNoise indisponível, usando a redução do navegador:', falha);
    }
  }
  const ganho = ctx.createGain();
  ganho.gain.value = p.volumeEntrada / 100;
  // Tratamento de voz (como o do Discord): o compressor aproxima as partes fracas das fortes e, junto com o reforço,
  // sobe a voz uns 11 dB (o ajuste automático do navegador a deixa baixa); o limitador impede que ela estoure.
  // Medido com voz simulada: fraca e normal +11 dB, forte +6 dB, picos abaixo de -1 dB.
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 10;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;
  const reforco = ctx.createGain();
  reforco.gain.value = 1.25;
  const limitador = ctx.createDynamicsCompressor();
  limitador.threshold.value = -3;
  limitador.knee.value = 0;
  limitador.ratio.value = 20;
  limitador.attack.value = 0.001;
  limitador.release.value = 0.1;
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 512;
  const destino = ctx.createMediaStreamDestination();
  const desligarFiltroRuido = conectarFiltroRuido(fonte, filtroRuido, ganho);
  ganho.connect(compressor);
  compressor.connect(reforco);
  reforco.connect(limitador);
  limitador.connect(analisador);
  limitador.connect(destino);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  return {
    bruto, ctx, ganho, analisador, filtroRuido, desligarFiltroRuido,
    faixa: destino.stream.getAudioTracks()[0],
    aparelho: pista?.getSettings?.().deviceId || '',
    nome: nomeDoAparelho({ label: pista?.label, deviceId: pista?.getSettings?.().deviceId }),
  };
}

/** Por onde a voz está entrando agora ("Fone Bluetooth", "Alto-falante do celular"...), ou null fora da sala. */
export function rotaAtual() {
  return microfone?.nome || null;
}

function fecharMicrofone(m) {
  if (!m) return;
  m.desligarFiltroRuido?.();
  m.bruto.getTracks().forEach((t) => t.stop());
  m.faixa?.stop();
  m.filtroRuido?.port.postMessage('parar');
  m.filtroRuido?.disconnect();
  m.ctx.close().catch(() => {});
}

function avisarSemMicrofone(erro) {
  voz.semMicrofone = true;
  mudou();
  const negado = erro?.name === 'NotAllowedError' || erro?.name === 'SecurityError';
  aviso(negado
    ? 'O microfone foi bloqueado: você entrou só ouvindo. Libere o microfone no cadeado ao lado do endereço e entre de novo na sala.'
    : 'Nenhum microfone encontrado: você entrou só ouvindo.', { tipo: 'erro', duracao: 10000 });
}

/** Publica o microfone já aberto. Se a negociação falhar, tenta de novo; se não der, fica só ouvindo. */
async function publicarMicrofone() {
  if (!microfone) return;
  voz.semMicrofone = false;
  microfone.trilha = new LK.LocalAudioTrack(microfone.faixa, undefined, true);
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
      mudou();
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

const ehDaTela = (pub) => pub.source === LK.Track.Source.ScreenShare || pub.source === LK.Track.Source.ScreenShareAudio;

/** A voz de todos é recebida sempre; a tela (vídeo e som), só a de quem está sendo assistido; câmera, nunca. */
function decidirRecebimento(pub, participante) {
  const receber = ehDaTela(pub) ? voz.assistindo === participante.identity : pub.kind === 'audio';
  if (receber && pub.source === LK.Track.Source.ScreenShare) pub.setVideoQuality(qualidadeRecebida(LK, CELULAR, pub.simulcasted));
  if (receber) pub.setSubscribed(true);
}

function anexar(faixa, pub, participante) {
  if (faixa.kind !== 'audio') {
    if (ehDaTela(pub)) avisar('telas');
    return;
  }
  // Som da voz e som da tela: cada um num <audio> (o vídeo da tela é mostrado por tela.js).
  const elemento = faixa.attach();
  elemento.dataset.quem = participante.identity;
  document.body.append(elemento);
  elementos.set(faixa, elemento);
  aplicarVolume(participante.identity);
  if (ehDaTela(pub)) avisar('telas');
}

function desanexar(faixa, pub) {
  // A biblioteca às vezes já soltou a faixa do <audio> antes do aviso: remove o elemento guardado de qualquer jeito.
  const elemento = elementos.get(faixa);
  if (elemento) {
    faixa.detach(elemento);
    elemento.remove();
    elementos.delete(faixa);
  }
  if (pub && ehDaTela(pub)) avisar('telas');
}

function soltarTela() {
  if (!tela) return;
  tela.fluxo.getTracks().forEach((p) => p.stop());
  tela.video?.stop();
  tela.som?.stop();
  tela = null;
}

function limpar() {
  for (const faixa of [...elementos.keys()]) desanexar(faixa);
  fecharMicrofone(microfone);
  microfone = null;
  soltarTela();
  voz.tela = null;
  voz.assistindo = null;
  sala = null;
  estado.falandoNaSala.clear();
  avisarQueFalo(false);
  avisar('telas');
}

// O que a presença diz quando sai da sala de voz.
const FORA_DA_VOZ = { voz: null, tela: false, assistindo: null };

function montarEventos(LKC, room) {
  const E = LKC.RoomEvent;
  room
    .on(E.TrackPublished, (pub, participante) => {
      decidirRecebimento(pub, participante);
      if (ehDaTela(pub)) avisar('telas');
    })
    .on(E.TrackUnpublished, (pub) => { if (ehDaTela(pub)) avisar('telas'); })
    .on(E.TrackSubscribed, (faixa, pub, participante) => anexar(faixa, pub, participante))
    .on(E.TrackUnsubscribed, (faixa, pub) => desanexar(faixa, pub))
    .on(E.LocalTrackUnpublished, (pub) => {
      // O servidor tirou a tela do ar (ou a conexão a perdeu de vez): para de compartilhar aqui também.
      if (tela && pub.track === tela.video) pararTela().catch(() => {});
    })
    .on(E.ActiveSpeakersChanged, (quem) => {
      estado.falandoNaSala = new Set(quem.map((p) => p.identity));
      avisarQueFalo(!voz.mudo && !voz.surdo && estado.falandoNaSala.has(meuId()));
      avisar('falando');
    })
    .on(E.Reconnecting, () => { voz.situacao = 'reconectando'; mudou(); })
    // A sinalização pode se reconectar enquanto o áudio continua; só marca queda se a mídia cair.
    .on(E.Reconnected, () => { voz.situacao = 'conectada'; mudou(); })
    .on(E.AudioPlaybackStatusChanged, () => {
      if (!room.canPlaybackAudio) {
        aviso('O navegador segurou o som da sala.', { acao: { rotulo: 'Ativar som', fn: () => room.startAudio() }, duracao: 0 });
      }
    })
    .on(E.MediaDevicesChanged, () => avisar('dispositivos'))
    .on(E.ParticipantConnected, () => mudou())
    .on(E.ParticipantDisconnected, () => { mudou(); avisar('telas'); })
    .on(E.Disconnected, (motivo) => {
      if (room !== sala) return;
      const removido = motivo === LKC.DisconnectReason?.PARTICIPANT_REMOVED;
      limpar();
      const antes = voz.sala;
      voz.situacao = 'desligada';
      voz.sala = null;
      atualizarPresenca(FORA_DA_VOZ);
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
  // O microfone abre antes de entrar na sala: no Android isso põe o celular em modo de chamada antes de o som da
  // sala começar, e o som segue a mesma rota do microfone (fone ou celular).
  const preparo = abrirMicrofone().then((mic) => ({ mic }), (erro) => ({ erro }));
  try {
    let LKC;
    let permissao;
    try {
      [LKC, permissao] = await Promise.all([carregarLiveKit(), api.chamar('/voz/entrar', { sala: salaId })]);
    } catch (erro) {
      const { mic } = await preparo;
      fecharMicrofone(mic);
      throw erro;
    }
    LK = LKC;
    const { mic, erro: erroMicrofone } = await preparo;
    if (voz.sala !== salaId) { // saiu ou trocou de sala enquanto conectava
      fecharMicrofone(mic);
      return;
    }
    microfone = mic || null;
    const room = new LK.Room({
      adaptiveStream: false,
      dynacast: false,
      disconnectOnPageLeave: true,
      // Fora do Android, o Web Audio permite volume de até 200% por pessoa e escolher a saída de som.
      webAudioMix: !ANDROID,
      // O modo de conexão única (padrão novo da biblioteca) às vezes falha ao negociar no Chrome do Android
      // ("Transceiver not found based on m-line index"); o modo clássico, com uma conexão para enviar e outra para
      // receber, é o testado.
      singlePeerConnection: false,
      audioOutput: { deviceId: preferencias().saida || 'default' },
    });
    sala = room;
    montarEventos(LK, room);
    // Sem receber tudo sozinho: a voz é pedida aqui e em TrackPublished; a tela, só ao assistir.
    await room.connect(permissao.url, permissao.token, { autoSubscribe: false });
    if (sala !== room) return;
    for (const participante of room.remoteParticipants.values()) {
      for (const pub of participante.trackPublications.values()) decidirRecebimento(pub, participante);
    }
    voz.situacao = 'conectada';
    atualizarPresenca({
      voz: salaId, mudo: voz.mudo || voz.surdo, surdo: voz.surdo, tela: false, assistindo: null,
    });
    avisar('telas');
    mudou();
    await room.startAudio().catch(() => {});
    if (ANDROID && !preferencias().dicaVolume) {
      prefs.dicaVolume = true;
      guardar();
      aviso('Dica: no celular a voz usa o volume de chamada, separado do de música e vídeos. Aumente pelos botões de volume do celular durante a conversa.', { duracao: 10000 });
    }
    if (microfone) await publicarMicrofone();
    else avisarSemMicrofone(erroMicrofone);
  } catch (erro) {
    const room = sala;
    limpar();
    room?.disconnect().catch(() => {});
    voz.situacao = 'desligada';
    voz.sala = null;
    atualizarPresenca(FORA_DA_VOZ);
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
  atualizarPresenca(FORA_DA_VOZ);
  mudou();
  try {
    await room?.disconnect();
  } finally {
    saindo = false;
  }
}

// ---------- compartilhar e assistir telas ----------

/** Compartilhar a tela é só no computador: o navegador do celular não captura a tela. */
export function podeCompartilhar() {
  return !ANDROID && !/iPhone|iPad|iPod/i.test(navigator.userAgent) && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

function capturarTela(q) {
  return navigator.mediaDevices.getDisplayMedia({
    // "max" reduz telas maiores mantendo a proporção; telas menores ficam no tamanho delas.
    video: { width: { max: q.largura }, height: { max: q.altura }, frameRate: { ideal: q.fps, max: q.fps } },
    // Som do jogo/vídeo como ele é (sem os filtros de voz) e, onde o navegador deixar, sem o som da própria sala.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
    systemAudio: 'include',
    windowAudio: 'system',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  });
}

/**
 * Começa a compartilhar a tela (ou janela, ou aba) na sala de voz atual. Devolve false se a pessoa cancelou a
 * escolha. Se já estiver compartilhando, troca pela nova escolha.
 */
export async function compartilharTela(qualidade = preferencias().qualidadeTela || QUALIDADE_PADRAO) {
  if (!sala || voz.situacao !== 'conectada') throw new Error('Entre numa sala de voz para compartilhar a tela.');
  if (!podeCompartilhar()) throw new Error('Compartilhar a tela só funciona no navegador do computador.');
  const q = QUALIDADES[qualidade] || QUALIDADES[QUALIDADE_PADRAO];
  const room = sala;
  let fluxo;
  try {
    fluxo = await capturarTela(q);
  } catch (erro) {
    if (erro?.name === 'NotAllowedError' || erro?.name === 'AbortError') return false; // fechou a janela de escolha
    console.error('Exilados: não deu para capturar a tela:', erro);
    throw new Error('Não deu para capturar a tela neste navegador.');
  }
  if (sala !== room) {
    fluxo.getTracks().forEach((p) => p.stop());
    return false;
  }
  // Trocando o que é mostrado: tira a tela anterior do ar sem avisar que parou (quem assiste continua na tela).
  if (tela) await pararTela({ trocando: true });
  const pistaVideo = fluxo.getVideoTracks()[0];
  const pistaSom = fluxo.getAudioTracks()[0] || null;
  // Jogos e vídeos: o navegador mantém a fluidez e, com internet fraca, reduz a resolução antes do fps.
  pistaVideo.contentHint = 'motion';
  const nova = {
    fluxo,
    video: new LK.LocalVideoTrack(pistaVideo, undefined, true),
    som: pistaSom ? new LK.LocalAudioTrack(pistaSom, undefined, true) : null,
  };
  tela = nova;
  pistaVideo.addEventListener('ended', () => { if (tela === nova) pararTela().catch(() => {}); });
  try {
    await room.localParticipant.publishTrack(nova.video, opcoesPublicacaoTela(LK, q));
    if (nova.som) {
      await room.localParticipant.publishTrack(nova.som, {
        source: LK.Track.Source.ScreenShareAudio,
        audioPreset: LK.AudioPresets.musicHighQualityStereo,
        dtx: false,
        red: false,
      });
    }
  } catch (erro) {
    console.error('Exilados: a tela não foi publicada:', erro);
    if (tela === nova) await pararTela();
    throw new Error('Não deu para compartilhar a tela agora. Tente de novo.');
  }
  if (tela !== nova) return false;
  voz.tela = { qualidade, som: Boolean(nova.som) };
  preferencias().qualidadeTela = qualidade;
  guardar();
  atualizarPresenca({ tela: true });
  mudou();
  avisar('telas');
  return true;
}

export async function pararTela({ trocando = false } = {}) {
  if (!tela) return;
  const t = tela;
  tela = null;
  if (!trocando) {
    const estavaNoAr = Boolean(voz.tela);
    voz.tela = null;
    if (estavaNoAr && voz.sala) atualizarPresenca({ tela: false });
    mudou();
    avisar('telas');
  }
  const participante = sala?.localParticipant;
  for (const faixa of [t.video, t.som]) {
    if (!faixa) continue;
    if (participante?.getTrackPublications().some((p) => p.track === faixa)) {
      await participante.unpublishTrack(faixa, true).catch(() => {});
    }
    faixa.stop();
  }
  t.fluxo.getTracks().forEach((p) => p.stop());
}

function receberTelaDe(id, sim) {
  const participante = sala?.remoteParticipants.get(id);
  if (!participante) return;
  for (const pub of participante.trackPublications.values()) {
    if (!ehDaTela(pub)) continue;
    if (sim && pub.source === LK.Track.Source.ScreenShare) pub.setVideoQuality(qualidadeRecebida(LK, CELULAR, pub.simulcasted));
    pub.setSubscribed(sim);
  }
}

/** Pede de novo só o vídeo quando a faixa chegou, mas nenhum quadro foi decodificado. */
export function reinscreverVideoDaTela(id) {
  const room = sala;
  const pub = room?.remoteParticipants.get(id)?.getTrackPublication(LK.Track.Source.ScreenShare);
  if (!pub || voz.assistindo !== id) return;
  pub.setSubscribed(false);
  setTimeout(() => {
    if (sala === room && voz.assistindo === id) {
      pub.setVideoQuality(qualidadeRecebida(LK, CELULAR, pub.simulcasted));
      pub.setSubscribed(true);
    }
  }, 200);
}

export function iniciarVideo() {
  return sala?.startVideo();
}

/** Abre a tela de `id` (precisa estar na mesma sala de voz). Só uma por vez, como no Discord. */
export function assistirTela(id) {
  if (!sala || voz.assistindo === id) return;
  const antes = voz.assistindo;
  voz.assistindo = id;
  if (antes) receberTelaDe(antes, false);
  receberTelaDe(id, true);
  atualizarPresenca({ assistindo: id === meuId() ? null : id });
  avisar('telas');
}

export function pararDeAssistir() {
  if (!voz.assistindo) return;
  const antes = voz.assistindo;
  voz.assistindo = null;
  receberTelaDe(antes, false);
  if (voz.sala) atualizarPresenca({ assistindo: null });
  avisar('telas');
}

/**
 * O que se sabe da tela de `id` nesta sala: null se ela não está no ar aqui; senão { video, temSom, propria }, com
 * `video` (faixa do LiveKit) ainda null enquanto o vídeo não chegou.
 */
export function telaDe(id) {
  if (!sala) return null;
  if (id === meuId()) return tela && voz.tela ? { video: tela.video, temSom: false, propria: true } : null;
  const participante = sala.remoteParticipants.get(id);
  const pubVideo = participante?.getTrackPublication(LK.Track.Source.ScreenShare);
  if (!pubVideo) return null;
  const pubSom = participante.getTrackPublication(LK.Track.Source.ScreenShareAudio);
  return { video: pubVideo.isSubscribed ? pubVideo.track || null : null, temSom: Boolean(pubSom), propria: false };
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

// No Android a saída acompanha o microfone escolhido (a rota da chamada); lá não há o que escolher à parte.
export const saidaDisponivel = () => !ANDROID && typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

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
  if (!sala) return;
  // Na sala sem microfone (ele falhou antes): tenta abrir e publicar o escolhido.
  if (!microfone?.trilha) {
    microfone = await abrirMicrofone();
    await publicarMicrofone();
    return;
  }
  const novo = await abrirMicrofone();
  try {
    await microfone.trilha.replaceTrack(novo.faixa, { userProvidedTrack: true });
  } catch (falha) {
    fecharMicrofone(novo);
    throw falha;
  }
  const velho = microfone;
  microfone = { ...novo, trilha: velho.trilha };
  fecharMicrofone(velho);
  if (voz.mudo || voz.surdo) await microfone.trilha.mute();
  mudou();
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

/** Troca o filtro de ruído na hora, mantendo a publicação de voz na sala. */
export async function definirCancelamentoRuido(ligado) {
  const p = preferencias();
  const anterior = p.cancelamentoRuido;
  p.cancelamentoRuido = Boolean(ligado);
  guardar();
  if (!microfone?.trilha) return;
  try {
    await definirEntrada(p.entrada);
  } catch (falha) {
    p.cancelamentoRuido = anterior;
    guardar();
    throw falha;
  }
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
