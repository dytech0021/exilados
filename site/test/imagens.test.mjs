import assert from 'node:assert/strict';
import test from 'node:test';
import { conferirArquivo, recorteQuadrado, tamanhoAlvo } from '../js/imagens.js';

test('reduz pelo lado maior até 1600 e nunca aumenta', () => {
  assert.deepEqual(tamanhoAlvo(4000, 3000, 1600), { largura: 1600, altura: 1200 });
  assert.deepEqual(tamanhoAlvo(1080, 2400, 1600), { largura: 720, altura: 1600 });
  assert.deepEqual(tamanhoAlvo(800, 600, 1600), { largura: 800, altura: 600 });
  assert.deepEqual(tamanhoAlvo(5000, 2, 1600), { largura: 1600, altura: 1 });
});

test('foto de perfil: quadrado do meio', () => {
  assert.deepEqual(recorteQuadrado(400, 300), { x: 50, y: 0, lado: 300 });
  assert.deepEqual(recorteQuadrado(300, 500), { x: 0, y: 100, lado: 300 });
});

test('recusa o que não é imagem e originais acima de 15 MB', () => {
  assert.equal(conferirArquivo({ type: 'application/pdf', size: 10 }), 'Esse arquivo não é uma imagem.');
  assert.equal(conferirArquivo({ type: 'image/png', size: 16 * 1024 * 1024 }), 'A imagem passa de 15 MB.');
  assert.equal(conferirArquivo({ type: 'image/jpeg', size: 3 * 1024 * 1024 }), null);
  assert.equal(conferirArquivo(null), 'Esse arquivo não é uma imagem.');
});
