import assert from 'node:assert/strict';
import test from 'node:test';
import { mover, redimensionar } from '../js/flutuante.js';

const tela = { largura: 1280, altura: 800 };
const origem = { x: 300, y: 120, largura: 480, alturaVideo: 270 };

test('a borda direita muda só a largura e a inferior muda só a altura', () => {
  assert.deepEqual(redimensionar(origem, 'e', 100, 80, tela), { x: 300, y: 120, largura: 580, alturaVideo: 270 });
  assert.deepEqual(redimensionar(origem, 's', 100, 80, tela), { x: 300, y: 120, largura: 480, alturaVideo: 350 });
});

test('os quatro cantos redimensionam os dois eixos sem prender a proporção', () => {
  const esperados = {
    nw: { x: 400, y: 160, largura: 380, alturaVideo: 230 },
    ne: { x: 300, y: 160, largura: 580, alturaVideo: 230 },
    sw: { x: 400, y: 120, largura: 380, alturaVideo: 310 },
    se: { x: 300, y: 120, largura: 580, alturaVideo: 310 },
  };
  for (const [canto, esperado] of Object.entries(esperados)) assert.deepEqual(redimensionar(origem, canto, 100, 40, tela), esperado);
});

test('bordas norte e oeste mantêm a borda oposta fixa e respeitam o tamanho mínimo', () => {
  assert.deepEqual(redimensionar(origem, 'nw', 1000, 1000, tela), { x: 540, y: 270, largura: 240, alturaVideo: 120 });
});

test('redimensionamento e movimento respeitam os quatro limites visíveis', () => {
  assert.deepEqual(redimensionar(origem, 'se', 2000, 2000, tela), { x: 300, y: 120, largura: 972, alturaVideo: 640 });
  assert.deepEqual(redimensionar(origem, 'nw', -2000, -2000, tela), { x: 8, y: 8, largura: 772, alturaVideo: 382 });
  assert.deepEqual(mover(origem, 2000, 2000, tela), { x: 792, y: 490, largura: 480, alturaVideo: 270 });
});
