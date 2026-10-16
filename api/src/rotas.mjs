// Rotas públicas do exilados-api (atrás do nginx em /exilados/api/).
//
// Todo pedido, menos /saude, traz o login do Supabase (Authorization: Bearer) de um membro ativo do grupo.
import { tokenDoLiveKit } from './jwt.mjs';
import { SEM_SINAL_MS } from './lives.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CORPO = 4096;
// Tolerância para relógios um pouco diferentes entre o serviço e o banco.
const FOLGA_MS = 5000;

class Recusa extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function lerCorpo(pedido) {
  return new Promise((resolve, reject) => {
    let texto = '';
    let grande = false;
    pedido.setEncoding('utf8');
    pedido.on('data', (parte) => {
      if (grande) return;
      texto += parte;
      if (texto.length > MAX_CORPO) {
        grande = true;
        texto = '';
      }
    });
    pedido.on('end', () => {
      if (grande) return reject(new Recusa(413, 'Pedido grande demais.'));
      if (!texto) return resolve({});
      try {
        const dados = JSON.parse(texto);
        resolve(dados && typeof dados === 'object' ? dados : {});
      } catch {
        reject(new Recusa(400, 'Pedido inválido.'));
      }
    });
    pedido.on('error', reject);
  });
}

function responder(resposta, status, dados) {
  const corpo = JSON.stringify(dados);
  resposta.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(corpo),
  });
  resposta.end(corpo);
}

export function criarRotas({ supabase, livekit, lives, mediamtx, config, agora = () => Date.now(), registrar = console.error }) {
  async function quemPede(pedido) {
    const cabecalho = String(pedido.headers.authorization || '');
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (!token) throw new Recusa(401, 'Entre na sua conta de novo.');
    const id = await supabase.usuario(token);
    if (!id) throw new Recusa(401, 'Entre na sua conta de novo.');
    const membro = await supabase.membro(token, id);
    if (!membro || !membro.ativo) throw new Recusa(403, 'Você não faz mais parte do grupo.');
    return { token, id, membro };
  }

  const rotas = {
    async 'POST /voz/entrar'({ token, id, membro }, corpo) {
      const salaId = String(corpo.sala || '');
      if (!UUID.test(salaId)) throw new Recusa(400, 'Sala inválida.');
      const sala = await supabase.sala(token, salaId);
      if (!sala || sala.tipo !== 'voz') throw new Recusa(404, 'A sala não existe mais.');
      const nomeSala = `sala-${salaId}`;
      return {
        url: config.urlVoz,
        sala: nomeSala,
        token: tokenDoLiveKit({
          chave: config.livekitChave,
          segredo: config.livekitSegredo,
          identidade: id,
          nome: membro.nome,
          sala: nomeSala,
          segundos: 600,
          agora: agora(),
        }),
      };
    },

    async 'POST /membros/ativo'({ token, membro }, corpo) {
      if (membro.papel !== 'dono') throw new Recusa(403, 'Só o dono do grupo pode fazer isso.');
      const usuario = String(corpo.usuario || '');
      if (!UUID.test(usuario) || typeof corpo.ativo !== 'boolean') throw new Recusa(400, 'Pedido inválido.');
      try {
        await supabase.rpc(token, 'exilados_definir_ativo', { alvo: usuario, valor: corpo.ativo });
      } catch (erro) {
        if (erro.status && erro.status < 500) throw new Recusa(400, erro.message);
        throw erro;
      }
      if (!corpo.ativo) {
        try {
          await livekit.tirarDeTodas(usuario);
        } catch (erro) {
          registrar(`Não deu para tirar ${usuario} da voz: ${erro.message}`);
        }
        const caminho = lives.parar(usuario);
        if (caminho) await mediamtx.expulsar(caminho);
      }
      return { ok: true };
    },

    async 'POST /live/comecar'({ token, id }) {
      const live = lives.comecar(id);
      try {
        await supabase.gravarLive(token, id, live.caminho);
      } catch (erro) {
        lives.parar(id);
        throw erro;
      }
      return { ...live, rtsps: `${config.rtsps}/${live.caminho}` };
    },

    async 'POST /live/sinal'({ token, id }) {
      const linha = await supabase.sinalLive(token, id);
      if (!linha || !lives.sinal(id, linha.caminho)) {
        lives.parar(id);
        throw new Recusa(404, 'A live terminou.');
      }
      return { assistindo: await mediamtx.leitores(linha.caminho) };
    },

    async 'POST /live/parar'({ token, id }) {
      const caminho = lives.parar(id);
      await supabase.apagarLive(token, id);
      if (caminho) await mediamtx.expulsar(caminho);
      return { ok: true };
    },

    async 'POST /live/assistir'({ token }, corpo) {
      const usuario = String(corpo.usuario || '');
      if (!UUID.test(usuario)) throw new Recusa(400, 'Pedido inválido.');
      const linha = await supabase.liveDe(token, usuario);
      const sinal = linha ? Date.parse(linha.ultimo_sinal) : NaN;
      if (!linha || !(agora() - sinal <= SEM_SINAL_MS + FOLGA_MS) || lives.encerrada(linha.caminho)) {
        throw new Recusa(404, 'A live terminou.');
      }
      return {
        caminho: linha.caminho,
        token: lives.leitura(linha.caminho),
        assistindo: await mediamtx.leitores(linha.caminho),
      };
    },
  };

  return async function (pedido, resposta) {
    try {
      const url = new URL(pedido.url, 'http://local');
      const caminho = url.pathname.replace(/^\/exilados\/api/, '') || '/';
      if (pedido.method === 'GET' && caminho === '/saude') {
        return responder(resposta, 200, { ok: true, agora: agora() });
      }
      const rota = rotas[`${pedido.method} ${caminho}`];
      if (!rota) throw new Recusa(404, 'Não encontrado.');
      const corpo = await lerCorpo(pedido);
      const quem = await quemPede(pedido);
      responder(resposta, 200, await rota(quem, corpo));
    } catch (erro) {
      if (erro instanceof Recusa) return responder(resposta, erro.status, { erro: erro.message });
      registrar(`Erro em ${pedido.method} ${pedido.url}: ${erro.stack || erro.message}`);
      responder(resposta, 502, { erro: 'O servidor não conseguiu responder agora. Tente de novo.' });
    }
  };
}

/** Recebe as perguntas do MediaMTX (só em 127.0.0.1) e responde 200 (pode) ou 401 (não pode). */
export function criarAutorizacaoHttp(autorizar) {
  return (pedido, resposta) => {
    if (pedido.method !== 'POST') {
      resposta.writeHead(404);
      return resposta.end();
    }
    let texto = '';
    pedido.setEncoding('utf8');
    pedido.on('data', (parte) => {
      texto += parte;
      if (texto.length > 16384) pedido.destroy();
    });
    pedido.on('end', async () => {
      let pode = false;
      try { pode = await autorizar(JSON.parse(texto)); } catch { pode = false; }
      resposta.writeHead(pode ? 200 : 401);
      resposta.end();
    });
  };
}
