import assert from 'node:assert/strict';
import test from 'node:test';
import { anunciarEntrada } from '../js/anuncio.js';

function falante() {
  const falas = [];
  class Fala { constructor(texto) { this.text = texto; } }
  const sintese = { speak: (f) => falas.push(f), getVoices: () => [{ lang: 'en-US', name: 'Inglês' }, { lang: 'pt-BR', name: 'Maria' }] };
  return { falas, ambiente: { sintese, Fala } };
}

test('quem entra na sala tem o nome lido em voz alta, em português', () => {
  const { falas, ambiente } = falante();
  assert.equal(anunciarEntrada('Lucas', { ligado: true, surdo: false, ...ambiente }), true);
  assert.equal(falas.length, 1);
  assert.equal(falas[0].text, 'Lucas entrou');
  assert.equal(falas[0].lang, 'pt-BR');
  assert.equal(falas[0].voice.name, 'Maria');
});

test('com o anúncio desligado ou o som desligado (surdo), não fala nada', () => {
  const { falas, ambiente } = falante();
  assert.equal(anunciarEntrada('Lucas', { ligado: false, surdo: false, ...ambiente }), false);
  assert.equal(anunciarEntrada('Lucas', { ligado: true, surdo: true, ...ambiente }), false);
  assert.equal(falas.length, 0);
});

test('sem leitura em voz alta no navegador (ex.: app do Android), segue sem erro', () => {
  assert.equal(anunciarEntrada('Lucas', { ligado: true, surdo: false, sintese: undefined, Fala: undefined }), false);
});
