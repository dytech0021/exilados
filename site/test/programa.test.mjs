import assert from 'node:assert/strict';
import test from 'node:test';
import { criarPonte } from '../js/programa.js';

// O mesmo formato do window.chrome.webview do WebView2: eventos "message" com data e postMessage(objeto).
class PonteFalsa extends EventTarget {
  enviadas = [];

  postMessage(mensagem) {
    this.enviadas.push(mensagem);
  }

  receber(data) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const respostas = { sessao: async () => null, ocupado: () => false };

test('a atualização pronta que o programa avisa chega a quem acompanha', () => {
  const ponte = new PonteFalsa();
  const programa = criarPonte(ponte, { versao: '1.0.4' });
  const vistas = [];
  programa.quandoAtualizacao((versao) => vistas.push(versao));
  programa.iniciar(respostas);
  ponte.receber({ tipo: 'atualizacao', versao: '1.0.5' });
  ponte.receber({ tipo: 'atualizacao', versao: null });
  assert.deepEqual(vistas, ['1.0.5', null]);
});

test('quem passa a acompanhar depois do aviso recebe a atualização que já está pronta', () => {
  const ponte = new PonteFalsa();
  const programa = criarPonte(ponte, { versao: '1.0.4' });
  programa.iniciar(respostas);
  ponte.receber({ tipo: 'atualizacao', versao: '1.0.5' });
  const vistas = [];
  programa.quandoAtualizacao((versao) => vistas.push(versao));
  assert.deepEqual(vistas, ['1.0.5']);
});

test('atualizar pede ao programa para reiniciar na versão nova', () => {
  const ponte = new PonteFalsa();
  const programa = criarPonte(ponte, { versao: '1.0.4' });
  programa.iniciar(respostas);
  programa.atualizar();
  assert.deepEqual(ponte.enviadas, [{ tipo: 'pronto' }, { tipo: 'atualizar' }]);
});

test('continua respondendo se a pessoa está ocupada e qual é o login', async () => {
  const ponte = new PonteFalsa();
  const programa = criarPonte(ponte, { versao: '1.0.4' });
  programa.iniciar({ sessao: async () => ({ token: 't', usuario: 'u', email: 'e', nome: 'Dyego' }), ocupado: () => true });
  ponte.receber({ tipo: 'ocupado', id: 7 });
  ponte.receber({ tipo: 'sessao', id: 8 });
  await new Promise((pronto) => setTimeout(pronto, 0));
  assert.deepEqual(ponte.enviadas.slice(1), [
    { tipo: 'resposta', id: 7, ocupado: true },
    { tipo: 'resposta', id: 8, token: 't', usuario: 'u', email: 'e', nome: 'Dyego' },
  ]);
});

test('fora do programa nada é enviado e não há atualização', () => {
  const programa = criarPonte(undefined, undefined);
  const vistas = [];
  programa.quandoAtualizacao((versao) => vistas.push(versao));
  programa.iniciar(respostas);
  programa.atualizar();
  programa.abrirTransmitir();
  assert.equal(programa.noPrograma, false);
  assert.equal(programa.versao, null);
  assert.deepEqual(vistas, []);
});
