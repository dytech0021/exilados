import test from 'node:test';
import assert from 'node:assert/strict';
import { opcoesPublicacaoTela, qualidadeRecebida } from '../js/qualidade-tela.js';

const lk = {
  Track: { Source: { ScreenShare: 'screen_share' } },
  VideoPresets: {
    h360: { width: 640, height: 360 },
    h720: { width: 1280, height: 720 },
  },
  VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 },
};

test('várias telas abertas vêm em 720p cada; a que estiver em tela cheia, na qualidade máxima', () => {
  assert.equal(qualidadeRecebida(lk, false, true, { varias: true }), lk.VideoQuality.MEDIUM);
  assert.equal(qualidadeRecebida(lk, false, true, { varias: true, destaque: true }), lk.VideoQuality.HIGH);
  assert.equal(qualidadeRecebida(lk, false, true, { varias: false }), lk.VideoQuality.HIGH);
  // No celular continua a camada leve; sem camadas, a única que existe.
  assert.equal(qualidadeRecebida(lk, true, true, { varias: true, destaque: true }), lk.VideoQuality.LOW);
  assert.equal(qualidadeRecebida(lk, false, false, { varias: true }), lk.VideoQuality.HIGH);
});

test('uma tela 1080p vai só com a camada leve e a original (cada camada a mais é um codificador a mais no PC de quem transmite)', () => {
  const opcoes = opcoesPublicacaoTela(lk, { largura: 1920, altura: 1080, bitrate: 6_000_000, fps: 60 });
  assert.equal(opcoes.simulcast, true);
  assert.equal(opcoes.screenShareEncoding.maxBitrate, 6_000_000);
  assert.deepEqual(opcoes.screenShareSimulcastLayers, [lk.VideoPresets.h360]);
  assert.equal(qualidadeRecebida(lk, true, true), lk.VideoQuality.LOW);
  assert.equal(qualidadeRecebida(lk, false, true), lk.VideoQuality.HIGH);
  assert.equal(qualidadeRecebida(lk, true, false), lk.VideoQuality.HIGH);
});

test('uma tela 720p oferece alternativa leve sem duplicar a resolução original', () => {
  const opcoes = opcoesPublicacaoTela(lk, { largura: 1280, altura: 720, bitrate: 2_500_000, fps: 30 });
  assert.deepEqual(opcoes.screenShareSimulcastLayers, [lk.VideoPresets.h360]);
});

test('a camada segue o tamanho real da janela: janelinha pede 360p, janela média 720p, grande o máximo', () => {
  const camada = (largura, extra) => qualidadeRecebida(lk, false, true, { larguraVista: largura, ...extra });
  assert.equal(camada(480), lk.VideoQuality.LOW);
  assert.equal(camada(700), lk.VideoQuality.LOW);
  assert.equal(camada(900), lk.VideoQuality.MEDIUM);
  assert.equal(camada(1400), lk.VideoQuality.HIGH);
  // Numa tela de alta densidade, a mesma janela mostra mais pixels e pede mais.
  assert.equal(camada(500), lk.VideoQuality.LOW);
  assert.equal(camada(500, { densidade: 2 }), lk.VideoQuality.MEDIUM);
});

test('sem medida da janela, vale a regra de antes (várias abertas = 720p)', () => {
  assert.equal(qualidadeRecebida(lk, false, true, { varias: true }), lk.VideoQuality.MEDIUM);
  assert.equal(qualidadeRecebida(lk, false, true, {}), lk.VideoQuality.HIGH);
  // Tela cheia pede o máximo mesmo que a medida ainda seja a antiga.
  assert.equal(qualidadeRecebida(lk, false, true, { larguraVista: 400, destaque: true }), lk.VideoQuality.HIGH);
});

test('sem a camada do meio, a janela média recebe a original em vez de cair para 360p', () => {
  const media = { larguraVista: 1000 };
  assert.equal(qualidadeRecebida(lk, false, true, { ...media, camadas: 2 }), lk.VideoQuality.HIGH);
  // Quem ainda transmite com as 3 camadas (versão anterior do site) continua dando 720p na janela média.
  assert.equal(qualidadeRecebida(lk, false, true, { ...media, camadas: 3 }), lk.VideoQuality.MEDIUM);
  // Janelinha continua na leve, com 2 ou 3 camadas.
  assert.equal(qualidadeRecebida(lk, false, true, { larguraVista: 480, camadas: 2 }), lk.VideoQuality.LOW);
  // Várias abertas sem medida ainda: sem a do meio, a original.
  assert.equal(qualidadeRecebida(lk, false, true, { varias: true, camadas: 2 }), lk.VideoQuality.HIGH);
});
