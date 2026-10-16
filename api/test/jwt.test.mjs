import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { assinarJwt, lerJwt, tokenDeServico, tokenDoLiveKit } from '../src/jwt.mjs';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';

test('assina em HS256 no formato padrão', () => {
  const token = assinarJwt({ a: 1 }, SEGREDO);
  const [cabecalho, corpo, assinatura] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(cabecalho, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(corpo, 'base64url')), { a: 1 });
  assert.equal(assinatura, createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url'));
});

test('lerJwt recusa assinatura de outro segredo e formato inválido', () => {
  const token = assinarJwt({ a: 1 }, SEGREDO);
  assert.deepEqual(lerJwt(token, SEGREDO), { a: 1 });
  assert.equal(lerJwt(token, 'outro-segredo-com-mais-de-32-caracteres!!'), null);
  assert.equal(lerJwt('abc', SEGREDO), null);
});

test('token de voz publica só o microfone e a tela, na sala pedida, por 10 minutos', () => {
  const agora = 1_800_000_000_000;
  const token = tokenDoLiveKit({ chave: 'API1', segredo: SEGREDO, identidade: 'u1', nome: 'Ana', sala: 'sala-x', agora });
  const dados = lerJwt(token, SEGREDO);
  assert.equal(dados.iss, 'API1');
  assert.equal(dados.sub, 'u1');
  assert.equal(dados.name, 'Ana');
  assert.equal(dados.exp - Math.floor(agora / 1000), 600);
  assert.equal(dados.video.room, 'sala-x');
  assert.equal(dados.video.roomJoin, true);
  assert.deepEqual(dados.video.canPublishSources, ['microphone', 'screen_share', 'screen_share_audio']);
  assert.equal(dados.video.canPublishData, false);
  assert.equal(dados.video.roomAdmin, undefined);
});

test('token de serviço administra salas e vence em 1 minuto', () => {
  const agora = 1_800_000_000_000;
  const dados = lerJwt(tokenDeServico({ chave: 'API1', segredo: SEGREDO, sala: 'sala-x', agora }), SEGREDO);
  assert.equal(dados.video.roomAdmin, true);
  assert.equal(dados.video.roomList, true);
  assert.equal(dados.video.room, 'sala-x');
  assert.equal(dados.exp - Math.floor(agora / 1000), 60);
});
