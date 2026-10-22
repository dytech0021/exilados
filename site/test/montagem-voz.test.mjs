import assert from 'node:assert/strict';
import test from 'node:test';
import { modoDoEco, montagemDaVoz, restricaoDoMicrofone } from '../js/montagem-voz.js';

test('no computador, o cancelamento de eco usa o som do computador como referência (como no Discord)', () => {
  assert.equal(modoDoEco({ android: false, somDoComputador: true }), 'all');
});

test('desligado, ou no Android, o cancelamento de eco é o normal (só o som da chamada)', () => {
  assert.equal(modoDoEco({ android: false, somDoComputador: false }), true);
  assert.equal(modoDoEco({ android: true, somDoComputador: true }), true);
});

test('no Windows, sem escolha, o microfone é o de comunicação do Windows (o que ele usa em chamadas)', () => {
  assert.deepEqual(restricaoDoMicrofone({ entrada: null, windows: true }), { ideal: 'communications' });
  assert.deepEqual(restricaoDoMicrofone({ entrada: 'default', windows: true }), { ideal: 'communications' });
});

test('microfone escolhido é exigido; fora do Windows, sem escolha, o navegador decide', () => {
  assert.deepEqual(restricaoDoMicrofone({ entrada: 'abc123', windows: true }), { exact: 'abc123' });
  assert.deepEqual(restricaoDoMicrofone({ entrada: 'abc123', windows: false }), { exact: 'abc123' });
  assert.equal(restricaoDoMicrofone({ entrada: null, windows: false }), undefined);
});

test('no computador a voz passa pelo tratamento (compressor, reforço e limitador)', () => {
  assert.deepEqual(montagemDaVoz({ android: false, cancelamentoRuido: false, volumeEntrada: 100 }), { direto: false, tratamento: true });
  assert.deepEqual(montagemDaVoz({ android: false, cancelamentoRuido: true, volumeEntrada: 150 }), { direto: false, tratamento: true });
});

test('no Android, sem filtro e com volume 100%, a voz sai direto do microfone tratado pelo celular', () => {
  assert.deepEqual(montagemDaVoz({ android: true, cancelamentoRuido: false, volumeEntrada: 100 }), { direto: true, tratamento: false });
});

test('no Android, volume diferente de 100% ou filtro ligado passam pelo ganho, sem o tratamento do computador', () => {
  assert.deepEqual(montagemDaVoz({ android: true, cancelamentoRuido: false, volumeEntrada: 150 }), { direto: false, tratamento: false });
  assert.deepEqual(montagemDaVoz({ android: true, cancelamentoRuido: true, volumeEntrada: 100 }), { direto: false, tratamento: false });
});
