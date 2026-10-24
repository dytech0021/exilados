import assert from 'node:assert/strict';
import test from 'node:test';

import { Elemento, instalarDom } from '../test-support/dom-video.mjs';
import { criarJanelaLive, modoDaJanela } from '../js/janela-live.js';

function ponteiro(alvo, tipo, x, y) {
  const evento = new Event(tipo, { cancelable: true });
  Object.assign(evento, { button: 0, pointerId: 1, clientX: x, clientY: y });
  alvo.dispatchEvent(evento);
}
const app = instalarDom();

test('duas transmissões ficam independentes ao mover, redimensionar e fechar uma janela', () => {
  let fechada = 0;
  const a = criarJanelaLive({ titulo: 'A', conteudo: new Elemento(), aoFechar: () => fechada++ });
  const b = criarJanelaLive({ titulo: 'B', conteudo: new Elemento(), aoFechar: () => {} });
  const antesB = { ...b.elemento.style };
  const antesA = { ...a.elemento.style };
  ponteiro(a.elemento.children[0], 'pointerdown', 500, 200);
  ponteiro(a.elemento.children[0], 'pointermove', 450, 250);
  ponteiro(a.elemento.children[0], 'pointerup', 450, 250);
  assert.equal(Number.parseInt(a.elemento.style.left), Number.parseInt(antesA.left) - 50);
  assert.equal(Number.parseInt(a.elemento.style.top), Number.parseInt(antesA.top) + 50);
  const direita = a.elemento.children.find((filho) => filho.dataset.borda === 'e');
  ponteiro(direita, 'pointerdown', 500, 200);
  ponteiro(direita, 'pointermove', 550, 280);
  ponteiro(direita, 'pointerup', 550, 280);
  assert.equal(a.elemento.style.height, antesA.height);
  assert.equal(Number.parseInt(a.elemento.style.width), Number.parseInt(antesA.width) + 50);
  assert.equal(b.elemento.style.left, antesB.left);
  assert.equal(b.elemento.style.width, antesB.width);
  assert.ok(Number(a.elemento.style.zIndex) > Number(b.elemento.style.zIndex));
  a.elemento.children[0].children.at(-1).dispatchEvent(new Event('click'));
  assert.equal(fechada, 1);
  a.destruir();
  assert.equal(a.elemento.parentNode, null);
  assert.equal(b.elemento.parentNode, app);
  b.destruir();
});

test('reduzir a viewport mantém as janelas acessíveis sem forçar proporção', () => {
  const a = criarJanelaLive({ titulo: 'A', conteudo: new Elemento(), aoFechar: () => {} });
  window.innerWidth = 320; window.innerHeight = 240;
  window.dispatchEvent(new Event('resize'));
  assert.equal(a.elemento.style.width, '304px');
  assert.equal(a.elemento.style.height, '224px');
  assert.equal(a.elemento.style.left, '8px');
  assert.equal(a.elemento.style.top, '8px');
  a.destruir();
});

test('no programa do Windows (1.0.9+) a transmissão já abre numa janela do sistema; antes dela, não', () => {
  assert.equal(modoDaJanela({ programa: { versao: '1.0.9' }, agente: 'Windows', ponteiroFino: true }), 'sistema');
  assert.equal(modoDaJanela({ programa: { versao: '1.1.0' }, agente: 'Windows', ponteiroFino: true }), 'sistema');
  assert.equal(modoDaJanela({ programa: { versao: '1.0.8' }, agente: 'Windows', ponteiroFino: true }), 'site');
});

test('no navegador do computador a janela fica no site, com o botão de destacar', () => {
  assert.equal(modoDaJanela({ programa: null, agente: 'Windows', ponteiroFino: true }), 'com-botao');
  assert.equal(modoDaJanela({ programa: null, agente: 'Macintosh', ponteiroFino: true }), 'com-botao');
});

test('no celular e no app Android não há janela separada', () => {
  assert.equal(modoDaJanela({ programa: null, agente: 'Android', ponteiroFino: false }), 'site');
  assert.equal(modoDaJanela({ programa: null, agente: 'iPhone', ponteiroFino: false }), 'site');
  assert.equal(modoDaJanela({ programa: null, agente: 'Windows', app: true, ponteiroFino: true }), 'site');
});
