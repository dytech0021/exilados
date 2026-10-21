import assert from 'node:assert/strict';
import test from 'node:test';
import { desenhoDoQr } from '../js/qr.js';

const ENDERECO = 'https://filabox3d.com.br/exilados/atualizacao/Exilados.apk';

test('o QR tem a margem branca de 4 módulos em volta e os quadrados de canto no lugar', () => {
  const { lado, caminho } = desenhoDoQr(ENDERECO);
  // Versão 4 (33 módulos) para este endereço com correção média, mais 4 de margem de cada lado.
  assert.equal(lado, 33 + 8);
  // Canto de cima à esquerda: borda escura do quadrado de posição começa logo depois da margem...
  assert.ok(caminho.includes('M4 4h1v1h-1z'));
  assert.ok(caminho.includes('M10 4h1v1h-1z'));
  // ...e a coluna logo depois dele (separador) é clara.
  assert.ok(!caminho.includes('M11 4h1v1h-1z'));
  // Nada desenhado na margem.
  assert.ok(!caminho.includes('M3 '));
  assert.ok(!caminho.includes('M0 0'));
});
