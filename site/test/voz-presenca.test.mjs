import test from 'node:test';
import assert from 'node:assert/strict';

class Elemento {
  children = [];
  setAttribute() {}
  addEventListener() {}
  append(...filhos) { this.children.push(...filhos); }
  remove() {}
}
globalThis.Node = Elemento;
globalThis.window = { supabase: { createClient: () => ({ auth: {} }) }, addEventListener() {} };
globalThis.document = {
  addEventListener() {},
  getElementById: () => new Elemento(),
  createElement: () => new Elemento(),
  createElementNS: () => new Elemento(),
};
globalThis.localStorage = { getItem: () => '{"anunciarEntradas":false}', setItem() {} };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Windows', mediaDevices: {
  getUserMedia: async () => { throw new Error('sem microfone no teste'); },
} }, configurable: true });

const { estado, ouvir } = await import('../js/estado.js');
const { atualizarPresenca, quemNaSala } = await import('../js/dados.js');
const { api } = await import('../js/supa.js');
const { alternarSurdo, assistirTela, definirAnunciarEntradas, entrar, sair, voz } = await import('../js/voz.js');
const { contarAssistindo } = await import('../js/presenca.js');

function criarSalaDeTeste(participantes = []) {
  let room;
  class Room {
    remoteParticipants = new Map(participantes.map((identity) => [identity, {
      identity, trackPublications: new Map(), getTrackPublication() { return null; },
    }]));
    eventos = new Map();
    constructor() { room = this; }
    on(evento, fn) { this.eventos.set(evento, fn); return this; }
    async connect() {}
    async disconnect() {}
    async startAudio() {}
  }
  window.LivekitClient = {
    Room, RoomEvent: new Proxy({}, { get: (_, nome) => nome }),
    Track: { Source: { ScreenShare: 'tela', ScreenShareAudio: 'som-tela' } },
  };
  return () => room;
}

async function esvaziarPromessas() {
  for (let i = 0; i < 300; i++) await Promise.resolve();
}

test('a saída local some e avisa antes de qualquer confirmação da presença remota', () => {
  estado.eu = { id: 'eu' };
  estado.vozServidor = { quando: Date.now(), salas: { s1: ['eu'] } };
  atualizarPresenca({ voz: 's1' });
  assert.deepEqual(quemNaSala('s1'), ['eu']);
  let visto;
  const parar = ouvir('presenca', () => { visto = quemNaSala('s1'); });
  atualizarPresenca({ voz: null });
  parar();
  assert.deepEqual(visto, []);
  assert.deepEqual(quemNaSala('s1'), []);
});

test('o narrador prepara até 12 membros em sequência e cancela áudio ao desativar, ensurdecer ou sair', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const obterSala = criarSalaDeTeste();
  const tocados = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src; tocados.push(this); }
    async play() {}
    pause() { this.pausado = true; }
    removeAttribute() {}
  };
  const pedidos = [];
  let resolverPendente;
  api.chamar = async (caminho, dados) => {
    if (caminho === '/voz/entrar') return { url: 'teste', token: 'teste' };
    pedidos.push(dados);
    if (dados.usuario === 'pendente') return new Promise((resolve) => { resolverPendente = resolve; });
    return { audio: 'UklGRg==' }; // base64 de verdade: o áudio vira blob: para tocar
  };
  estado.eu = { id: 'eu' };
  estado.membros = new Map(Array.from({ length: 14 }, (_, i) => [`m${i}`, { user_id: `m${i}`, nome: `Membro ${i}`, ativo: true }]));
  definirAnunciarEntradas(true);
  await entrar('s1');
  const room = obterSala();
  await esvaziarPromessas();
  try {
    assert.equal(pedidos.length, 24);
    // A ordem é sorteada (cada aparelho gera nomes diferentes); cada membro vem com a entrada e a saída juntas.
    assert.deepEqual(pedidos.slice(0, 2).map((p) => p.evento), ['entrou', 'saiu']);
    assert.equal(pedidos[0].usuario, pedidos[1].usuario);
    assert.equal(new Set(pedidos.map((p) => p.usuario)).size, 12);
    assert.equal(tocados.length, 0);
    room.eventos.get('ParticipantConnected')({ identity: 'm0' });
    await esvaziarPromessas();
    assert.equal(tocados.length, 1);
    definirAnunciarEntradas(false);
    assert.equal(tocados[0].pausado, true);
    definirAnunciarEntradas(true);
    room.eventos.get('ParticipantDisconnected')({ identity: 'm0' });
    await esvaziarPromessas();
    assert.equal(tocados.length, 2);
    await alternarSurdo();
    assert.equal(tocados[1].pausado, true);
    await alternarSurdo();
    room.eventos.get('ParticipantConnected')({ identity: 'pendente' });
    await esvaziarPromessas();
    assert.equal(typeof resolverPendente, 'function');
    await sair();
    resolverPendente({ audio: 'audio-atrasado' });
    await esvaziarPromessas();
    assert.equal(tocados.length, 2);
  } finally {
    definirAnunciarEntradas(false);
    await sair();
    delete globalThis.Audio;
  }
});

test('os eventos LiveKit removem e acrescentam participantes sem esperar a presença ou a consulta HTTP', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const participante = (identity) => ({ identity, trackPublications: new Map() });
  let room;
  class Room {
    remoteParticipants = new Map([['antigo', participante('antigo')]]);
    eventos = new Map();
    constructor() { room = this; }
    on(evento, fn) { this.eventos.set(evento, fn); return this; }
    async connect() {}
    async disconnect() {}
    async startAudio() {}
  }
  window.LivekitClient = { Room, RoomEvent: new Proxy({}, { get: (_, nome) => nome }) };
  api.chamar = async () => ({ url: 'teste', token: 'teste' });
  estado.eu = { id: 'eu' };
  estado.presenca = new Map([['antigo', { voz: 's1', desde: Date.now() }]]);
  estado.vozServidor = { quando: Date.now(), salas: { s1: ['eu', 'antigo'] } };
  await entrar('s1');
  try {
    assert.deepEqual(quemNaSala('s1'), ['eu', 'antigo']);
    room.remoteParticipants.delete('antigo');
    room.eventos.get('ParticipantDisconnected')(participante('antigo'));
    assert.deepEqual(quemNaSala('s1'), ['eu']);
    room.remoteParticipants.set('novo', participante('novo'));
    room.eventos.get('ParticipantConnected')(participante('novo'));
    assert.deepEqual(quemNaSala('s1'), ['eu', 'novo']);
    await sair();
    assert.equal(estado.vozLocal, null);
    assert.equal(quemNaSala('s1').includes('eu'), false);
    // Eventos tardios de uma conexão antiga não recolocam a pessoa depois de sair.
    room.eventos.get('ParticipantConnected')(participante('tardio'));
    assert.equal(estado.vozLocal, null);
  } finally {
    await sair();
  }
});

test('uma tela já aberta mantém a contagem de espectador ao entrar na sala dela', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  criarSalaDeTeste(['transmissor']);
  definirAnunciarEntradas(false);
  api.chamar = async () => ({ url: 'teste', token: 'teste' });
  estado.eu = { id: 'eu' };
  // Como a janela da tela: ao observar a sala conectada, pede a assinatura da transmissão.
  const parar = ouvir('presenca', () => {
    if (voz.situacao === 'conectada') assistirTela('transmissor');
  });
  try {
    await entrar('sala-da-tela');
    assert.equal(estado.presenca.get('eu').assistindo, 'transmissor');
    assert.equal(contarAssistindo(estado.presenca, 'transmissor'), 1);
  } finally {
    parar();
    await sair();
  }
});
