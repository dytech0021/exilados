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
