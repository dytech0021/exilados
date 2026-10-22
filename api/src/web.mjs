// Busca páginas e imagens de fora para as prévias de links e os GIFs, com os cuidados do proxy do Stoat: só http(s),
// só endereços públicos (o nome é resolvido antes e a conexão vai para o IP conferido, o que barra truques de DNS),
// redirecionamentos conferidos um a um, prazo e tamanho máximo.
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const BLOQUEADOS = new BlockList();
for (const [rede, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOQUEADOS.addSubnet(rede, bits, 'ipv4');
for (const [rede, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOQUEADOS.addSubnet(rede, bits, 'ipv6');

export const AGENTE = 'Mozilla/5.0 (compatible; ExiladosBot/1.0; +https://filabox3d.com.br/exilados/)';

export class ErroWeb extends Error {}

/** O IP é da internet (não da rede local, do próprio servidor ou reservado). */
export function ipPublico(ip) {
  // IPv4 escrito como IPv6 (::ffff:127.0.0.1) vale pelo IPv4 de dentro.
  const embutido = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(String(ip))?.[1];
  if (embutido) return ipPublico(embutido);
  const tipo = isIP(ip);
  if (!tipo) return false;
  return !BLOQUEADOS.check(ip, tipo === 4 ? 'ipv4' : 'ipv6');
}

/** O endereço pode ser buscado: http(s), sem usuário e senha, porta comum. */
export function enderecoAceito(texto) {
  let url;
  try { url = new URL(texto); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) return null;
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return null;
  return url;
}

async function resolverPublico(nome, resolver) {
  const limpo = nome.replace(/^\[|\]$/g, '');
  const enderecos = isIP(limpo) ? [{ address: limpo, family: isIP(limpo) }] : await resolver(limpo, { all: true });
  if (!enderecos.length || !enderecos.every((e) => ipPublico(e.address))) throw new ErroWeb('Endereço não permitido.');
  return enderecos[0];
}

function pedirUmaVez(url, ip, { prazo, maxBytes, cabecalhos }) {
  return new Promise((resolve, reject) => {
    const modulo = url.protocol === 'https:' ? https : http;
    const pedido = modulo.request(url, {
      method: 'GET',
      headers: { 'user-agent': AGENTE, accept: '*/*', 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7', ...cabecalhos },
      // A conexão vai para o IP já conferido (o nome continua no certificado e no Host).
      lookup: (_nome, opcoes, devolver) => (opcoes?.all
        ? devolver(null, [{ address: ip.address, family: ip.family }])
        : devolver(null, ip.address, ip.family)),
      timeout: prazo,
    }, (resposta) => {
      const partes = [];
      let total = 0;
      resposta.on('data', (parte) => {
        total += parte.length;
        if (total > maxBytes) {
          resposta.destroy();
          // Para páginas, o começo basta (as etiquetas da prévia ficam no <head>).
          resolve({ status: resposta.statusCode, cabecalhos: resposta.headers, corpo: Buffer.concat(partes), cortado: true });
          return;
        }
        partes.push(parte);
      });
      resposta.on('end', () => resolve({ status: resposta.statusCode, cabecalhos: resposta.headers, corpo: Buffer.concat(partes), cortado: false }));
      resposta.on('error', reject);
    });
    pedido.on('timeout', () => pedido.destroy(new ErroWeb('O site demorou demais.')));
    pedido.on('error', reject);
    pedido.end();
  });
}

/**
 * Busca `endereco` seguindo até 4 redirecionamentos (cada um conferido). Devolve { status, cabecalhos, corpo, url,
 * cortado }. `maxBytes`: além disso, o corpo vem cortado (`cortado`).
 */
export async function buscar(endereco, { prazo = 6000, maxBytes = 1024 * 1024, cabecalhos = {}, resolver = lookup } = {}) {
  let url = enderecoAceito(endereco);
  for (let pulo = 0; pulo <= 4; pulo += 1) {
    if (!url) throw new ErroWeb('Endereço não permitido.');
    const ip = await resolverPublico(url.hostname, resolver);
    const resposta = await pedirUmaVez(url, ip, { prazo, maxBytes, cabecalhos });
    if (resposta.status >= 300 && resposta.status < 400 && resposta.cabecalhos.location) {
      url = enderecoAceito(new URL(resposta.cabecalhos.location, url).href);
      continue;
    }
    return { ...resposta, url: url.href };
  }
  throw new ErroWeb('Redirecionamentos demais.');
}
