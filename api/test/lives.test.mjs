import assert from 'node:assert/strict';
import test from 'node:test';
import { Lives, SEM_SINAL_MS } from '../src/lives.mjs';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const ANA = '11111111-1111-4111-8111-111111111111';
const BIA = '22222222-2222-4222-8222-222222222222';

function relogio(inicio = 1_000_000) {
  const r = { t: inicio, agora: () => r.t };
  return r;
}

test('comecar sorteia ex/ com 24 letras e números e uma senha de 256 bits', () => {
  const lives = new Lives({ segredo: SEGREDO });
  const live = lives.comecar(ANA);
  assert.match(live.caminho, /^ex\/[A-Za-z0-9]{24}$/);
  assert.match(live.senha, /^[0-9a-f]{64}$/);
  assert.equal(live.usuario, ANA);
  assert.equal(lives.donoDe(live.caminho), ANA);
  assert.notEqual(lives.comecar(BIA).caminho, live.caminho);
});

test('só a senha daquela live, com o usuário dela, envia', () => {
  const lives = new Lives({ segredo: SEGREDO });
  const a = lives.comecar(ANA);
  const b = lives.comecar(BIA);
  assert.equal(lives.podeEnviar(a.caminho, ANA, a.senha), true);
  assert.equal(lives.podeEnviar(a.caminho, ANA, b.senha), false);
  assert.equal(lives.podeEnviar(a.caminho, BIA, b.senha), false);
  assert.equal(lives.podeEnviar(b.caminho, BIA, b.senha), true);
  assert.equal(lives.podeEnviar(a.caminho, 'ponte', a.senha), false);
});

test('live nova encerra a anterior: a senha velha para de valer', () => {
  const lives = new Lives({ segredo: SEGREDO });
  const velha = lives.comecar(ANA);
  const nova = lives.comecar(ANA);
  assert.equal(lives.podeEnviar(velha.caminho, ANA, velha.senha), false);
  assert.equal(lives.podeEnviar(nova.caminho, ANA, nova.senha), true);
  assert.equal(lives.donoDe(velha.caminho), null);
});

test('parar encerra: nem enviar nem assistir', () => {
  const lives = new Lives({ segredo: SEGREDO });
  const live = lives.comecar(ANA);
  const leitura = lives.leitura(live.caminho);
  assert.equal(lives.parar(ANA), live.caminho);
  assert.equal(lives.podeEnviar(live.caminho, ANA, live.senha), false);
  assert.equal(lives.podeLer(live.caminho, leitura), false);
  assert.equal(lives.parar(ANA), null);
});

test('depois de reiniciar o serviço, a live que reconecta com a senha certa continua', () => {
  const antes = new Lives({ segredo: SEGREDO });
  const live = antes.comecar(ANA);
  const depois = new Lives({ segredo: SEGREDO });
  assert.equal(depois.podeEnviar(live.caminho, ANA, live.senha), true);
  assert.equal(depois.donoDe(live.caminho), ANA);
  assert.equal(new Lives({ segredo: 'outro-segredo-com-mais-de-32-caracteres!!' }).podeEnviar(live.caminho, ANA, live.senha), false);
});

test('permissão de assistir vale só para aquele caminho e só por alguns minutos', () => {
  const r = relogio();
  const lives = new Lives({ segredo: SEGREDO, agora: r.agora, leituraMs: 120000 });
  const a = lives.comecar(ANA);
  const b = lives.comecar(BIA);
  const token = lives.leitura(a.caminho);
  assert.equal(lives.podeLer(a.caminho, token), true);
  assert.equal(lives.podeLer(b.caminho, token), false);
  assert.equal(lives.podeLer(a.caminho, 'lixo'), false);
  assert.equal(lives.podeLer(a.caminho, ''), false);
  r.t += 10000;
  lives.sinal(ANA, a.caminho);
  r.t += 10000;
  lives.sinal(ANA, a.caminho);
  r.t += 101000;
  lives.sinal(ANA, a.caminho);
  assert.equal(lives.podeLer(a.caminho, token), false);
});

test('sem sinal de vida por mais de 20 s a live está encerrada para quem quer assistir', () => {
  const r = relogio();
  const lives = new Lives({ segredo: SEGREDO, agora: r.agora });
  const live = lives.comecar(ANA);
  r.t += SEM_SINAL_MS - 1000;
  assert.equal(lives.encerrada(live.caminho), false);
  assert.equal(lives.sinal(ANA, live.caminho), true);
  r.t += SEM_SINAL_MS + 1;
  assert.equal(lives.encerrada(live.caminho), true);
  assert.equal(lives.podeLer(live.caminho, lives.leitura(live.caminho)), false);
  assert.equal(lives.sinal(ANA, live.caminho), true);
  assert.equal(lives.encerrada(live.caminho), false);
});

test('sinal com outro caminho (live trocada) é recusado; sinal depois de reiniciar volta a conhecer a live', () => {
  const lives = new Lives({ segredo: SEGREDO });
  const live = lives.comecar(ANA);
  assert.equal(lives.sinal(ANA, 'ex/AAAAAAAAAAAAAAAAAAAAAAAA'), false);
  const depois = new Lives({ segredo: SEGREDO });
  assert.equal(depois.sinal(ANA, live.caminho), true);
  assert.equal(depois.donoDe(live.caminho), ANA);
});

test('segredo curto é recusado', () => {
  assert.throws(() => new Lives({ segredo: 'curto' }));
});
