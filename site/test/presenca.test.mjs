import assert from 'node:assert/strict';
import test from 'node:test';
import { contarAssistindo, LimitadorFala, liveNoAr, resumirPresenca } from '../js/presenca.js';

test('online se alguma aba está online; sala de voz da aba que entrou por último', () => {
  const resumo = resumirPresenca({
    a: [{ status: 'ausente' }, { status: 'online', voz: 's1', desde: 10, mudo: true, tela: true }],
    b: [{ status: 'ausente' }],
    c: [{ status: 'online', voz: 's1', desde: 5 }, { status: 'online', voz: 's2', desde: 9, surdo: true, assistindo: 'a' }],
    d: [],
  });
  assert.deepEqual(resumo.get('a'), { status: 'online', voz: 's1', mudo: true, surdo: false, tela: true, assistindo: null });
  assert.deepEqual(resumo.get('b'), { status: 'ausente', voz: null, mudo: false, surdo: false, tela: false, assistindo: null });
  assert.deepEqual(resumo.get('c'), { status: 'online', voz: 's2', mudo: false, surdo: true, tela: false, assistindo: 'a' });
  assert.equal(resumo.has('d'), false);
  assert.equal(contarAssistindo(resumo, 'a'), 1);
  assert.equal(contarAssistindo(resumo, 'c'), 0);
});

test('live continua visível durante atraso temporário de 30 s no sinal', () => {
  const agora = Date.parse('2026-10-15T22:00:30Z');
  assert.equal(liveNoAr({ ultimo_sinal: '2026-10-15T22:00:15Z' }, agora), true);
  assert.equal(liveNoAr({ ultimo_sinal: '2026-10-15T22:00:00Z' }, agora), true);
  assert.equal(liveNoAr({ ultimo_sinal: '2026-10-15T21:59:29Z' }, agora), false);
  assert.equal(liveNoAr(null, agora), false);
});

test('o limitador usa o setTimeout do navegador sem "Illegal invocation" (isso derrubava a conexão de voz)', () => {
  // No navegador, setTimeout/clearTimeout chamados como método de outro objeto lançam TypeError: Illegal invocation.
  const original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const exigente = (fn) => function (...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return fn(...args);
  };
  globalThis.setTimeout = exigente(original.setTimeout);
  globalThis.clearTimeout = exigente(original.clearTimeout);
  try {
    const enviados = [];
    const limitador = new LimitadorFala((f) => enviados.push(f));
    assert.doesNotThrow(() => {
      limitador.atualizar(true);
      limitador.atualizar(false); // menos de 500 ms depois: agenda
      limitador.atualizar(true); // volta ao enviado: cancela o agendado
    });
    limitador.parar();
    assert.deepEqual(enviados, [true]);
  } finally {
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
  }
});

test('quem está falando: no máximo 2 mensagens por segundo, terminando no estado certo', () => {
  let t = 0;
  const enviados = [];
  const agenda = [];
  const lim = new LimitadorFala((v) => enviados.push([t, v]), {
    agora: () => t,
    agendar: (fn, ms) => { agenda.push({ fn, quando: t + ms }); return agenda.length; },
    cancelar: (id) => { agenda[id - 1] = null; },
  });
  lim.atualizar(true); // manda na hora
  t = 100; lim.atualizar(false); // espera até 500
  t = 200; lim.atualizar(true); // voltou ao que foi enviado: cancela a espera
  t = 300; lim.atualizar(false); // agenda de novo
  const pendente = agenda.filter(Boolean).pop();
  t = pendente.quando; pendente.fn();
  assert.deepEqual(enviados, [[0, true], [500, false]]);
  t = 700; lim.atualizar(true); // 200 ms depois do último: espera
  assert.equal(enviados.length, 2);
  const outro = agenda.filter(Boolean).pop();
  t = outro.quando; outro.fn();
  assert.deepEqual(enviados.at(-1), [1000, true]);
});
