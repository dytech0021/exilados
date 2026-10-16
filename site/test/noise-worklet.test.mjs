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
