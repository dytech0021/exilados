// Servidor do modo de demonstração: serve site/ em http://localhost:5180/exilados/ trocando o Supabase pelo de
// mentira (supabase-falso.js) e respondendo a API. Com LIVEKIT_CHAVE e LIVEKIT_SEGREDO no ambiente, a sala de voz
// usa o LiveKit de verdade (wss://filabox3d.com.br/exilados) com a identidade de demonstração.
// Com ATUALIZACAO=pasta no ambiente, /exilados/atualizacao/ vem dessa pasta (Exilados.exe e manifest.json de teste,
// usados por ferramentas/teste-atualizacao.ps1).
// Uso: node ferramentas/demo/servidor.mjs
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenDoLiveKit } from '../../api/src/jwt.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
// Chave do LiveKit para testar a voz de verdade: variáveis de ambiente ou um arquivo (--livekit arquivo) com
// LIVEKIT_CHAVE=... e LIVEKIT_SEGREDO=... (fora do repositório) e, para um LiveKit local, LIVEKIT_URL=ws://localhost:7880.
const posicao = process.argv.indexOf('--livekit');
if (posicao > 0) {
  for (const linha of (await readFile(process.argv[posicao + 1], 'utf8')).split(/\r?\n/)) {
    const [nome, ...resto] = linha.split('=');
    if (/^LIVEKIT_(CHAVE|SEGREDO|URL)$/.test(nome.trim())) process.env[nome.trim()] = resto.join('=').trim();
  }
}
const site = path.resolve(aqui, '../../site');
const atualizacao = process.env.ATUALIZACAO ? path.resolve(process.env.ATUALIZACAO) : null;
const porta = Number(process.env.PORTA || 5180);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function json(resposta, status, dados) {
  resposta.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  resposta.end(JSON.stringify(dados));
}

// Quem chama: a aba da demonstração manda "demo-<id>" como sessão (?como=lucas entra como o Lucas).
const NOMES = {
  '00000000-0000-4000-8000-000000000001': 'Dyego',
  '00000000-0000-4000-8000-000000000002': 'Lucas',
  '00000000-0000-4000-8000-000000000003': 'Marina',
  '00000000-0000-4000-8000-000000000004': 'Bia',
};

async function api(caminho, corpo, resposta, autorizacao = '') {
  const quem = /^Bearer demo-([0-9a-f-]{36})$/.exec(autorizacao)?.[1];
  const identidade = NOMES[quem] ? quem : '00000000-0000-4000-8000-000000000001';
  if (caminho === '/saude') return json(resposta, 200, { ok: true, agora: Date.now() });
  if (caminho === '/voz/entrar') {
    if (!process.env.LIVEKIT_CHAVE || !process.env.LIVEKIT_SEGREDO) return json(resposta, 503, { erro: 'Voz indisponível na demonstração (sem chave do LiveKit).' });
    const sala = `sala-${corpo.sala}`;
    return json(resposta, 200, {
      url: process.env.LIVEKIT_URL || 'wss://filabox3d.com.br/exilados',
      sala,
      token: tokenDoLiveKit({ chave: process.env.LIVEKIT_CHAVE, segredo: process.env.LIVEKIT_SEGREDO, identidade, nome: NOMES[identidade], sala: process.env.SALA_TESTE || sala }),
    });
  }
  if (caminho === '/live/assistir') return json(resposta, 404, { erro: 'A live terminou.' });
  if (caminho === '/membros/ativo') return json(resposta, 200, { ok: true });
  return json(resposta, 404, { erro: 'Não encontrado.' });
}

http.createServer(async (pedido, resposta) => {
  const url = new URL(pedido.url, 'http://local');
  if (url.pathname === '/' || url.pathname === '/exilados') {
    resposta.writeHead(302, { location: '/exilados/' });
    return resposta.end();
  }
  if (url.pathname.startsWith('/exilados/api/')) {
    let texto = '';
    for await (const parte of pedido) texto += parte;
    return api(url.pathname.slice('/exilados/api'.length), texto ? JSON.parse(texto) : {}, resposta, pedido.headers.authorization);
  }
  if (!url.pathname.startsWith('/exilados/')) {
    resposta.writeHead(404);
    return resposta.end();
  }
  let relativo = decodeURIComponent(url.pathname.slice('/exilados/'.length)) || 'index.html';
  if (relativo.endsWith('/')) relativo += 'index.html';
  let arquivo = path.resolve(site, relativo);
  if (atualizacao && relativo.startsWith('atualizacao/')) {
    arquivo = path.resolve(atualizacao, relativo.slice('atualizacao/'.length));
    if (!arquivo.startsWith(atualizacao + path.sep)) {
      resposta.writeHead(403);
      return resposta.end();
    }
  }
  if (relativo === 'vendor/supabase-2.117.2.js') arquivo = path.join(aqui, 'supabase-falso.js');
  if (relativo === 'sw.js') {
    // Sem service worker na demonstração (para não guardar a versão de mentira).
    resposta.writeHead(404);
    return resposta.end();
  }
  if (!arquivo.startsWith(site) && !arquivo.startsWith(aqui) && !(atualizacao && arquivo.startsWith(atualizacao + path.sep))) {
    resposta.writeHead(403);
    return resposta.end();
  }
  try {
    const dados = await readFile(arquivo);
    resposta.writeHead(200, { 'content-type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'cache-control': 'no-store' });
    resposta.end(dados);
  } catch {
    resposta.writeHead(404);
    resposta.end();
  }
}).listen(porta, '127.0.0.1', () => console.log(`Demonstração em http://localhost:${porta}/exilados/`));
