// Prévias de links e buscas seguras (sem rede: a busca é falsa e os IPs são conferidos direto).
import assert from 'node:assert/strict';
import test from 'node:test';
import { gifAceito } from '../src/gifs.mjs';
import {
  assinarMidia, conferirMidia, decodificar, idDoYoutube, lerMetadados, montarPrevia, postDoX,
} from '../src/previa.mjs';
import { buscar, enderecoAceito, ipPublico } from '../src/web.mjs';

test('só IPs da internet: rede local, o próprio servidor e reservados ficam de fora', () => {
  for (const ip of ['8.8.8.8', '177.153.35.193', '2606:4700:4700::1111']) assert.equal(ipPublico(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.14', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'nada']) assert.equal(ipPublico(ip), false, ip);
});

test('endereços aceitos: http(s) sem senha e em porta comum', () => {
  assert.ok(enderecoAceito('https://exemplo.com/a?b=1'));
  assert.ok(enderecoAceito('http://exemplo.com:8080/'));
  for (const ruim of ['file:///etc/passwd', 'ftp://x.com', 'https://a:b@x.com', 'https://x.com:22/', 'http://localhost/', 'https://impressora.local/', 'lixo']) {
    assert.equal(enderecoAceito(ruim), null, ruim);
  }
});

test('busca recusa nomes que apontam para a rede local (antes de conectar)', async () => {
  const resolver = async () => [{ address: '192.168.0.14', family: 4 }];
  await assert.rejects(buscar('https://parece-publico.com/', { resolver }), /não permitido/);
  await assert.rejects(buscar('http://127.0.0.1:8080/'), /não permitido/);
});

test('etiquetas da prévia: Open Graph, título da página, imagem relativa e entidades', () => {
  const html = `<html><head><title>Página &#233; legal</title>
    <meta name="description" content="Descrição comum">
    <meta content="Card grande" property='og:title'>
    <meta property="og:image" content="/img/a.jpg?x=1&amp;y=2">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="theme-color" content="#123abc"></head><body>`;
  const m = lerMetadados(html, 'https://site.com/pasta/post');
  assert.equal(m.titulo, 'Card grande');
  assert.equal(m.descricao, 'Descrição comum');
  assert.equal(m.imagem, 'https://site.com/img/a.jpg?x=1&y=2');
  assert.equal(m.imagemGrande, true);
  assert.equal(m.cor, '#123abc');
  assert.equal(lerMetadados('<title>Só &amp; título</title>', 'https://a.com').titulo, 'Só & título');
  assert.equal(decodificar('&lt;b&gt; &quot;x&quot; &#x1F600;'), '<b> "x" 😀');
});

test('YouTube e X: reconhece os endereços', () => {
  assert.equal(idDoYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(idDoYoutube('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(idDoYoutube('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(idDoYoutube('https://exemplo.com/watch?v=dQw4w9WgXcQ'), null);
  assert.deepEqual(postDoX('https://x.com/fulano/status/123456'), { usuario: 'fulano', id: '123456' });
  assert.deepEqual(postDoX('https://twitter.com/fulano/status/9?s=20'), { usuario: 'fulano', id: '9' });
  assert.equal(postDoX('https://x.com/fulano'), null);
});

test('imagens assinadas: a assinatura vale só para aquele endereço e segredo', () => {
  const caminho = assinarMidia('https://a.com/x.png', 'segredo');
  const u = new URL(caminho, 'https://filabox3d.com.br');
  assert.equal(conferirMidia(u.searchParams.get('u'), u.searchParams.get('a'), 'segredo'), true);
  assert.equal(conferirMidia('https://a.com/y.png', u.searchParams.get('a'), 'segredo'), false);
  assert.equal(conferirMidia(u.searchParams.get('u'), u.searchParams.get('a'), 'outro'), false);
  assert.equal(conferirMidia(u.searchParams.get('u'), null, 'segredo'), false);
});

test('prévia do YouTube pelo oEmbed e do X pelo FxTwitter', async () => {
  const respostas = {
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ': { title: 'Vídeo', author_name: 'Canal' },
    'https://api.fxtwitter.com/fulano/status/123': { tweet: { text: 'oi', author: { name: 'Fulano', screen_name: 'fulano' }, media: { photos: [{ url: 'https://pbs.twimg.com/a.jpg' }] } } },
  };
  const buscarWeb = async (url) => {
    if (!respostas[url]) throw new Error(`inesperado: ${url}`);
    return { status: 200, url, cortado: false, cabecalhos: { 'content-type': 'application/json' }, corpo: Buffer.from(JSON.stringify(respostas[url])) };
  };
  const yt = await montarPrevia('https://youtu.be/dQw4w9WgXcQ', { segredo: 's', buscarWeb });
  assert.equal(yt.tipo, 'youtube');
  assert.equal(yt.titulo, 'Vídeo');
  assert.match(yt.imagem, /i\.ytimg\.com/);
  const x = await montarPrevia('https://x.com/fulano/status/123', { segredo: 's', buscarWeb });
  assert.equal(x.tipo, 'x');
  assert.equal(x.titulo, 'Fulano (@fulano)');
  assert.equal(x.descricao, 'oi');
});

test('GIFs: só endereços https do Giphy', () => {
  assert.ok(gifAceito('https://media1.giphy.com/media/abc/giphy.webp'));
  assert.ok(gifAceito('https://i.giphy.com/abc.webp'));
  for (const ruim of ['http://media1.giphy.com/x', 'https://giphy.com.mal.com/x', 'https://exemplo.com/x.gif', 'lixo']) assert.equal(gifAceito(ruim), null, ruim);
});
