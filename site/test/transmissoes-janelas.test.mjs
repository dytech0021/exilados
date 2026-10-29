import assert from 'node:assert/strict';
import test from 'node:test';
import { Elemento, instalarDom } from '../test-support/dom-video.mjs';
const app = instalarDom();
const { montarTela, fecharTela, telasAbertas } = await import('../js/tela.js');
const { montarLive, fecharTodasLives, haLivesAbertas } = await import('../js/live.js');

const janelas = () => app.children.filter((e) => e.className === 'janela-live');

test('abrir duas telas conserva a conversa e reabrir foca a janela existente', () => {
  const conversa = new Elemento();
  const mensagem = new Elemento(); conversa.append(mensagem);
  try {
    montarTela(conversa, 'a', () => assert.fail('abrir uma transmissão não navega'));
    montarTela(conversa, 'b', () => assert.fail('abrir uma transmissão não navega'));
    assert.equal(conversa.children[0], mensagem);
    assert.equal(janelas().length, 2);
    assert.deepEqual(telasAbertas(), ['a', 'b']);
    const primeira = janelas()[0];
    montarTela(new Elemento(), 'a', () => {});
    assert.equal(janelas().length, 2);
    assert.equal(primeira.dataset.foco, 'true');
    primeira.children[0].children.at(-1).dispatchEvent(new Event('click'));
    assert.deepEqual(telasAbertas(), ['b']);
    assert.equal(janelas().length, 1);
  } finally { fecharTela(); }
  assert.equal(janelas().length, 0);
});

test('cada live abre flutuando e continua aberta ao abrir outra live', () => {
  const conversa = new Elemento();
  const mensagem = new Elemento(); conversa.append(mensagem);
  try {
    montarLive(conversa, 'a', () => assert.fail('abrir uma live não navega'));
    montarLive(conversa, 'b', () => assert.fail('abrir uma live não navega'));
    assert.equal(conversa.children[0], mensagem);
    assert.equal(janelas().length, 2);
    montarLive(new Elemento(), 'a', () => {});
    assert.equal(janelas().length, 2);
    assert.equal(janelas()[0].dataset.foco, 'true');
    janelas()[0].children[0].children.at(-1).dispatchEvent(new Event('click'));
    assert.equal(janelas().length, 1);
    assert.equal(haLivesAbertas(), true);
  } finally { fecharTodasLives(); }
  assert.equal(haLivesAbertas(), false);
  assert.equal(janelas().length, 0);
});

test('a janela mantém acesso ao volume geral das telas, inclusive quando estava salvo em zero', async () => {
  const voz = await import('../js/voz.js');
  voz.definirVolumeDaTela(0);
  try {
    montarTela(new Elemento(), 'a');
    montarTela(new Elemento(), 'b');
    const controles = janelas().map((janela) => janela.children[1].children[2].children.find((e) => e.tagName === 'input'));
    assert.ok(controles.every(Boolean), 'as janelas precisam manter o controle de volume das transmissões');
    assert.equal(Number(controles[0].value), 0);
    controles[0].value = 75;
    controles[0].dispatchEvent(new Event('input'));
    assert.equal(voz.volumeDaTela(), 75);
    assert.equal(Number(controles[1].value), 75);
  } finally { fecharTela(); voz.definirVolumeDaTela(100); }
});

test('o volume da transmissão fica sempre à mão, mesmo antes de o som da tela chegar', () => {
  try {
    montarTela(new Elemento(), 'a');
    const barra = janelas()[0].children[1].children[2];
    const volume = barra.children.find((e) => e.tagName === 'input');
    const silenciar = barra.children.find((e) => e.className?.includes('botao-icone'));
    assert.equal(volume.hidden, false, 'o controle de volume não pode sumir da janela');
    assert.equal(silenciar.hidden, false, 'o botão de silenciar não pode sumir da janela');
  } finally { fecharTela(); }
});
