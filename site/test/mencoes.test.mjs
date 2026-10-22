import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acharMencoes, jeitoDoArquivo, linksDoTexto, mencaoDigitando, nomeSeguro, partesComMencoes, tamanhoLegivel,
} from '../js/formato.js';

const MEMBROS = [{ user_id: 'a', nome: 'Ana' }, { user_id: 'b', nome: 'Ana Beatriz' }, { user_id: 'c', nome: 'Lucas' }];

test('acha menções por nome inteiro, com espaço, sem pegar pedaço de outra palavra', () => {
  assert.deepEqual(acharMencoes('oi @ana, bora?', MEMBROS).mencoes, ['a']);
  assert.deepEqual(acharMencoes('@Ana Beatriz e @lucas', MEMBROS).mencoes.sort(), ['a', 'b', 'c']);
  assert.deepEqual(acharMencoes('fala @Anabela', MEMBROS).mencoes, []);
  assert.deepEqual(acharMencoes('email ana@ana.com', MEMBROS).mencoes, []);
  assert.equal(acharMencoes('@todos bora', MEMBROS, { podeTodos: true }).todos, true);
  assert.equal(acharMencoes('@todos bora', MEMBROS).todos, false);
  assert.equal(acharMencoes('@todosnada', MEMBROS, { podeTodos: true }).todos, false);
});

test('divide o texto em menções para destacar', () => {
  assert.deepEqual(partesComMencoes('oi @Ana Beatriz!', { b: 'Ana Beatriz', a: 'Ana' }), [
    { tipo: 'texto', valor: 'oi ' }, { tipo: 'mencao', valor: '@Ana Beatriz', id: 'b' }, { tipo: 'texto', valor: '!' },
  ]);
  assert.deepEqual(partesComMencoes('@todos agora', {}, true), [
    { tipo: 'mencao', valor: '@todos', id: 'todos' }, { tipo: 'texto', valor: ' agora' },
  ]);
  assert.deepEqual(partesComMencoes('sem nada', { a: 'Ana' }), [{ tipo: 'texto', valor: 'sem nada' }]);
});

test('palavra com @ sendo digitada', () => {
  assert.equal(mencaoDigitando('oi @an', 6), 'an');
  assert.equal(mencaoDigitando('@', 1), '');
  assert.equal(mencaoDigitando('a@b', 3), null);
  assert.equal(mencaoDigitando('oi @ana ', 8), null);
});

test('arquivos: tamanho, nome seguro, jeito de mostrar e links', () => {
  assert.equal(tamanhoLegivel(1572864), '1,5 MB');
  assert.equal(tamanhoLegivel(2048), '2 KB');
  assert.equal(nomeSeguro('../Minha Jogada Épica!!.MP4'), 'Minha-Jogada-Epica-.MP4');
  assert.equal(nomeSeguro(''), 'arquivo');
  assert.equal(jeitoDoArquivo('video/mp4'), 'video');
  assert.equal(jeitoDoArquivo('application/zip'), 'arquivo');
  assert.equal(jeitoDoArquivo('image/svg+xml'), 'arquivo');
  assert.deepEqual(linksDoTexto('veja https://a.com e https://a.com, e https://b.com.'), ['https://a.com', 'https://b.com']);
});
