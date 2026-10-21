import assert from 'node:assert/strict';
import test from 'node:test';
import { montagemDaVoz } from '../js/montagem-voz.js';

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
