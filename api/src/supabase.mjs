// Supabase do FilaBox, sempre com o login da própria pessoa: as regras de acesso do banco valem também aqui.
// O exilados-api não tem a chave mestra.
import { createHash } from 'node:crypto';

const CACHE_MS = 60000;

export class ErroSupabase extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

export class Supabase {
  constructor({ url, chave, fetch = globalThis.fetch, agora = () => Date.now() }) {
    this.url = url.replace(/\/$/, '');
    this.chave = chave;
    this.fetch = fetch;
    this.agora = agora;
    this.cache = new Map();
  }

  async #pedir(token, caminho, { method = 'GET', body, prefer } = {}) {
    const headers = { apikey: this.chave, authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (prefer) headers.prefer = prefer;
    const resposta = await this.fetch(`${this.url}${caminho}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const texto = await resposta.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    if (!resposta.ok) {
      throw new ErroSupabase(dados?.message || dados?.msg || `Supabase respondeu ${resposta.status}`, resposta.status);
    }
    return dados;
  }

  /** Id da conta dona do token, ou null se o login não vale. Guarda por 60 s. */
  async usuario(token) {
    if (!token || token.length > 4096) return null;
    const chave = createHash('sha256').update(token).digest('hex');
    const guardado = this.cache.get(chave);
    if (guardado && guardado.ate > this.agora()) return guardado.id;
    let id = null;
    try {
      const dados = await this.#pedir(token, '/auth/v1/user');
      id = typeof dados?.id === 'string' ? dados.id : null;
    } catch (erro) {
      if (erro.status && erro.status < 500) id = null;
      else throw erro;
    }
    if (id) {
      if (this.cache.size > 500) {
        for (const [k, v] of this.cache) if (v.ate <= this.agora()) this.cache.delete(k);
      }
      this.cache.set(chave, { id, ate: this.agora() + CACHE_MS });
    }
    return id;
  }

  async membro(token, id) {
    const linhas = await this.#pedir(token, `/rest/v1/exilados_membros?user_id=eq.${encodeURIComponent(id)}&select=user_id,nome,avatar,papel,ativo`);
    return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
  }

  async sala(token, id) {
    const linhas = await this.#pedir(token, `/rest/v1/exilados_salas?id=eq.${encodeURIComponent(id)}&select=id,nome,tipo`);
    return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
  }

  /** A conversa direta, se a pessoa faz parte dela e ainda é amiga do outro (as regras do banco decidem). */
  async conversa(token, id) {
    const linhas = await this.#pedir(token, `/rest/v1/exilados_conversas?id=eq.${encodeURIComponent(id)}&select=id,a,b`);
    return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
  }

  async rpc(token, nome, args) {
    return this.#pedir(token, `/rest/v1/rpc/${nome}`, { method: 'POST', body: args ?? {} });
  }

  async gravarLive(token, id, caminho) {
    const agora = new Date(this.agora()).toISOString();
    await this.#pedir(token, '/rest/v1/exilados_lives?on_conflict=user_id', {
      method: 'POST',
      body: { user_id: id, caminho, comecou_em: agora, ultimo_sinal: agora },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  /** Atualiza o sinal de vida; devolve a linha da live (com o caminho) ou null se ela não existe mais. */
  async sinalLive(token, id) {
    const linhas = await this.#pedir(token, `/rest/v1/exilados_lives?user_id=eq.${encodeURIComponent(id)}&select=user_id,caminho,ultimo_sinal`, {
      method: 'PATCH',
      body: { ultimo_sinal: new Date(this.agora()).toISOString() },
      prefer: 'return=representation',
    });
    return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
  }

  async apagarLive(token, id) {
    await this.#pedir(token, `/rest/v1/exilados_lives?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
  }

  async liveDe(token, id) {
    const linhas = await this.#pedir(token, `/rest/v1/exilados_lives?user_id=eq.${encodeURIComponent(id)}&select=user_id,caminho,ultimo_sinal`);
    return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
  }
}
