import assert from 'node:assert/strict';
import test from 'node:test';
import { nomeComVersao, precisaRecarregar } from '../js/atualizacao-site.js';

test('o nome mostra a versão do programa (ou do app) e a do site', () => {
  assert.equal(nomeComVersao({ programa: '1.0.8', app: null, site: '43' }), 'Exilados 1.0.8 · site 43');
  assert.equal(nomeComVersao({ programa: null, app: '1.0.10', site: '43' }), 'Exilados 1.0.10 · site 43');
  assert.equal(nomeComVersao({ programa: null, app: null, site: '43' }), 'Exilados · site 43');
  assert.equal(nomeComVersao({ programa: null, app: null, site: 'dev' }), 'Exilados');
});

test('recarrega só quem está numa versão publicada mais velha que a mínima', () => {
  assert.equal(precisaRecarregar('42', 43), true);
  assert.equal(precisaRecarregar('43', 43), false);
  assert.equal(precisaRecarregar('44', 43), false);
  assert.equal(precisaRecarregar('42', 0), false);
  assert.equal(precisaRecarregar('dev', 43), false);
});
