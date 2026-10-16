import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('a política do site permite compilar o RNNoise em WebAssembly', () => {
  const nginx = readFileSync(new URL('../../servidor/nginx-exilados.conf', import.meta.url), 'utf8');
  const politica = nginx.match(/add_header Content-Security-Policy "([^"]+)"/)?.[1];
  assert.ok(politica);
  const scripts = politica.split(';').map((item) => item.trim()).find((item) => item.startsWith('script-src '));
  assert.match(scripts || '', /(?:^|\s)'wasm-unsafe-eval'(?:\s|$)/);
});
