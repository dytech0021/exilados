import test from 'node:test';
import assert from 'node:assert/strict';
import { opcoesPublicacaoTela, qualidadeRecebida } from '../js/qualidade-tela.js';

const lk = {
  Track: { Source: { ScreenShare: 'screen_share' } },
  VideoPresets: {
    h360: { width: 640, height: 360 },
    h720: { width: 1280, height: 720 },
  },
  VideoQuality: { LOW: 0, HIGH: 2 },
};

test('uma tela 1080p oferece resolução leve para o celular sem perder a original', () => {
  const opcoes = opcoesPublicacaoTela(lk, { largura: 1920, altura: 1080, bitrate: 6_000_000, fps: 60 });
  assert.equal(opcoes.simulcast, true);
  assert.equal(opcoes.screenShareEncoding.maxBitrate, 6_000_000);
  assert.deepEqual(opcoes.screenShareSimulcastLayers, [lk.VideoPresets.h360, lk.VideoPresets.h720]);
  assert.equal(qualidadeRecebida(lk, true, true), lk.VideoQuality.LOW);
  assert.equal(qualidadeRecebida(lk, false, true), lk.VideoQuality.HIGH);
  assert.equal(qualidadeRecebida(lk, true, false), lk.VideoQuality.HIGH);
});

test('uma tela 720p oferece alternativa leve sem duplicar a resolução original', () => {
  const opcoes = opcoesPublicacaoTela(lk, { largura: 1280, altura: 720, bitrate: 2_500_000, fps: 30 });
  assert.deepEqual(opcoes.screenShareSimulcastLayers, [lk.VideoPresets.h360]);
});
