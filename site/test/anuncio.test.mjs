import assert from 'node:assert/strict';
import test from 'node:test';
import { anunciar, criarNarrador, escolherVoz, textoDoAnuncio } from '../js/anuncio.js';

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
  assert.ok(falas[0].rate > 1 && falas[0].rate < 1.3, 'a alternativa local precisa falar mais rápido');
});

test('prepara sem tocar e reutiliza o áudio neural no anúncio', async () => {
  let buscas = 0;
  const tocados = [], falados = [];
  const narrador = criarNarrador({ buscarAudio: async () => { buscas += 1; return { audio: 'WAV' }; },
    tocar: async (audio) => tocados.push(audio), falar: (...args) => falados.push(args) });
  await narrador.preparar('a', 'Ana', 'entrou');
  assert.deepEqual(tocados, []);
  await narrador.anunciar('a', 'Ana', 'entrou', { ligado: true });
  await narrador.anunciar('a', 'Ana', 'entrou', { ligado: true });
  assert.deepEqual(tocados, ['WAV', 'WAV']);
  assert.equal(buscas, 1);
  assert.equal(falados.length, 0);
});

test('serviço indisponível ou reprodução bloqueada usa a voz local', async () => {
  for (const buscarAudio of [async () => ({ audio: null }), async () => { throw Error('offline'); }, async () => ({ audio: 'WAV' })]) {
    const falados = [];
    const narrador = criarNarrador({ buscarAudio, tocar: async () => { throw Error('autoplay'); }, falar: (...args) => falados.push(args) });
    await narrador.anunciar('a', 'Ana', 'saiu', { ligado: true });
    assert.deepEqual(falados.map(([nome, evento]) => [nome, evento]), [['Ana', 'saiu']]);
  }
});

test('sair da sala ou desligar narração durante a busca cancela a fala pendente', async () => {
  let concluir;
  const tocados = [], falados = [];
  const narrador = criarNarrador({ buscarAudio: () => new Promise((resolve) => { concluir = resolve; }),
    tocar: async (a) => tocados.push(a), falar: (...a) => falados.push(a) });
  const anuncio = narrador.anunciar('a', 'Ana', 'entrou', { ligado: true });
  await new Promise((resolve) => setImmediate(resolve));
  narrador.cancelar();
  concluir({ audio: 'WAV' });
  await anuncio;
  assert.deepEqual(tocados, []);
  assert.deepEqual(falados, []);
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

test('gera a narração no demo de voz com a frase e a descrição do servidor e devolve o endereço do áudio', async () => {
  const { gerarNoServicoDeVoz } = await import('../js/anuncio.js');
  const pedidos = [];
  const origem = 'https://qwen-qwen3-tts.hf.space';
  const url = await gerarNoServicoDeVoz({ origem, texto: 'Ana chegou, hein!', idioma: 'Portuguese', descricao: 'carioca' }, {
    fetch: async (endereco, opcoes) => {
      pedidos.push({ endereco, corpo: opcoes?.body });
      if (endereco.endsWith('/generate_voice_design')) return Response.json({ event_id: 'abc' });
      return new Response(`event: complete\ndata: [{"url":"${origem}/gradio_api/file=/tmp/gradio/x/audio.wav"},"ok"]\n\n`);
    },
  });
  assert.equal(url, `${origem}/gradio_api/file=/tmp/gradio/x/audio.wav`);
  assert.deepEqual(JSON.parse(pedidos[0].corpo).data, ['Ana chegou, hein!', 'Portuguese', 'carioca']);
  assert.equal(pedidos[1].endereco, `${origem}/gradio_api/call/generate_voice_design/abc`);
});

test('demo sem cota ou com resposta estranha: falha (e a narração usa a voz do aparelho)', async () => {
  const { gerarNoServicoDeVoz } = await import('../js/anuncio.js');
  const origem = 'https://qwen-qwen3-tts.hf.space';
  for (const resposta of ['event: error\ndata: null\n\n', 'event: complete\ndata: [{"url":"https://outro.site/a.wav"}]\n\n']) {
    let n = 0;
    await assert.rejects(gerarNoServicoDeVoz({ origem, texto: 'Ana', idioma: 'Portuguese', descricao: 'x' }, {
      fetch: async () => (++n === 1 ? Response.json({ event_id: 'abc' }) : new Response(resposta)),
    }));
  }
});

test('quem abre uma live ou compartilha a tela também é anunciado', () => {
  assert.equal(textoDoAnuncio('Lucas', 'live', 0), 'Lucas abriu uma live');
  assert.equal(textoDoAnuncio('Lucas', 'live', 1), 'Olha a live do Lucas aí');
  const { falas, ambiente } = falante();
  assert.equal(anunciar('Bia', 'live', { ligado: true, surdo: false, ...ambiente }), true);
  assert.deepEqual(falas.map((f) => f.text), ['Bia abriu uma live']);
});
