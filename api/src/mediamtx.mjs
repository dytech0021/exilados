// Autorização do MediaMTX e consultas à API dele (só em 127.0.0.1).
//
// O MediaMTX pergunta, a cada conexão: { user, password, token, ip, action, path, protocol, id, query }.
// Caminhos ex/... são do Exilados; o resto vai para o relay do Ponte enquanto ele ainda tiver lives.
import { CAMINHO } from './lives.mjs';

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function tokenDe(pedido) {
  if (pedido.token) return String(pedido.token);
  if (pedido.password) return String(pedido.password);
  const consulta = new URLSearchParams(String(pedido.query || ''));
  return consulta.get('token') || consulta.get('jwt') || '';
}

export async function autorizar(pedido, { lives, repassar }) {
  if (!pedido || typeof pedido !== 'object') return false;
  const acao = String(pedido.action || '');
  const caminho = String(pedido.path || '');
  if (acao === 'api') return LOCAL.has(String(pedido.ip));
  if (CAMINHO.test(caminho)) {
    if (acao === 'publish') return lives.podeEnviar(caminho, String(pedido.user || ''), String(pedido.password || ''));
    if (acao === 'read') return lives.podeLer(caminho, tokenDe(pedido));
    return false;
  }
  if (caminho.startsWith('ex/') || !repassar) return false;
  return repassar(pedido);
}

/** Repassa a pergunta, como veio, à autorização do relay do Ponte. */
export function repassarPara(url, fetch = globalThis.fetch) {
  if (!url) return null;
  return async (pedido) => {
    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pedido),
        signal: AbortSignal.timeout(3000),
      });
      return resposta.ok;
    } catch {
      return false;
    }
  };
}

export class MediaMTX {
  constructor({ api, fetch = globalThis.fetch }) {
    this.api = api.replace(/\/$/, '');
    this.fetch = fetch;
  }

  async #caminho(caminho) {
    const resposta = await this.fetch(`${this.api}/v3/paths/get/${caminho}`, { signal: AbortSignal.timeout(3000) });
    if (resposta.status === 404) return null;
    if (!resposta.ok) throw new Error(`MediaMTX respondeu ${resposta.status}`);
    return resposta.json();
  }

  /** Quantos estão assistindo agora; -1 quando não deu para saber. */
  async leitores(caminho) {
    try {
      const dados = await this.#caminho(caminho);
      if (!dados) return 0;
      return Array.isArray(dados.readers) ? dados.readers.length : -1;
    } catch {
      return -1;
    }
  }

  /** Derruba quem está enviando para `caminho` (membro removido ou live parada). */
  async expulsar(caminho) {
    try {
      const fonte = (await this.#caminho(caminho))?.source;
      const tipos = { rtspSession: 'rtspsessions', rtspsSession: 'rtspssessions' };
      if (!fonte || !tipos[fonte.type] || !fonte.id) return false;
      const resposta = await this.fetch(`${this.api}/v3/${tipos[fonte.type]}/kick/${fonte.id}`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      });
      return resposta.ok;
    } catch {
      return false;
    }
  }
}
