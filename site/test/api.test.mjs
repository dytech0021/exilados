import assert from 'node:assert/strict';
import test from 'node:test';
import { criarApi } from '../js/api.js';

const AGORA = 1_000_000_000_000;

function falso({ expiraEm, renovada }) {
  const chamadas = [];
  let renovacoes = 0;
  const api = criarApi({
    base: '/exilados/api',
    agora: () => AGORA,
    obterSessao: async () => (expiraEm === null ? null : { access_token: 'velho', expires_at: expiraEm }),
    renovarSessao: async () => { renovacoes += 1; return renovada; },
    fetch: async (url, opcoes) => {
      chamadas.push({ url, autorizacao: opcoes?.headers?.authorization });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  return { api, chamadas, renovacoes: () => renovacoes };
}

test('login que vence em menos de 1 minuto é renovado antes de chamar', async () => {
  const f = falso({ expiraEm: AGORA / 1000 + 30, renovada: { access_token: 'novo', expires_at: AGORA / 1000 + 3600 } });
  await f.api.chamar('/voz/entrar', { sala: 'x' });
  assert.equal(f.renovacoes(), 1);
  assert.equal(f.chamadas[0].autorizacao, 'Bearer novo');
  assert.equal(f.chamadas[0].url, '/exilados/api/voz/entrar');
});

test('login ainda bom é usado como está', async () => {
  const f = falso({ expiraEm: AGORA / 1000 + 3600, renovada: null });
  await f.api.chamar('/live/sinal');
  assert.equal(f.renovacoes(), 0);
  assert.equal(f.chamadas[0].autorizacao, 'Bearer velho');
});

test('sem login, ou sem conseguir renovar: pede para entrar de novo', async () => {
  await assert.rejects(falso({ expiraEm: null }).api.chamar('/x'), /Entre na sua conta de novo/);
  await assert.rejects(falso({ expiraEm: 1, renovada: null }).api.chamar('/x'), /Entre na sua conta de novo/);
});

test('cada chamada leva a versão do site; versão velha (426) avisa para recarregar', async () => {
  const cabecalhos = [];
  let velha = 0;
  const api = criarApi({
    base: '',
    versao: '43',
    aoVersaoVelha: () => { velha += 1; },
    obterSessao: async () => ({ access_token: 't', expires_at: Date.now() / 1000 + 3600 }),
    renovarSessao: async () => null,
    fetch: async (url, opcoes) => {
      cabecalhos.push(opcoes.headers['x-exilados-site']);
      return { ok: false, status: 426, json: async () => ({ erro: 'Há uma versão nova do Exilados.' }) };
    },
  });
  await assert.rejects(api.chamar('/voz/entrar'), (e) => e.status === 426);
  assert.deepEqual(cabecalhos, ['43']);
  assert.equal(velha, 1);
});

test('erro do servidor chega com a mensagem dele', async () => {
  const api = criarApi({
    base: '',
    obterSessao: async () => ({ access_token: 't', expires_at: Date.now() / 1000 + 3600 }),
    renovarSessao: async () => null,
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ erro: 'Você não faz mais parte do grupo.' }) }),
  });
  await assert.rejects(api.chamar('/voz/entrar'), (e) => e.status === 403 && e.message === 'Você não faz mais parte do grupo.');
});
