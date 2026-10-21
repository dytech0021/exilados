import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('o processador RNNoise carrega e atenua ruído contínuo sem interromper o áudio', () => {
  let Processador;
  const codigo = readFileSync(new URL('../vendor/noise-worklet.js', import.meta.url), 'utf8');
  runInNewContext(codigo, {
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (nome, classe) => {
      assert.equal(nome, 'exilados-cancelamento-ruido');
      Processador = classe;
    },
    sampleRate: 48000,
    WebAssembly,
    atob,
    TextDecoder,
    TextEncoder,
    console,
  });
  assert.ok(Processador);
  const processador = new Processador();
  let semente = 7;
  let energiaEntrada = 0;
  let energiaSaida = 0;
  let contagem = 0;
  for (let bloco = 0; bloco < 750; bloco++) {
    const entrada = new Float32Array(128);
    const saida = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      semente = (1664525 * semente + 1013904223) >>> 0;
      entrada[i] = ((semente / 2 ** 32) * 2 - 1) * 0.06;
    }
    assert.equal(processador.process([[entrada]], [[saida]]), true);
    if (bloco < 250) continue; // espera o modelo se adaptar ao som constante
    for (let i = 0; i < 128; i++) {
      assert.ok(Number.isFinite(saida[i]));
      energiaEntrada += entrada[i] ** 2;
      energiaSaida += saida[i] ** 2;
      contagem++;
    }
  }
  assert.ok(contagem > 0);
  assert.ok(energiaSaida < energiaEntrada * 0.5, `Ruído permaneceu alto: ${energiaSaida / energiaEntrada}`);
  processador.port.onmessage({ data: 'parar' });
  assert.equal(processador.process([[new Float32Array(128)]], [[new Float32Array(128)]]), false);
});

test('o processamento em blocos não deixa buracos na voz depois de iniciar', () => {
  let Processador;
  const codigo = readFileSync(new URL('../vendor/noise-worklet.js', import.meta.url), 'utf8');
  runInNewContext(codigo, {
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_, classe) => { Processador = classe; },
    sampleRate: 48000, WebAssembly, atob, TextDecoder, TextEncoder, console,
  });
  const processador = new Processador();
  processador.wasm._rnnoise_process_frame = () => {}; // isola o transporte de amostras do modelo
  for (let bloco = 0; bloco < 100; bloco++) {
    const saida = new Float32Array(128);
    processador.process([[new Float32Array(128).fill(0.25)]], [[saida]]);
    if (bloco >= 8) assert.ok(saida.every((amostra) => amostra === 0.25), `Faltou áudio no bloco ${bloco}`);
  }
});

function processadorDaPorta(probabilidade) {
  let Processador;
  const codigo = readFileSync(new URL('../vendor/noise-worklet.js', import.meta.url), 'utf8');
  runInNewContext(codigo, {
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_, classe) => { Processador = classe; },
    sampleRate: 48000, WebAssembly, atob, TextDecoder, TextEncoder, console,
  });
  const processador = new Processador({ processorOptions: { porta: true } });
  // O detector de voz do RNNoise, simulado: a porta é que está em teste. Ele estraga o bloco (para provar que a
  // porta manda o som original, e não o processado).
  processador.wasm._rnnoise_process_frame = (_, saida) => {
    processador.wasm.HEAPF32.fill(0, saida >> 2, (saida >> 2) + 480);
    return probabilidade();
  };
  return processador;
}

function passar(processador, sinal) {
  const saida = new Float32Array(sinal.length);
  for (let i = 0; i + 128 <= sinal.length; i += 128) {
    const pedaco = new Float32Array(128);
    processador.process([[sinal.subarray(i, i + 128)]], [[pedaco]]);
    saida.set(pedaco, i);
  }
  return saida;
}

const onda = (n, amplitude) => Float32Array.from({ length: n }, (_, i) => amplitude * Math.cos(i / 7));
const rms = (a, de, ate) => Math.sqrt(a.subarray(de, ate).reduce((s, x) => s + x * x, 0) / (ate - de));
// O atraso fixo da porta (blocos do RNNoise e os 10 ms de antecipação): a primeira amostra que sai de uma fala contínua.
const atrasoDaPorta = () => passar(processadorDaPorta(() => 0.95), onda(9600, 0.1)).findIndex((x) => x !== 0);

test('porta de voz: a fala passa como chegou (sem o processamento do RNNoise)', () => {
  const sinal = onda(48000, 0.1);
  const saida = passar(processadorDaPorta(() => 0.95), sinal);
  const atraso = atrasoDaPorta();
  assert.ok(atraso > 0 && atraso <= 1600, `atraso ${atraso}`);
  for (let i = 4800; i < 40000; i += 997) assert.ok(Math.abs(saida[i] - sinal[i - atraso]) < 1e-6, `amostra ${i}`);
});

test('porta de voz: som que não é voz (música, tiros do jogo) não passa', () => {
  const saida = passar(processadorDaPorta(() => 0.05), onda(48000, 0.1));
  assert.ok(rms(saida, 24000, 48000) < 0.001, `vazou ${rms(saida, 24000, 48000)}`);
});

test('porta de voz: voz baixa (o jogo vazando do fone) não abre a porta', () => {
  const saida = passar(processadorDaPorta(() => 0.95), onda(48000, 0.004));
  assert.ok(rms(saida, 24000, 48000) < 0.0004, `vazou ${rms(saida, 24000, 48000)}`);
});

test('porta de voz: depois de ouvir a fala, um vazamento mais forte (bem abaixo da voz) também não passa', () => {
  // 2 s de fala (0,1) e depois 2 s de jogo vazando a 0,02: acima do limite fixo, mas 14 dB abaixo da voz.
  const sinal = Float32Array.from({ length: 192000 }, (_, i) => (i < 96000 ? 0.1 : 0.02) * Math.cos(i / 7));
  const saida = passar(processadorDaPorta(() => 0.95), sinal);
  assert.ok(rms(saida, 20000, 90000) > 0.05, 'cortou a fala');
  assert.ok(rms(saida, 130000, 192000) < 0.002, `vazou ${rms(saida, 130000, 192000)}`);
});

test('porta de voz: o começo da fala não é comido e a porta fecha depois que a fala acaba', () => {
  let n = 0;
  // Fala de 0,5 s a 1,0 s; antes e depois, só o "jogo" (não é voz).
  const sinal = Float32Array.from({ length: 96000 }, (_, i) => (i >= 24000 && i < 48000 ? 0.1 : 0.03) * Math.cos(i / 7));
  const saida = passar(processadorDaPorta(() => {
    const t = n++ * 480;
    return t >= 24000 && t < 48000 ? 0.95 : 0.05;
  }), sinal);
  const atraso = atrasoDaPorta();
  // Os primeiros 10 ms da fala já saem inteiros (a porta abre um bloco antes).
  assert.ok(rms(saida, 24000 + atraso, 24000 + atraso + 480) > 0.05, 'comeu o começo da fala');
  // Antes da fala, fechada; bem depois dela (passada a espera), fechada de novo.
  assert.ok(rms(saida, 4800, 22000) < 0.001, 'abriu antes da fala');
  assert.ok(rms(saida, 72000, 96000) < 0.001, 'não fechou depois da fala');
});

test('o filtro forte corta fala distante e mantém voz próxima sem silenciar a conversa', () => {
  let Processador;
  const codigo = readFileSync(new URL('../vendor/noise-worklet.js', import.meta.url), 'utf8');
  runInNewContext(codigo, {
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_, classe) => { Processador = classe; },
    sampleRate: 48000, WebAssembly, atob, TextDecoder, TextEncoder, console,
  });
  const processador = new Processador({ processorOptions: { limiarVoz: 0.02 } });
  processador.wasm._rnnoise_process_frame = () => 0.95; // ambas as fontes parecem voz ao modelo
  const medir = (amplitude, quanta) => {
    let energia = 0;
    for (let i = 0; i < quanta; i++) {
      const saida = new Float32Array(128);
      processador.process([[new Float32Array(128).fill(amplitude)]], [[saida]]);
      if (i >= quanta - 40) for (const amostra of saida) energia += amostra ** 2;
    }
    return Math.sqrt(energia / (40 * 128));
  };
  const distante = medir(0.004, 130);
  const perto = medir(0.06, 130);
  const distanteDepois = medir(0.004, 190);
  assert.ok(distante < 0.0004, `Som distante continuou: ${distante}`);
  assert.ok(perto > 0.045, `Voz próxima foi cortada: ${perto}`);
  assert.ok(distanteDepois < 0.0004, `Som distante voltou: ${distanteDepois}`);
});
