import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Narracao } from '../src/narracao.mjs';

const wav = Buffer.alloc(48);
wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
const URL_OK = 'https://qwen-qwen3-tts.hf.space/gradio_api/file=/tmp/gradio/abc/audio.wav';

async function comPasta(fn) {
  const pasta = await mkdtemp(join(tmpdir(), 'exilados-narracao-'));
  try { await fn(pasta); } finally { await rm(pasta, { recursive: true, force: true }); }
}

test('o pedido de geração leva a frase fixa e a descrição feminina carioca em português', () => {
  const pedido = new Narracao({ pasta: 'x' }).pedido('Ana', 'entrou');
  assert.equal(pedido.texto, 'Ana chegou, hein!');
  assert.equal(new Narracao({ pasta: 'x' }).pedido('Ana', 'saiu').texto, 'Ana meteu o pé!');
  assert.equal(pedido.idioma, 'Portuguese');
  assert.match(pedido.descricao, /adult.*woman/i);
  assert.match(pedido.descricao, /Rio de Janeiro/);
  assert.match(pedido.descricao, /sensual/);
  assert.equal(new Narracao({ pasta: 'x' }).pedido('Ana', 'outro'), null);
});

test('guarda o áudio gerado no serviço de voz e entrega para todos, mesmo depois de reiniciar', async () => {
  await comPasta(async (pasta) => {
    const baixados = [];
    const baixar = async (url) => { baixados.push(url); return new Response(wav); };
    const narracao = new Narracao({ pasta, baixar });
    assert.equal(await narracao.guardado('Ana', 'entrou'), null);
    assert.equal(await narracao.guardar('Ana', 'entrou', URL_OK), wav.toString('base64'));
    assert.deepEqual(baixados, [URL_OK]);
    assert.equal(await new Narracao({ pasta, baixar }).guardado('Ana', 'entrou'), wav.toString('base64'));
    assert.equal(await narracao.guardado('Ana', 'saiu'), null);
  });
});

test('não baixa de fora do serviço de voz nem guarda o que não é WAV', async () => {
  await comPasta(async (pasta) => {
    let baixou = 0;
    const narracao = new Narracao({ pasta, baixar: async () => { baixou += 1; return new Response('<html>'); } });
    for (const url of ['http://127.0.0.1/segredo', 'https://qwen-qwen3-tts.hf.space/outra/coisa', 'https://exemplo.com/gradio_api/file=a.wav']) {
      assert.equal(await narracao.guardar('Ana', 'entrou', url), null);
    }
    assert.equal(baixou, 0);
    assert.equal(await narracao.guardar('Ana', 'entrou', URL_OK), null);
    assert.equal(await narracao.guardado('Ana', 'entrou'), null);
  });
});

test('a live tem frase própria na voz neural', () => {
  assert.equal(new Narracao({ pasta: 'x' }).pedido('Ana', 'live').texto, 'Ana abriu uma live!');
});

test('gera no servidor uma vez por frase, agrupa pedidos simultâneos e persiste o WAV', async () => {
  await comPasta(async (pasta) => {
    const frases = [];
    let ativos = 0, maximo = 0;
    const gerar = async (texto) => {
      frases.push(texto);
      maximo = Math.max(maximo, ++ativos);
      await new Promise((r) => setTimeout(r, 10));
      ativos--;
      return wav;
    };
    const narracao = new Narracao({ pasta, gerar });
    const audios = await Promise.all([
      narracao.obter('Ana', 'entrou'), narracao.obter('Ana', 'entrou'),
      narracao.obter('Ana', 'saiu'), narracao.obter('Ana', 'live'),
    ]);
    assert.ok(audios.every((a) => a === wav.toString('base64')));
    assert.deepEqual(frases, ['Ana chegou, hein!', 'Ana meteu o pé!', 'Ana abriu uma live!']);
    assert.equal(maximo, 1);
    assert.equal(await new Narracao({ pasta, gerar: () => { throw Error('não deve gerar'); } }).obter('Ana', 'live'), audios[0]);
  });
});

test('falha na voz neural permite alternativa local e pausa novas gerações por um minuto', async () => {
  await comPasta(async (pasta) => {
    let chamadas = 0;
    const narracao = new Narracao({ pasta, gerar: () => { chamadas++; throw Error('offline'); } });
    assert.equal(await narracao.obter('Ana', 'entrou'), null);
    assert.equal(await narracao.obter('Ana', 'live'), null);
    assert.equal(await narracao.obter('Ana', 'outro'), null);
    assert.equal(chamadas, 1);
  });
});
