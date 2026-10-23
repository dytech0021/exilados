import assert from 'node:assert/strict';
import test from 'node:test';
import { anunciar, escolherVoz, textoDoAnuncio } from '../js/anuncio.js';

function falante(vozes = [{ lang: 'en-US', name: 'Inglês' }, { lang: 'pt-BR', name: 'Microsoft Daniel' }, { lang: 'pt-BR', name: 'Microsoft Maria' }]) {
  const falas = [];
  class Fala { constructor(texto) { this.text = texto; } }
  const sintese = { speak: (f) => falas.push(f), getVoices: () => vozes };
  return { falas, ambiente: { sintese, Fala, sorteio: () => 0 } };
}

test('entrada e saída com o jeito carioca, variando a frase', () => {
  assert.equal(textoDoAnuncio('Lucas', 'entrou', 0), 'Lucas brotou na sala');
  assert.equal(textoDoAnuncio('Lucas', 'saiu', 0), 'Lucas vazou');
  assert.equal(textoDoAnuncio('Lucas', 'saiu', 1), 'Lucas meteu o pé');
  assert.equal(textoDoAnuncio('Lucas', 'saiu', 3), 'Lucas vazou');
  assert.equal(textoDoAnuncio('Lucas', 'outro', 0), null);
});

test('quem entra e quem sai têm o nome lido em voz alta, com voz feminina em português', () => {
  const { falas, ambiente } = falante();
  assert.equal(anunciar('Lucas', 'entrou', { ligado: true, surdo: false, ...ambiente }), true);
  assert.equal(anunciar('Bia', 'saiu', { ligado: true, surdo: false, ...ambiente }), true);
  assert.deepEqual(falas.map((f) => f.text), ['Lucas brotou na sala', 'Bia vazou']);
  assert.equal(falas[0].lang, 'pt-BR');
  assert.equal(falas[0].voice.name, 'Microsoft Maria');
});

test('prefere uma voz feminina natural (online) quando o navegador tem', () => {
  const vozes = [
    { lang: 'pt-BR', name: 'Microsoft Maria', localService: true },
    { lang: 'pt-BR', name: 'Microsoft Antonio Online (Natural) - Portuguese (Brazil)', localService: false },
    { lang: 'pt-BR', name: 'Microsoft Thalita Online (Natural) - Portuguese (Brazil)', localService: false },
  ];
  assert.equal(escolherVoz(vozes).name, 'Microsoft Thalita Online (Natural) - Portuguese (Brazil)');
  assert.equal(escolherVoz([{ lang: 'pt-BR', name: 'Google português do Brasil' }, ...vozes.slice(0, 1)]).name, 'Google português do Brasil');
  assert.equal(escolherVoz([{ lang: 'en-US', name: 'Zira' }]), null);
});

test('com o anúncio desligado ou o som desligado (surdo), não fala nada', () => {
  const { falas, ambiente } = falante();
  assert.equal(anunciar('Lucas', 'entrou', { ligado: false, surdo: false, ...ambiente }), false);
  assert.equal(anunciar('Lucas', 'saiu', { ligado: true, surdo: true, ...ambiente }), false);
  assert.equal(falas.length, 0);
});

test('sem leitura em voz alta no navegador (ex.: app do Android), segue sem erro', () => {
  assert.equal(anunciar('Lucas', 'entrou', { ligado: true, surdo: false, sintese: undefined, Fala: undefined }), false);
});
