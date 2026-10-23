// Chamadas ao exilados-api (/exilados/api/), sempre com um login do Supabase válido: se ele vence em menos de
// 1 minuto, renova antes de chamar. Leva a versão do site: o servidor recusa (426) versão mais velha que a mínima.

export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

export function criarApi({
  base, obterSessao, renovarSessao, versao = '', aoVersaoVelha = () => {}, fetch = globalThis.fetch.bind(globalThis),
  agora = () => Date.now(),
}) {
  async function token() {
    let sessao = await obterSessao();
    if (!sessao) throw new ErroApi('Entre na sua conta de novo.', 401);
    if (sessao.expires_at * 1000 - agora() < 60000) {
      sessao = await renovarSessao();
      if (!sessao) throw new ErroApi('Entre na sua conta de novo.', 401);
    }
    return sessao.access_token;
  }

  async function chamar(caminho, corpo = {}) {
    const autorizacao = `Bearer ${await token()}`;
    let resposta;
    try {
      resposta = await fetch(`${base}${caminho}`, {
        method: 'POST',
        headers: { authorization: autorizacao, 'content-type': 'application/json', 'x-exilados-site': versao },
        body: JSON.stringify(corpo),
      });
    } catch {
      throw new ErroApi('Sem conexão com o servidor. Tente de novo.', 0);
    }
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 426) aoVersaoVelha();
    if (!resposta.ok) throw new ErroApi(dados.erro || 'O servidor não respondeu. Tente de novo.', resposta.status);
    return dados;
  }

  /** Diferença entre o relógio do servidor e o deste aparelho (ms), para saber se uma live ainda está no ar. */
  async function diferencaDoRelogio() {
    const antes = agora();
    const resposta = await fetch(`${base}/saude`, { cache: 'no-store' });
    const { agora: doServidor } = await resposta.json();
    const depois = agora();
    return doServidor - (antes + depois) / 2;
  }

  return { token, chamar, diferencaDoRelogio };
}
