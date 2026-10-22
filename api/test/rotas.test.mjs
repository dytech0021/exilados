// Rotas de ponta a ponta com Supabase, LiveKit e MediaMTX falsos (servidores HTTP locais).
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { lerJwt } from '../src/jwt.mjs';
import { LiveKit } from '../src/livekit.mjs';
import { Lives } from '../src/lives.mjs';
import { MediaMTX, autorizar } from '../src/mediamtx.mjs';
import { criarRotas } from '../src/rotas.mjs';
import { Supabase } from '../src/supabase.mjs';

const SEGREDO_LK = 'segredo-do-livekit-com-mais-de-32-caracteres';
const SEGREDO_LIVES = 'segredo-das-lives-com-mais-de-32-caracteres';
const DONO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANA = '11111111-1111-4111-8111-111111111111';
const FORA = '99999999-9999-4999-8999-999999999999';
const VOZ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEXTO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONVERSA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function ouvir(tratar) {
  return new Promise((resolve) => {
    const s = http.createServer(tratar);
    s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

function corpoDe(pedido) {
  return new Promise((resolve) => {
    let t = '';
    pedido.on('data', (p) => { t += p; });
    pedido.on('end', () => resolve(t ? JSON.parse(t) : null));
  });
}

function json(resposta, status, dados) {
  resposta.writeHead(status, { 'content-type': 'application/json' });
  resposta.end(dados === undefined ? '' : JSON.stringify(dados));
}

/** Supabase falso: tokens "t-<id>", membros, salas e lives em memória, com as regras que importam aqui. */
function supabaseFalso() {
  const banco = {
    membros: new Map([
      [DONO, { user_id: DONO, nome: 'Dono', avatar: null, papel: 'dono', ativo: true }],
      [ANA, { user_id: ANA, nome: 'Ana', avatar: null, papel: 'membro', ativo: true }],
    ]),
    salas: new Map([[VOZ, { id: VOZ, nome: 'Geral', tipo: 'voz' }], [TEXTO, { id: TEXTO, nome: 'geral', tipo: 'texto' }]]),
    lives: new Map(),
    // Conversa direta entre o dono e a Ana.
    conversas: new Map([[CONVERSA, { id: CONVERSA, a: DONO, b: ANA }]]),
    chamadasUsuario: 0,
  };
  const tratar = async (pedido, resposta) => {
    const url = new URL(pedido.url, 'http://x');
    const token = String(pedido.headers.authorization || '').replace('Bearer ', '');
    const eu = token.startsWith('t-') ? token.slice(2) : null;
    const corpo = await corpoDe(pedido);
    const ativo = eu && banco.membros.get(eu)?.ativo;
    const filtro = (nome) => (url.searchParams.get(nome) || '').replace('eq.', '');
    if (url.pathname === '/auth/v1/user') {
      banco.chamadasUsuario += 1;
      return eu ? json(resposta, 200, { id: eu }) : json(resposta, 401, { msg: 'invalid JWT' });
    }
    if (url.pathname === '/rest/v1/exilados_membros') {
      const m = banco.membros.get(filtro('user_id'));
      return json(resposta, 200, m && (ativo || m.user_id === eu) ? [m] : []);
    }
    if (url.pathname === '/rest/v1/exilados_salas') {
      const s = banco.salas.get(filtro('id'));
      return json(resposta, 200, s && ativo ? [s] : []);
    }
    if (url.pathname === '/rest/v1/exilados_conversas') {
      const c = banco.conversas.get(filtro('id'));
      return json(resposta, 200, c && ativo && [c.a, c.b].includes(eu) ? [c] : []);
    }
    if (url.pathname === '/rest/v1/rpc/exilados_definir_ativo') {
      if (banco.membros.get(eu)?.papel !== 'dono') return json(resposta, 400, { message: 'Só o dono do grupo pode fazer isso.' });
      if (corpo.alvo === eu) return json(resposta, 400, { message: 'O dono não pode remover a si mesmo.' });
      const alvo = banco.membros.get(corpo.alvo);
      if (!alvo) return json(resposta, 400, { message: 'Esse membro não existe.' });
      alvo.ativo = corpo.valor;
      return json(resposta, 204);
    }
    if (url.pathname === '/rest/v1/exilados_lives') {
      if (pedido.method === 'POST') {
        if (!ativo || corpo.user_id !== eu) return json(resposta, 403, { message: 'new row violates row-level security policy' });
        banco.lives.set(eu, { user_id: eu, caminho: corpo.caminho, ultimo_sinal: corpo.ultimo_sinal });
        return json(resposta, 201);
      }
      const alvo = filtro('user_id');
      const linha = banco.lives.get(alvo);
      if (pedido.method === 'PATCH') {
        if (!linha || alvo !== eu || !ativo) return json(resposta, 200, []);
        linha.ultimo_sinal = corpo.ultimo_sinal;
        return json(resposta, 200, [linha]);
      }
      if (pedido.method === 'DELETE') {
        if (alvo === eu) banco.lives.delete(alvo);
        return json(resposta, 204);
      }
      return json(resposta, 200, linha && ativo ? [linha] : []);
    }
    json(resposta, 404, { message: 'não existe' });
  };
  return { banco, tratar };
}

function livekitFalso() {
  const estado = {
    salas: ['sala-' + VOZ, 'sala-outra', 'conversa-' + CONVERSA], removidos: [], tokens: [],
    participantes: { ['sala-' + VOZ]: [ANA], ['conversa-' + CONVERSA]: [DONO] },
  };
  const tratar = async (pedido, resposta) => {
    const corpo = await corpoDe(pedido);
    const token = lerJwt(String(pedido.headers.authorization || '').replace('Bearer ', ''), SEGREDO_LK);
    if (!token) return json(resposta, 401, { code: 'unauthenticated', msg: 'token inválido' });
    estado.tokens.push(token);
    if (pedido.url.endsWith('/ListRooms')) return json(resposta, 200, { rooms: estado.salas.map((name) => ({ name })) });
    if (pedido.url.endsWith('/ListParticipants')) {
      return json(resposta, 200, { participants: (estado.participantes[corpo.room] || []).map((identity) => ({ identity })) });
    }
    if (pedido.url.endsWith('/RemoveParticipant')) {
      if (corpo.room !== 'sala-' + VOZ || corpo.identity !== ANA) return json(resposta, 404, { code: 'not_found', msg: 'participant not found' });
      estado.removidos.push(`${corpo.room}/${corpo.identity}`);
      return json(resposta, 200, {});
    }
    json(resposta, 404, { code: 'bad_route' });
  };
  return { estado, tratar };
}

async function montar({ agora, gifs = null, buscarWeb } = {}) {
  const sb = supabaseFalso();
  const lk = livekitFalso();
  const mm = { leitores: [], expulsos: [] };
  const servSb = await ouvir(sb.tratar);
  const servLk = await ouvir(lk.tratar);
  const relogio = { t: Date.now() };
  const lives = new Lives({ segredo: SEGREDO_LIVES, agora: agora || (() => relogio.t) });
  const mediamtx = new MediaMTX({ api: 'http://127.0.0.1:1' });
  mediamtx.leitores = async (c) => { mm.leitores.push(c); return 2; };
  mediamtx.expulsar = async (c) => { mm.expulsos.push(c); return true; };
  const config = {
    urlVoz: 'wss://exemplo/exilados',
    rtsps: 'rtsps://exemplo:8322',
    livekitChave: 'API1',
    livekitSegredo: SEGREDO_LK,
  };
  const erros = [];
  const rotas = criarRotas({
    supabase: new Supabase({ url: servSb.url, chave: 'publica', agora: () => relogio.t }),
    livekit: new LiveKit({ api: servLk.url, chave: 'API1', segredo: SEGREDO_LK }),
    lives,
    mediamtx,
    config,
    gifs,
    ...(buscarWeb ? { buscarWeb } : {}),
    segredoMidia: 'segredo-das-imagens',
    agora: () => relogio.t,
    registrar: (m) => erros.push(m),
  });
  const api = await ouvir(rotas);
  const chamar = async (metodo, caminho, { quem, corpo } = {}) => {
    const resposta = await fetch(`${api.url}${caminho}`, {
      method: metodo,
      headers: { ...(quem ? { authorization: `Bearer t-${quem}` } : {}), 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const tipo = resposta.headers.get('content-type') || '';
    return { status: resposta.status, tipo, dados: tipo.includes('json') ? await resposta.json() : Buffer.from(await resposta.arrayBuffer()) };
  };
  const fechar = () => { servSb.s.close(); servLk.s.close(); api.s.close(); };
  return { sb, lk, mm, lives, relogio, chamar, fechar, erros };
}

test('saúde responde sem login, com a hora do servidor', async () => {
  const t = await montar();
  try {
    const r = await t.chamar('GET', '/saude');
    assert.equal(r.status, 200);
    assert.equal(r.dados.ok, true);
    assert.equal(r.dados.agora, t.relogio.t);
    assert.equal((await t.chamar('GET', '/exilados/api/saude')).status, 200);
  } finally { t.fechar(); }
});

test('sem login, login inválido ou fora do grupo: recusado', async () => {
  const t = await montar();
  try {
    assert.equal((await t.chamar('POST', '/voz/entrar', { corpo: { sala: VOZ } })).status, 401);
    const fora = await t.chamar('POST', '/voz/entrar', { quem: FORA, corpo: { sala: VOZ } });
    assert.equal(fora.status, 403);
    assert.equal(fora.dados.erro, 'Você não faz mais parte do grupo.');
    assert.equal((await t.chamar('POST', '/nada', { quem: ANA })).status, 404);
  } finally { t.fechar(); }
});

test('voz: membro ativo recebe permissão da sala de voz; sala de texto ou inexistente não', async () => {
  const t = await montar();
  try {
    const r = await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: VOZ } });
    assert.equal(r.status, 200);
    assert.equal(r.dados.url, 'wss://exemplo/exilados');
    assert.equal(r.dados.sala, `sala-${VOZ}`);
    const token = lerJwt(r.dados.token, SEGREDO_LK);
    assert.equal(token.sub, ANA);
    assert.equal(token.name, 'Ana');
    assert.equal(token.video.room, `sala-${VOZ}`);
    const texto = await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: TEXTO } });
    assert.equal(texto.status, 404);
    assert.equal(texto.dados.erro, 'A sala não existe mais.');
    assert.equal((await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: 'x' } })).status, 400);
  } finally { t.fechar(); }
});

test('login guardado por 60 s, mas a participação no grupo é conferida a cada pedido', async () => {
  const t = await montar();
  try {
    await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: VOZ } });
    await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: VOZ } });
    assert.equal(t.sb.banco.chamadasUsuario, 1);
    t.sb.banco.membros.get(ANA).ativo = false;
    assert.equal((await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: VOZ } })).status, 403);
  } finally { t.fechar(); }
});

test('dono remove membro: sai da voz, a live dele para e ele perde as permissões', async () => {
  const t = await montar();
  try {
    const live = await t.chamar('POST', '/live/comecar', { quem: ANA });
    assert.equal(live.status, 200);
    const r = await t.chamar('POST', '/membros/ativo', { quem: DONO, corpo: { usuario: ANA, ativo: false } });
    assert.equal(r.status, 200);
    assert.deepEqual(t.lk.estado.removidos, [`sala-${VOZ}/${ANA}`]);
    assert.deepEqual(t.mm.expulsos, [live.dados.caminho]);
    assert.equal(t.lives.podeEnviar(live.dados.caminho, ANA, live.dados.senha), false);
    assert.equal((await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: VOZ } })).status, 403);
    assert.equal((await t.chamar('POST', '/live/comecar', { quem: ANA })).status, 403);
    // Readmitir volta a dar acesso.
    assert.equal((await t.chamar('POST', '/membros/ativo', { quem: DONO, corpo: { usuario: ANA, ativo: true } })).status, 200);
    assert.equal((await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: VOZ } })).status, 200);
  } finally { t.fechar(); }
});

test('só o dono remove, e o dono não remove a si mesmo', async () => {
  const t = await montar();
  try {
    const r = await t.chamar('POST', '/membros/ativo', { quem: ANA, corpo: { usuario: DONO, ativo: false } });
    assert.equal(r.status, 403);
    const proprio = await t.chamar('POST', '/membros/ativo', { quem: DONO, corpo: { usuario: DONO, ativo: false } });
    assert.equal(proprio.status, 400);
    assert.equal(proprio.dados.erro, 'O dono não pode remover a si mesmo.');
    assert.equal((await t.chamar('POST', '/membros/ativo', { quem: DONO, corpo: { usuario: ANA, ativo: 'nao' } })).status, 400);
  } finally { t.fechar(); }
});

test('live: começar grava a linha, o MediaMTX aceita o envio, sinal atualiza e conta quem assiste', async () => {
  const t = await montar();
  try {
    const live = await t.chamar('POST', '/live/comecar', { quem: ANA });
    assert.match(live.dados.caminho, /^ex\/[A-Za-z0-9]{24}$/);
    assert.equal(live.dados.usuario, ANA);
    assert.equal(live.dados.rtsps, `rtsps://exemplo:8322/${live.dados.caminho}`);
    assert.equal(t.sb.banco.lives.get(ANA).caminho, live.dados.caminho);
    const envio = { action: 'publish', protocol: 'rtsp', path: live.dados.caminho, user: ANA, password: live.dados.senha };
    assert.equal(await autorizar(envio, { lives: t.lives }), true);
    t.relogio.t += 10000;
    const sinal = await t.chamar('POST', '/live/sinal', { quem: ANA });
    assert.equal(sinal.status, 200);
    assert.equal(sinal.dados.assistindo, 2);
    assert.equal(Date.parse(t.sb.banco.lives.get(ANA).ultimo_sinal), t.relogio.t);
  } finally { t.fechar(); }
});

test('assistir: membro recebe a permissão de leitura; o MediaMTX aceita só com ela', async () => {
  const t = await montar();
  try {
    const live = await t.chamar('POST', '/live/comecar', { quem: ANA });
    const r = await t.chamar('POST', '/live/assistir', { quem: DONO, corpo: { usuario: ANA } });
    assert.equal(r.status, 200);
    assert.equal(r.dados.caminho, live.dados.caminho);
    assert.equal(r.dados.assistindo, 2);
    const leitura = { action: 'read', protocol: 'webrtc', path: live.dados.caminho };
    assert.equal(await autorizar({ ...leitura, token: r.dados.token }, { lives: t.lives }), true);
    assert.equal(await autorizar(leitura, { lives: t.lives }), false);
    const fora = await t.chamar('POST', '/live/assistir', { quem: FORA, corpo: { usuario: ANA } });
    assert.equal(fora.status, 403);
  } finally { t.fechar(); }
});

test('atraso de 30 s no sinal não encerra a live; ausência prolongada recusa leitura', async () => {
  const t = await montar();
  try {
    const live = await t.chamar('POST', '/live/comecar', { quem: ANA });
    const token = (await t.chamar('POST', '/live/assistir', { quem: DONO, corpo: { usuario: ANA } })).dados.token;
    t.relogio.t += 30000;
    assert.equal((await t.chamar('POST', '/live/assistir', { quem: DONO, corpo: { usuario: ANA } })).status, 200);
    assert.equal(await autorizar({ action: 'read', path: live.dados.caminho, token }, { lives: t.lives }), true);
    t.relogio.t += 36000;
    const r = await t.chamar('POST', '/live/assistir', { quem: DONO, corpo: { usuario: ANA } });
    assert.equal(r.status, 404);
    assert.equal(r.dados.erro, 'A live terminou.');
    assert.equal(await autorizar({ action: 'read', path: live.dados.caminho, token }, { lives: t.lives }), false);
  } finally { t.fechar(); }
});

test('parar apaga a linha, derruba o envio e o sinal seguinte diz que a live terminou', async () => {
  const t = await montar();
  try {
    const live = await t.chamar('POST', '/live/comecar', { quem: ANA });
    assert.equal((await t.chamar('POST', '/live/parar', { quem: ANA })).status, 200);
    assert.equal(t.sb.banco.lives.has(ANA), false);
    assert.deepEqual(t.mm.expulsos, [live.dados.caminho]);
    const sinal = await t.chamar('POST', '/live/sinal', { quem: ANA });
    assert.equal(sinal.status, 404);
    assert.equal(sinal.dados.erro, 'A live terminou.');
    assert.equal((await t.chamar('POST', '/live/assistir', { quem: DONO, corpo: { usuario: ANA } })).status, 404);
  } finally { t.fechar(); }
});

test('corpo inválido ou grande demais é recusado sem derrubar o serviço', async () => {
  const t = await montar();
  try {
    const r = await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { sala: VOZ, lixo: 'x'.repeat(5000) } });
    assert.equal(r.status, 413);
    assert.equal((await t.chamar('GET', '/saude')).status, 200);
  } finally { t.fechar(); }
});

test('chamada na conversa direta: só os dois amigos recebem a permissão da sala da conversa', async () => {
  const t = await montar();
  try {
    const r = await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { conversa: CONVERSA } });
    assert.equal(r.status, 200);
    assert.equal(r.dados.sala, `conversa-${CONVERSA}`);
    assert.equal(lerJwt(r.dados.token, SEGREDO_LK).video.room, `conversa-${CONVERSA}`);
    t.sb.banco.membros.set(FORA, { user_id: FORA, nome: 'Outro', avatar: null, papel: 'membro', ativo: true });
    const outro = await t.chamar('POST', '/voz/entrar', { quem: FORA, corpo: { conversa: CONVERSA } });
    assert.equal(outro.status, 404);
    assert.equal((await t.chamar('POST', '/voz/entrar', { quem: ANA, corpo: { conversa: 'x' } })).status, 400);
  } finally { t.fechar(); }
});

test('presentes na voz: quem está em cada sala do grupo, sem as chamadas de conversa direta', async () => {
  const t = await montar();
  try {
    const r = await t.chamar('POST', '/voz/presentes', { quem: ANA });
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados.salas, { [VOZ]: [ANA] });
  } finally { t.fechar(); }
});

test('prévia de link: monta, guarda e serve a imagem só com a assinatura certa', async () => {
  const pedidos = [];
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
  const buscarWeb = async (url) => {
    pedidos.push(url);
    if (url === 'https://exemplo.com/post') {
      return {
        status: 200, url, cortado: false, cabecalhos: { 'content-type': 'text/html; charset=utf-8' },
        corpo: Buffer.from('<html><head><title>X</title><meta property="og:title" content="Título &amp; tal">'
          + '<meta property="og:image" content="/foto.png"><meta property="og:site_name" content="Exemplo"></head></html>'),
      };
    }
    if (url === 'https://exemplo.com/foto.png') return { status: 200, url, cortado: false, cabecalhos: { 'content-type': 'image/png' }, corpo: PNG };
    if (url === 'https://exemplo.com/feio.svg') return { status: 200, url, cortado: false, cabecalhos: { 'content-type': 'image/svg+xml' }, corpo: Buffer.from('<svg/>') };
    throw new Error('fora do ar');
  };
  const t = await montar({ buscarWeb });
  try {
    const r = await t.chamar('POST', '/previa', { quem: ANA, corpo: { url: 'https://exemplo.com/post' } });
    assert.equal(r.status, 200);
    assert.equal(r.dados.previa.titulo, 'Título & tal');
    assert.equal(r.dados.previa.site, 'Exemplo');
    assert.match(r.dados.previa.imagem, /^\/exilados\/api\/midia\?u=/);
    await t.chamar('POST', '/previa', { quem: ANA, corpo: { url: 'https://exemplo.com/post' } });
    assert.equal(pedidos.filter((u) => u === 'https://exemplo.com/post').length, 1, 'a segunda vez vem guardada');
    const imagem = await t.chamar('GET', r.dados.previa.imagem.replace('/exilados/api', ''));
    assert.equal(imagem.status, 200);
    assert.equal(imagem.tipo, 'image/png');
    assert.deepEqual(imagem.dados, PNG);
    const forjada = await t.chamar('GET', `/midia?u=${encodeURIComponent('https://exemplo.com/feio.svg')}&a=AAAAAAAAAAAAAAAAAAAAAA`);
    assert.equal(forjada.status, 404);
    const fora = await t.chamar('POST', '/previa', { quem: ANA, corpo: { url: 'https://fora.com/' } });
    assert.equal(fora.dados.previa, null);
    assert.equal((await t.chamar('POST', '/previa', { quem: ANA, corpo: { url: 'file:///etc/passwd' } })).status, 400);
    assert.equal((await t.chamar('POST', '/previa', { corpo: { url: 'https://exemplo.com/post' } })).status, 401);
  } finally { t.fechar(); }
});

test('GIFs: desligados sem chave; com chave, lista e serve só imagens do Giphy', async () => {
  const sem = await montar();
  try {
    assert.equal((await sem.chamar('GET', '/saude')).dados.gifs, false);
    assert.equal((await sem.chamar('POST', '/gifs', { quem: ANA, corpo: {} })).status, 404);
  } finally { sem.fechar(); }
  const gifs = { ligado: true, listar: async (busca) => [{ id: '1', titulo: busca || 'popular', url: 'https://media1.giphy.com/media/1/giphy.webp', previa: 'https://media1.giphy.com/media/1/200w.webp', largura: 200, altura: 100 }] };
  const servidos = [];
  const buscarWeb = async (url) => { servidos.push(url); return { status: 200, url, cortado: false, cabecalhos: { 'content-type': 'image/webp' }, corpo: Buffer.from('RIFF') }; };
  const t = await montar({ gifs, buscarWeb });
  try {
    assert.equal((await t.chamar('GET', '/saude')).dados.gifs, true);
    const r = await t.chamar('POST', '/gifs', { quem: ANA, corpo: { busca: 'gato' } });
    assert.equal(r.dados.gifs[0].titulo, 'gato');
    const ok = await t.chamar('GET', `/gif?u=${encodeURIComponent('https://media1.giphy.com/media/1/200w.webp')}`);
    assert.equal(ok.status, 200);
    const fora = await t.chamar('GET', `/gif?u=${encodeURIComponent('https://exemplo.com/x.webp')}`);
    assert.equal(fora.status, 404);
    assert.deepEqual(servidos, ['https://media1.giphy.com/media/1/200w.webp']);
  } finally { t.fechar(); }
});
