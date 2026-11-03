import test from 'node:test';
import assert from 'node:assert/strict';
import { limitarWebcam } from '../js/webcam-geometria.js';

test('mover e redimensionar a webcam sempre mantém o quadro dentro da transmissão', () => {
  for (const tamanho of [-999, 0, 15, 50, 100, 999, NaN]) {
    for (const posicao of [-999, 0, 50, 100, 999, NaN]) {
      const g = limitarWebcam({ x: posicao, y: posicao, largura: tamanho, altura: tamanho });
      assert.ok(g.x >= 0 && g.y >= 0);
      assert.ok(g.largura >= 15 && g.altura >= 15);
      assert.ok(g.x + g.largura <= 100 && g.y + g.altura <= 100);
    }
  }
});
