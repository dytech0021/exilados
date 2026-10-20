import assert from 'node:assert/strict';
import test from 'node:test';
import { faltaSomDaTela } from '../js/som-tela.js';

const fluxo = (sons) => ({ getAudioTracks: () => Array.from({ length: sons }, () => ({ kind: 'audio' })) });
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

test('no Windows, tela escolhida sem a chave de som não pode ir ao ar', () => {
  assert.equal(faltaSomDaTela(fluxo(0), WINDOWS), true);
});

test('no Windows, tela com som vai ao ar', () => {
  assert.equal(faltaSomDaTela(fluxo(1), WINDOWS), false);
});

test('onde o navegador não oferece o som do sistema (Mac), a tela vai mesmo sem som', () => {
  assert.equal(faltaSomDaTela(fluxo(0), MAC), false);
});
