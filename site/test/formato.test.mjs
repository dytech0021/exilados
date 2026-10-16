import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agruparMensagens, carimbo, corDoId, dataPorExtenso, inicial, limparNome, mensagemValida, partesDoTexto,
} from '../js/formato.js';

test('links viram partes próprias, sem a pontuação do fim da frase', () => {
  assert.deepEqual(partesDoTexto('veja https://exemplo.com/a?b=1. ok'), [
    { tipo: 'texto', valor: 'veja ' },
    { tipo: 'link', valor: 'https://exemplo.com/a?b=1' },
    { tipo: 'texto', valor: '. ok' },
  ]);
  assert.deepEqual(partesDoTexto('(https://pt.wikipedia.org/wiki/X_(Y))'), [
    { tipo: 'texto', valor: '(' },
    { tipo: 'link', valor: 'https://pt.wikipedia.org/wiki/X_(Y)' },
    { tipo: 'texto', valor: ')' },
  ]);
  assert.deepEqual(partesDoTexto('<b>sem link</b>'), [{ tipo: 'texto', valor: '<b>sem link</b>' }]);
  assert.deepEqual(partesDoTexto('javascript:alert(1)'), [{ tipo: 'texto', valor: 'javascript:alert(1)' }]);
});

test('carimbo: hoje, ontem e data completa', () => {
  const agora = new Date(2026, 9, 15, 22, 0).getTime();
  assert.equal(carimbo(new Date(2026, 9, 15, 21, 3), agora), 'Hoje às 21:03');
  assert.equal(carimbo(new Date(2026, 9, 14, 8, 5), agora), 'Ontem às 08:05');
  assert.equal(carimbo(new Date(2026, 8, 1, 7, 0), agora), '01/09/2026 07:00');
  assert.equal(dataPorExtenso(new Date(2026, 9, 15)), '15 de outubro de 2026');
});

test('mensagens do mesmo autor em menos de 7 min ficam no mesmo bloco; dia novo abre divisor', () => {
  const m = (id, autor, data) => ({ id, autor, criada_em: data.toISOString() });
  const lista = agruparMensagens([
    m(1, 'a', new Date(2026, 9, 14, 23, 58)),
    m(2, 'a', new Date(2026, 9, 15, 0, 1)),
    m(3, 'a', new Date(2026, 9, 15, 0, 5)),
    m(4, 'b', new Date(2026, 9, 15, 0, 6)),
    m(5, 'b', new Date(2026, 9, 15, 0, 20)),
  ]);
  assert.deepEqual(lista.map((x) => [x.inicio, x.novoDia]), [[true, true], [true, true], [false, false], [true, false], [true, false]]);
});

test('nome do grupo: de 1 a 32 caracteres, sem espaços sobrando', () => {
  assert.equal(limparNome('  Dyego   Silva '), 'Dyego Silva');
  assert.equal(limparNome('   '), null);
  assert.equal(limparNome('x'.repeat(33)), null);
  assert.equal(limparNome('x'.repeat(32)), 'x'.repeat(32));
});

test('mensagem só com texto, só com imagem: válidas; vazia ou longa demais: não', () => {
  assert.equal(mensagemValida('oi', false), true);
  assert.equal(mensagemValida('', true), true);
  assert.equal(mensagemValida('   \n ', false), false);
  assert.equal(mensagemValida('x'.repeat(2001), true), false);
});

test('foto padrão: inicial e cor fixas por conta', () => {
  assert.equal(inicial('dyego'), 'D');
  assert.equal(inicial(''), '?');
  assert.equal(corDoId('abc'), corDoId('abc'));
  assert.match(corDoId('xyz'), /^#[0-9A-F]{6}$/);
});
