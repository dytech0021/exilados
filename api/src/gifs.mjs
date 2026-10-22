// Busca de GIFs pelo Giphy (a chave fica só no servidor). As imagens chegam ao site pelo próprio exilados-api
// (GET /gif), só dos servidores do Giphy.

export const HOST_GIF = /^(media[0-9]?|i)\.giphy\.com$/;

/** Endereço de GIF que o /gif aceita servir: https, servidor do Giphy. */
export function gifAceito(texto) {
  let url;
  try { url = new URL(texto); } catch { return null; }
  return url.protocol === 'https:' && HOST_GIF.test(url.hostname) && !url.username && !url.port ? url : null;
}

function resumir(item) {
  const original = item?.images?.original || {};
  const pequeno = item?.images?.fixed_width || original;
  const url = original.webp || original.url;
  const previa = pequeno.webp || pequeno.url || url;
  if (!url || !gifAceito(url) || !gifAceito(previa)) return null;
  return {
    id: String(item.id || ''),
    titulo: String(item.title || '').slice(0, 120),
    url: url.split('?')[0],
    previa: previa.split('?')[0],
    largura: Number(original.width) || Number(pequeno.width) || 200,
    altura: Number(original.height) || Number(pequeno.height) || 200,
  };
}

export class Gifs {
  constructor({ chave, fetch = globalThis.fetch }) {
    this.chave = chave;
    this.fetch = fetch;
  }

  get ligado() {
    return Boolean(this.chave);
  }

  /** Os mais populares (sem `busca`) ou os que combinam com `busca`; 24 por página. */
  async listar(busca, pagina = 0) {
    const q = String(busca || '').trim().slice(0, 50);
    const parametros = new URLSearchParams({ api_key: this.chave, limit: '24', offset: String(Math.max(0, Math.min(10, pagina)) * 24), rating: 'pg-13' });
    if (q) {
      parametros.set('q', q);
      parametros.set('lang', 'pt');
    }
    const resposta = await this.fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${parametros}`, { signal: AbortSignal.timeout(6000) });
    if (!resposta.ok) throw new Error(`Giphy respondeu ${resposta.status}`);
    const dados = await resposta.json();
    return (dados.data || []).map(resumir).filter(Boolean);
  }
}
