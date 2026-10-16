import assert from 'node:assert/strict';
import test from 'node:test';
import { mover, redimensionar } from '../js/flutuante.js';

const tela = { largura: 1280, altura: 800 };
const origem = { x: 300, y: 120, largura: 480, alturaVideo: 270 };

test('arrastar qualquer canto mantém a proporção do vídeo', () => {
  for (const canto of ['nw', 'ne', 'sw', 'se']) {
    const r = redimensionar(origem, canto, 100, 40, 16 / 9, tela);
    assert.ok(Math.abs(r.largura / r.alturaVideo - 16 / 9) < 0.001);
    assert.ok(canto.includes('w') ? r.largura < origem.largura : r.largura > origem.largura);
    if (canto.includes('w')) assert.equal(r.x + r.largura, origem.x + origem.largura);
    else assert.equal(r.x, origem.x);
    if (canto.includes('n')) assert.equal(r.y + r.alturaVideo + 32, origem.y + origem.alturaVideo + 32);
    else assert.equal(r.y, origem.y);
  }
});

test('redimensionamento não ultrapassa a área visível', () => {
  const r = redimensionar(origem, 'se', 1000, 1000, 16 / 9, tela);
  assert.ok(r.largura > origem.largura);
  assert.ok(r.x + r.largura <= tela.largura - 8);
  assert.ok(r.y + r.alturaVideo + 32 <= tela.altura - 8);
  assert.ok(Math.abs(r.largura / r.alturaVideo - 16 / 9) < 0.001);
});

test('proporção vertical e movimento continuam dentro da tela', () => {
  const vertical = { x: 100, y: 100, largura: 270, alturaVideo: 480 };
  const maior = redimensionar(vertical, 'se', 90, 10, 9 / 16, tela);
  assert.ok(maior.largura > vertical.largura);
  assert.ok(Math.abs(maior.largura / maior.alturaVideo - 9 / 16) < 0.001);
  const noCanto = mover(maior, 2000, 2000, tela);
  assert.ok(noCanto.x + noCanto.largura <= tela.largura - 8);
  assert.ok(noCanto.y + noCanto.alturaVideo + 32 <= tela.altura - 8);
});
