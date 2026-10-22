// Prévia de links das mensagens, como no Discord: título, descrição, imagem e nome do site. YouTube pelo oEmbed,
// posts do X/Twitter pelo FxTwitter e o resto pelas etiquetas Open Graph da página. As imagens saem pelo próprio
// exilados-api (endereço assinado), para quem vê a mensagem não ter o IP mostrado aos outros sites.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { buscar, enderecoAceito } from './web.mjs';

const YOUTUBE = /^(?:https?:)?\/\/(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const POST_X = /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})/i;
const MAX_TEXTO = 300;

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodificar(texto) {
  return String(texto || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, nome) => {
    if (nome[0] === '#') {
      const codigo = nome[1].toLowerCase() === 'x' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo < 0x110000 ? String.fromCodePoint(codigo) : '';
    }
    return ENTIDADES[nome.toLowerCase()] ?? inteiro;
  });
}

function curto(texto, limite = MAX_TEXTO) {
  const limpo = decodificar(texto).replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

function atributos(etiqueta) {
  const lista = {};
  for (const [, nome, , aspas1, aspas2, solto] of etiqueta.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    lista[nome.toLowerCase()] = aspas1 ?? aspas2 ?? solto ?? '';
  }
  return lista;
}

/** Lê as etiquetas da prévia de um HTML (só o <head> interessa). */
export function lerMetadados(html, base) {
  const cabeca = String(html).slice(0, 400000);
  const meta = {};
  for (const [etiqueta] of cabeca.matchAll(/<meta\b[^>]*>/gi)) {
    const a = atributos(etiqueta);
    const chave = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (chave && a.content !== undefined && !(chave in meta)) meta[chave] = a.content;
  }
  const titulo = meta['og:title'] || meta['twitter:title'] || /<title[^>]*>([^<]*)<\/title>/i.exec(cabeca)?.[1] || '';
  const imagem = meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
  let imagemAbsoluta = null;
  if (imagem) {
    try { imagemAbsoluta = new URL(decodificar(imagem), base).href; } catch { imagemAbsoluta = null; }
  }
  const cor = /^#[0-9a-f]{3,8}$/i.test(meta['theme-color'] || '') ? meta['theme-color'] : null;
  return {
    titulo: curto(titulo, 200),
    descricao: curto(meta['og:description'] || meta['twitter:description'] || meta.description || ''),
    site: curto(meta['og:site_name'] || '', 80),
    imagem: imagemAbsoluta,
    imagemGrande: (meta['twitter:card'] || '') === 'summary_large_image',
    cor,
  };
}

export function idDoYoutube(url) {
  return YOUTUBE.exec(url)?.[1] || null;
}

export function postDoX(url) {
  const achado = POST_X.exec(url);
  return achado ? { usuario: achado[1], id: achado[2] } : null;
}

/** Endereço assinado de uma imagem de fora, servido pelo exilados-api (GET /midia). */
export function assinarMidia(url, segredo) {
  const a = createHmac('sha256', segredo).update(url).digest('base64url').slice(0, 22);
  return `/exilados/api/midia?u=${encodeURIComponent(url)}&a=${a}`;
}

export function conferirMidia(url, assinatura, segredo) {
  const esperado = Buffer.from(createHmac('sha256', segredo).update(String(url)).digest('base64url').slice(0, 22));
  const recebido = Buffer.from(String(assinatura || ''));
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

async function json(endereco, buscarWeb) {
  const r = await buscarWeb(endereco, { maxBytes: 256 * 1024, cabecalhos: { accept: 'application/json' } });
  if (r.status !== 200) return null;
  try { return JSON.parse(r.corpo.toString('utf8')); } catch { return null; }
}

/**
 * Monta a prévia de `endereco`, ou null se não houver nada para mostrar. `buscarWeb` é a busca segura (web.mjs);
 * `segredo` assina os endereços das imagens.
 */
export async function montarPrevia(endereco, { segredo, buscarWeb = buscar }) {
  const url = enderecoAceito(endereco);
  if (!url) return null;
  const midia = (img) => (img && enderecoAceito(img) ? assinarMidia(img, segredo) : null);

  const youtube = idDoYoutube(url.href);
  if (youtube) {
    const dados = await json(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtube}`)}`, buscarWeb);
    if (dados) {
      return {
        url: url.href, tipo: 'youtube', site: 'YouTube', titulo: curto(dados.title, 200), descricao: curto(dados.author_name, 100),
        imagem: midia(`https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`), grande: true, cor: '#FF0000',
      };
    }
  }

  const post = postDoX(url.href);
  if (post) {
    const dados = await json(`https://api.fxtwitter.com/${post.usuario}/status/${post.id}`, buscarWeb);
    const t = dados?.tweet;
    if (t) {
      const foto = t.media?.photos?.[0]?.url || t.media?.videos?.[0]?.thumbnail_url || null;
      return {
        url: url.href, tipo: 'x', site: 'X (Twitter)', titulo: curto(`${t.author?.name || ''} (@${t.author?.screen_name || post.usuario})`, 200),
        descricao: curto(t.text || '', 500), imagem: midia(foto), grande: Boolean(foto), cor: '#1D9BF0',
      };
    }
  }

  const r = await buscarWeb(url.href, { maxBytes: 512 * 1024, cabecalhos: { accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5' } });
  if (r.status !== 200) return null;
  const tipo = String(r.cabecalhos['content-type'] || '').toLowerCase();
  if (tipo.startsWith('image/')) {
    return { url: url.href, tipo: 'imagem', site: '', titulo: '', descricao: '', imagem: midia(r.url), grande: true, cor: null };
  }
  if (!tipo.includes('html')) return null;
  const m = lerMetadados(r.corpo.toString('utf8'), r.url);
  if (!m.titulo && !m.descricao && !m.imagem) return null;
  return {
    url: url.href, tipo: 'site', site: m.site || new URL(r.url).hostname.replace(/^www\./, ''), titulo: m.titulo, descricao: m.descricao,
    imagem: midia(m.imagem), grande: m.imagemGrande, cor: m.cor,
  };
}
