import assert from 'node:assert/strict';
import test from 'node:test';
import { avisoDeVoz } from '../js/android.js';

function appFalso() {
  const chamadas = [];
  return { chamadas, voz: (ligada, sala) => chamadas.push([ligada, sala]) };
}

test('o app do celular fica sabendo quando a pessoa entra, troca e sai da sala de voz, uma vez por mudança', () => {
  const app = appFalso();
  const avisar = avisoDeVoz(app);
  avisar(true, 'Geral');
  avisar(true, 'Geral');
  avisar(true, 'Jogando');
  avisar(false, 'Jogando');
  avisar(false, '');
  assert.deepEqual(app.chamadas, [[true, 'Geral'], [true, 'Jogando'], [false, '']]);
});

test('fora do app (navegador) não faz nada', () => {
  const avisar = avisoDeVoz(undefined);
  assert.doesNotThrow(() => avisar(true, 'Geral'));
});

test('um app que falha ao receber o aviso não derruba o site', () => {
  const avisar = avisoDeVoz({ voz: () => { throw new Error('app antigo'); } });
  assert.doesNotThrow(() => avisar(true, 'Geral'));
});
