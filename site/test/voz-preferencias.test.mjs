import test from 'node:test';
import assert from 'node:assert/strict';

const gravado = new Map();
globalThis.window = {
  supabase: { createClient: () => ({ auth: {} }) },
  addEventListener() {},
};
globalThis.document = { addEventListener() {} };
globalThis.localStorage = {
  getItem: (chave) => gravado.get(chave) || null,
  setItem: (chave, valor) => gravado.set(chave, valor),
};
const chave = 'exilados-voz-undefined';

function navegador(userAgent) {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
}

test('EXE usa a saída estéreo padrão uma vez e limita o volume direto a 100%', async () => {
  navegador('Windows');
  window.exiladosPrograma = { versao: 'teste' };
  gravado.set(chave, JSON.stringify({ saida: 'saída de chamada antiga', volumeSaida: 150 }));
  const voz = await import('../js/voz.js?teste-exe');
  assert.equal(voz.VOLUME_MAXIMO, 100);
  assert.equal(voz.preferencias().saida, null);
  assert.equal(voz.volumeEfetivo('outro'), 1);
  assert.equal(JSON.parse(gravado.get(chave)).saida, null);
});

test('Android começa com filtragem forte e som direto', async () => {
  navegador('Android');
  delete window.exiladosPrograma;
  gravado.set(chave, '{}');
  const voz = await import('../js/voz.js?teste-android');
  assert.equal(voz.ANDROID, true);
  assert.equal(voz.VOLUME_MAXIMO, 100);
  assert.equal(voz.preferencias().ruidoForte, true);
});

test('navegador no computador mantém a escolha de saída e o ganho de até 200%', async () => {
  navegador('Windows');
  gravado.set(chave, JSON.stringify({ saida: 'saída escolhida' }));
  const voz = await import('../js/voz.js?teste-navegador');
  assert.equal(voz.VOLUME_MAXIMO, 200);
  assert.equal(voz.preferencias().saida, 'saída escolhida');
});
