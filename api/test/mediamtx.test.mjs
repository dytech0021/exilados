import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { Lives } from '../src/lives.mjs';
import { MediaMTX, autorizar, repassarPara } from '../src/mediamtx.mjs';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const ANA = '11111111-1111-4111-8111-111111111111';

function servidor(tratar) {
  return new Promise((resolve) => {
    const s = http.createServer(tratar);
    s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

test('envio para ex/ só com a senha da live; leitura só com a permissão de assistir', async () => {
  const lives = new Lives({ segredo: SEGREDO });
  const live = lives.comecar(ANA);
  const base = { path: live.caminho, ip: '200.1.2.3', protocol: 'rtsp' };
  assert.equal(await autorizar({ ...base, action: 'publish', user: ANA, password: live.senha }, { lives }), true);
  assert.equal(await autorizar({ ...base, action: 'publish', user: ANA, password: 'errada' }, { lives }), false);
  assert.equal(await autorizar({ ...base, action: 'read', protocol: 'webrtc' }, { lives }), false);
  const token = lives.leitura(live.caminho);
  assert.equal(await autorizar({ ...base, action: 'read', protocol: 'webrtc', token }, { lives }), true);
  assert.equal(await autorizar({ ...base, action: 'read', protocol: 'webrtc', query: `token=${token}` }, { lives }), true);
  assert.equal(await autorizar({ ...base, action: 'playback', token }, { lives }), false);
});

test('API do MediaMTX só de 127.0.0.1', async () => {
  const lives = new Lives({ segredo: SEGREDO });
  assert.equal(await autorizar({ action: 'api', ip: '127.0.0.1', path: '' }, { lives }), true);
  assert.equal(await autorizar({ action: 'api', ip: '8.8.8.8', path: '' }, { lives }), false);
});

test('caminhos do Ponte (ao/...) são decididos pelo relay, com o pedido como veio', async () => {
  const recebidos = [];
  const { s, url } = await servidor((pedido, resposta) => {
    let texto = '';
    pedido.on('data', (p) => { texto += p; });
    pedido.on('end', () => {
      const dados = JSON.parse(texto);
      recebidos.push(dados);
      resposta.writeHead(dados.password === 'boa' ? 200 : 401);
      resposta.end();
    });
  });
  try {
    const lives = new Lives({ segredo: SEGREDO });
    const repassar = repassarPara(`${url}/mediamtx/auth`);
    const pedido = { action: 'publish', path: 'ao/AAAAAAAAAAAAAAAAAAAAAAAA', user: 'ponte', password: 'boa', ip: '1.2.3.4' };
    assert.equal(await autorizar(pedido, { lives, repassar }), true);
    assert.equal(await autorizar({ ...pedido, password: 'ruim' }, { lives, repassar }), false);
    assert.deepEqual(recebidos[0], pedido);
    // Sem relay configurado, o que não é do Exilados é recusado.
    assert.equal(await autorizar(pedido, { lives }), false);
    // Um ex/ fora do formato nunca vai para o relay.
    assert.equal(await autorizar({ ...pedido, path: 'ex/curto' }, { lives, repassar }), false);
    assert.equal(recebidos.length, 2);
  } finally {
    s.close();
  }
});

test('relay fora do ar: recusa sem travar', async () => {
  const lives = new Lives({ segredo: SEGREDO });
  const repassar = repassarPara('http://127.0.0.1:1/mediamtx/auth');
  assert.equal(await autorizar({ action: 'read', path: 'ao/AAAAAAAAAAAAAAAAAAAAAAAA' }, { lives, repassar }), false);
});

test('conta leitores pela API do MediaMTX e derruba o envio de uma live', async () => {
  const chutados = [];
  const { s, url } = await servidor((pedido, resposta) => {
    if (pedido.url === '/v3/paths/get/ex/AAAAAAAAAAAAAAAAAAAAAAAA') {
      resposta.writeHead(200, { 'content-type': 'application/json' });
      return resposta.end(JSON.stringify({ readers: [{}, {}, {}], source: { type: 'rtspsSession', id: 'abc' } }));
    }
    if (pedido.method === 'POST' && pedido.url.startsWith('/v3/rtspssessions/kick/')) {
      chutados.push(pedido.url);
      resposta.writeHead(200);
      return resposta.end();
    }
    resposta.writeHead(404);
    resposta.end();
  });
  try {
    const mediamtx = new MediaMTX({ api: url });
    assert.equal(await mediamtx.leitores('ex/AAAAAAAAAAAAAAAAAAAAAAAA'), 3);
    assert.equal(await mediamtx.leitores('ex/BBBBBBBBBBBBBBBBBBBBBBBB'), 0);
    assert.equal(await mediamtx.expulsar('ex/AAAAAAAAAAAAAAAAAAAAAAAA'), true);
    assert.deepEqual(chutados, ['/v3/rtspssessions/kick/abc']);
    assert.equal(await new MediaMTX({ api: 'http://127.0.0.1:1' }).leitores('ex/AAAAAAAAAAAAAAAAAAAAAAAA'), -1);
  } finally {
    s.close();
  }
});
