import assert from 'node:assert/strict';
import test from 'node:test';
import { avisoDeVideo, avisoDeVoz, versaoDoApp } from '../js/android.js';

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

test('o app fica sabendo quando há vídeo na tela (live ou tela compartilhada), para a janela flutuante', () => {
  const chamadas = [];
  const avisar = avisoDeVideo({ video: (sim) => chamadas.push(sim) });
  avisar('grupo');
  avisar('live');
  avisar('tela');
  avisar('conversa');
  avisar('amigos');
  assert.deepEqual(chamadas, [false, true, false]);
});

test('a versão do app vem do agente do WebView', () => {
  assert.equal(versaoDoApp('Mozilla/5.0 (Linux; Android 14; wv) Chrome/131 Mobile Safari/537.36 ExiladosAndroid/1.0.9'), '1.0.9');
  assert.equal(versaoDoApp('Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile Safari/537.36'), null);
});

test('fora do app (navegador) não faz nada', () => {
  const avisar = avisoDeVoz(undefined);
  assert.doesNotThrow(() => avisar(true, 'Geral'));
});

test('um app que falha ao receber o aviso não derruba o site', () => {
  const avisar = avisoDeVoz({ voz: () => { throw new Error('app antigo'); } });
  assert.doesNotThrow(() => avisar(true, 'Geral'));
});
