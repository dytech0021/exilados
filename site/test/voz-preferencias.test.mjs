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

test('EXE usa a saída estéreo padrão uma vez', async () => {
  navegador('Windows');
  window.exiladosPrograma = { versao: 'teste' };
  gravado.set(chave, JSON.stringify({ saida: 'saída de chamada antiga', volumeSaida: 150 }));
  const voz = await import('../js/voz.js?teste-exe');
  assert.equal(voz.preferencias().saida, null);
  assert.equal(voz.volumeEfetivo('outro'), 1.5);
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

test('o cancelamento de ruído (RNNoise) começa desligado', async () => {
  navegador('Windows');
  gravado.set(chave, '{}');
  const voz = await import('../js/voz.js?teste-ruido-novo');
  assert.equal(voz.preferencias().cancelamentoRuido, false);
});

test('quem tinha o cancelamento de ruído ligado passa para desligado uma vez; depois vale a escolha', async () => {
  navegador('Windows');
  gravado.set(chave, JSON.stringify({ cancelamentoRuido: true }));
  const antes = await import('../js/voz.js?teste-ruido-antigo');
  assert.equal(antes.preferencias().cancelamentoRuido, false);
  assert.equal(JSON.parse(gravado.get(chave)).cancelamentoRuido, false);

  const religado = JSON.parse(gravado.get(chave));
  religado.cancelamentoRuido = true;
  gravado.set(chave, JSON.stringify(religado));
  const depois = await import('../js/voz.js?teste-ruido-religado');
  assert.equal(depois.preferencias().cancelamentoRuido, true);
});

test('microfone e saída escolhidos antes voltam uma vez ao padrão do Windows', async () => {
  navegador('Windows');
  delete window.exiladosPrograma;
  gravado.set(chave, JSON.stringify({ entrada: 'microfone da webcam', saida: 'monitor HDMI' }));
  const voz = await import('../js/voz.js?teste-aparelhos-antigos');
  assert.equal(voz.preferencias().entrada, null);
  assert.equal(voz.preferencias().saida, null);
  const salvo = JSON.parse(gravado.get(chave));
  assert.equal(salvo.entrada, null);
  assert.equal(salvo.saida, null);
});

test('a porta de voz vem desligada, e quem estava com ela ligada fica sem ela uma vez', async () => {
  navegador('Windows');
  delete window.exiladosPrograma;
  const salvo = JSON.parse(gravado.get(chave));
  salvo.portaDeVoz = true;
  delete salvo.porta1021; // como quem ligou a porta na versão de antes
  gravado.set(chave, JSON.stringify(salvo));
  const voz = await import('../js/voz.js?teste-porta');
  assert.equal(voz.preferencias().portaDeVoz, false);
  assert.equal(JSON.parse(gravado.get(chave)).portaDeVoz, false);
});

test('no programa do Windows, o volume de cada pessoa vai até 200%', async () => {
  navegador('Windows');
  window.exiladosPrograma = { versao: 'teste' };
  try {
    const voz = await import('../js/voz.js?teste-exe-200');
    assert.equal(voz.VOLUME_MAXIMO, 200);
  } finally {
    delete window.exiladosPrograma;
  }
});

test('navegador no computador mantém a escolha de saída feita depois e o ganho de até 200%', async () => {
  navegador('Windows');
  const salvo = JSON.parse(gravado.get(chave));
  salvo.saida = 'saída escolhida';
  gravado.set(chave, JSON.stringify(salvo));
  const voz = await import('../js/voz.js?teste-navegador');
  assert.equal(voz.VOLUME_MAXIMO, 200);
  assert.equal(voz.preferencias().saida, 'saída escolhida');
});
