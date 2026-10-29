// Rotas públicas do exilados-api (atrás do nginx em /exilados/api/).
//
// Todo pedido, menos /saude, /midia e /gif (imagens que o site mostra), traz o login do Supabase (Authorization:
// Bearer) de um membro ativo do grupo.
import { readFileSync } from 'node:fs';
import { gifAceito } from './gifs.mjs';
import { tokenDoLiveKit } from './jwt.mjs';
import { SEM_SINAL_MS } from './lives.mjs';
import { conferirMidia, montarPrevia } from './previa.mjs';
import { buscar, enderecoAceito } from './web.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CORPO = 4096;
// Tolerância para relógios um pouco diferentes entre o serviço e o banco.
const FOLGA_MS = 5000;
const PREVIA_MS = 6 * 60 * 60 * 1000;
const PRESENTES_MS = 3000;
// Imagens de fora: nunca SVG (pode trazer código) nem outra coisa que não imagem.
const TIPO_IMAGEM = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

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

/** Limite simples de pedidos por pessoa: `quantos` a cada `janela` ms. */
function criarLimite(quantos, janela, agora) {
  const contas = new Map();
  return (id) => {
    const t = agora();
    const conta = contas.get(id);
    if (!conta || t - conta.inicio > janela) {
      if (contas.size > 1000) contas.clear();
      contas.set(id, { inicio: t, n: 1 });
      return;
    }
    conta.n += 1;
    if (conta.n > quantos) throw new Recusa(429, 'Muitos pedidos seguidos. Espere um pouco.');
  };
}

/**
 * Versão mínima do site (versao.json, gravado por servidor/publicar.ps1 ao lado do site). Publicado com -Forcar, quem
 * está numa versão mais velha não entra na voz até recarregar; sem o arquivo, não há mínima.
 */
function lerVersaoMinima(arquivo) {
  try { return Number(JSON.parse(readFileSync(arquivo, 'utf8')).minima) || 0; } catch { return 0; }
}

function guardarCom(mapa, chave, valor, limite = 500) {
  if (mapa.size >= limite) mapa.delete(mapa.keys().next().value);
  mapa.set(chave, valor);
}

export function criarRotas({
  supabase, livekit, lives, mediamtx, config, gifs = null, narracao = null, buscarWeb = buscar, segredoMidia = config.livesSegredo,
  agora = () => Date.now(), registrar = console.error, versaoMinima = () => lerVersaoMinima(config.versaoSite),
}) {
  const previas = new Map();
  const limitePrevia = criarLimite(60, 60000, agora);
  const limiteGifs = criarLimite(40, 60000, agora);
  const limiteNarracao = criarLimite(30, 60000, agora);
  let presentes = { ate: 0, salas: null };

  async function quemPede(pedido) {
    const cabecalho = String(pedido.headers.authorization || '');
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (!token) throw new Recusa(401, 'Entre na sua conta de novo.');
    const id = await supabase.usuario(token);
    if (!id) throw new Recusa(401, 'Entre na sua conta de novo.');
    const membro = await supabase.membro(token, id);
    if (!membro || !membro.ativo) throw new Recusa(403, 'Você não faz mais parte do grupo.');
    return { token, id, membro, site: String(pedido.headers['x-exilados-site'] || '') };
  }

  async function membroDoAnuncio(token, id, corpo) {
    limiteNarracao(id);
    if (!UUID.test(corpo.usuario) || !['entrou', 'saiu', 'live'].includes(corpo.evento)) throw new Recusa(400, 'Anúncio inválido.');
    const membro = await supabase.membro(token, corpo.usuario);
    if (!membro?.ativo) throw new Recusa(404, 'Membro não encontrado.');
    return membro;
  }

  const rotas = {
    // Narração de quem entra/sai: o áudio guardado, ou o que o aparelho deve gerar no demo de voz (narracao.mjs).
    async 'POST /voz/anuncio'({ token, id }, corpo) {
      const membro = await membroDoAnuncio(token, id, corpo);
      const audio = narracao ? await narracao.guardado(membro.nome, corpo.evento) : null;
      return audio || !narracao ? { audio } : { audio: null, gerar: narracao.pedido(membro.nome, corpo.evento) };
    },

    // O aparelho gerou no demo: o servidor baixa de lá (só de lá), confere e guarda para o grupo.
    async 'POST /voz/anuncio/guardar'({ token, id }, corpo) {
      const membro = await membroDoAnuncio(token, id, corpo);
      const audio = narracao ? await narracao.guardar(membro.nome, corpo.evento, corpo.url) : null;
      if (!audio) throw new Recusa(422, 'Áudio de narração inválido.');
      return { audio };
    },

    // Sala de voz do grupo ({ sala }) ou chamada numa conversa direta ({ conversa }, só os dois amigos).
    async 'POST /voz/entrar'({ token, id, membro, site }, corpo) {
      // O site de desenvolvimento ("dev") passa; os publicados mandam o número da versão (os antigos, nada).
      const minima = site === 'dev' ? 0 : versaoMinima();
      if (minima && !(Number(site) >= minima)) {
        throw new Recusa(426, 'Há uma versão nova do Exilados. Recarregue a página (F5) ou feche e abra o programa/app para entrar na voz.');
      }
      let nomeSala;
      if (corpo.conversa !== undefined) {
        const conversaId = String(corpo.conversa || '');
        if (!UUID.test(conversaId)) throw new Recusa(400, 'Conversa inválida.');
        const conversa = await supabase.conversa(token, conversaId);
        if (!conversa || ![conversa.a, conversa.b].includes(id)) throw new Recusa(404, 'Chamada só entre amigos.');
        nomeSala = `conversa-${conversaId}`;
      } else {
        const salaId = String(corpo.sala || '');
        if (!UUID.test(salaId)) throw new Recusa(400, 'Sala inválida.');
        const sala = await supabase.sala(token, salaId);
        if (!sala || sala.tipo !== 'voz') throw new Recusa(404, 'A sala não existe mais.');
        nomeSala = `sala-${salaId}`;
      }
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

    // Quem está mesmo em cada sala de voz do grupo, pelo LiveKit (o site corrige a presença com isso: quem caiu
    // sem avisar some da sala). Chamadas de conversa direta ficam de fora.
    async 'POST /voz/presentes'() {
      if (agora() > presentes.ate || !presentes.salas) {
        const salas = {};
        for (const nome of await livekit.listarSalas()) {
          if (!nome.startsWith('sala-')) continue;
          const ids = await livekit.participantes(nome);
          if (ids.length) salas[nome.slice(5)] = ids;
        }
        presentes = { ate: agora() + PRESENTES_MS, salas };
      }
      return { salas: presentes.salas };
    },

    async 'POST /previa'({ id }, corpo) {
      const endereco = String(corpo.url || '').slice(0, 2000);
      if (!enderecoAceito(endereco)) throw new Recusa(400, 'Endereço inválido.');
      const guardada = previas.get(endereco);
      if (guardada && guardada.ate > agora()) return { previa: guardada.previa };
      limitePrevia(id);
      let previa = null;
      try {
        previa = await montarPrevia(endereco, { segredo: segredoMidia, buscarWeb });
      } catch {
        previa = null; // site fora do ar, lento ou bloqueado: sem prévia
      }
      guardarCom(previas, endereco, { previa, ate: agora() + (previa ? PREVIA_MS : PREVIA_MS / 6) });
      return { previa };
    },

    async 'POST /gifs'({ id }, corpo) {
      if (!gifs?.ligado) throw new Recusa(404, 'GIFs desligados neste servidor.');
      limiteGifs(id);
      try {
        return { gifs: await gifs.listar(corpo.busca, Number(corpo.pagina) || 0) };
      } catch (erro) {
        registrar(`GIFs: ${erro.message}`);
        throw new Recusa(502, 'A busca de GIFs não respondeu agora. Tente de novo.');
      }
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

  /** Serve uma imagem de fora (prévia de link ou GIF), conferida e com cache no navegador. */
  async function servirImagem(resposta, endereco) {
    let r;
    try {
      r = await buscarWeb(endereco, { maxBytes: 12 * 1024 * 1024, prazo: 10000, cabecalhos: { accept: 'image/avif,image/webp,image/*;q=0.8' } });
    } catch {
      throw new Recusa(404, 'Imagem indisponível.');
    }
    const tipo = String(r.cabecalhos['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (r.status !== 200 || r.cortado || !TIPO_IMAGEM.test(tipo)) throw new Recusa(404, 'Imagem indisponível.');
    resposta.writeHead(200, {
      'content-type': tipo,
      'content-length': r.corpo.length,
      'cache-control': 'public, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    resposta.end(r.corpo);
  }

  return async function (pedido, resposta) {
    try {
      const url = new URL(pedido.url, 'http://local');
      const caminho = url.pathname.replace(/^\/exilados\/api/, '') || '/';
      if (pedido.method === 'GET' && caminho === '/saude') {
        return responder(resposta, 200, { ok: true, agora: agora(), gifs: Boolean(gifs?.ligado) });
      }
      if (pedido.method === 'GET' && caminho === '/midia') {
        const endereco = url.searchParams.get('u') || '';
        if (!conferirMidia(endereco, url.searchParams.get('a'), segredoMidia)) throw new Recusa(404, 'Não encontrado.');
        return await servirImagem(resposta, endereco);
      }
      if (pedido.method === 'GET' && caminho === '/gif') {
        const endereco = gifAceito(url.searchParams.get('u') || '');
        if (!endereco) throw new Recusa(404, 'Não encontrado.');
        return await servirImagem(resposta, endereco.href);
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
