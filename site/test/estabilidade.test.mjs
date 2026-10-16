import assert from 'node:assert/strict';
import test from 'node:test';
import { vigiarVideo } from '../js/estabilidade.js';

test('uma pausa curta da live não derruba a sessão', () => {
  let vigia = vigiarVideo(null, { tempo: 10, agora: 0, ativo: true });
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 4000, ativo: true });
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 9000, ativo: true });
  assert.equal(vigia.reconectar, false);
  vigia = vigiarVideo(vigia, { tempo: 11, agora: 10000, ativo: true });
  assert.equal(vigia.reconectar, false);
});

test('só reconecta se o vídeo continuar parado por mais de 12 segundos', () => {
  let vigia = vigiarVideo(null, { tempo: 10, agora: 0, ativo: true });
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 2000, ativo: true });
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 13999, ativo: true });
  assert.equal(vigia.reconectar, false);
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 14000, ativo: true });
  assert.equal(vigia.reconectar, true);
});

test('aba oculta zera o atraso acumulado antes de voltar à live', () => {
  let vigia = vigiarVideo(null, { tempo: 10, agora: 0, ativo: true });
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 2000, ativo: true });
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 30000, ativo: false });
  vigia = vigiarVideo(vigia, { tempo: 10, agora: 32000, ativo: true });
  assert.equal(vigia.reconectar, false);
});
