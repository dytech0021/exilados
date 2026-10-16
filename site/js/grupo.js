// Coluna das salas (modo grupo), lista de membros, painel do usuário, painel de voz e cartão de perfil.
import { nomeDaSala } from './dados.js';
import {
  agoraServidor, amizadeCom, estado, eu, meuId, membrosAtivos, ouvir, souDono,
} from './estado.js';
import { dataPorExtenso, formatarId, ordenarPorNome } from './formato.js';
import { liveNoAr } from './presenca.js';
import { api, sb } from './supa.js';
import {
  aoSegurar, avatar, botaoIcone, confirmar, el, erro, icone, limpar, menu, posicionar,
} from './ui.js';
import * as voz from './voz.js';

let nav = null; // funções de navegação do app.js: { irPara, abrirConfig, convidar, pedirAmizade, ... }

export const statusDe = (id) => estado.presenca.get(id)?.status || 'offline';
export const falando = (id) => estado.falando.has(id) || estado.falandoNaSala?.has(id);
export const liveDe = (id) => {
  const live = estado.lives.get(id);
  return liveNoAr(live, agoraServidor()) ? live : null;
};

// ---------- coluna das salas ----------

function itemNaVoz(id) {
  const membro = estado.membros.get(id) || { user_id: id, nome: 'Alguém' };
  const p = estado.presenca.get(id) || {};
  const live = liveDe(id);
  const li = el('li', { attrs: { tabindex: 0, title: membro.nome } },
    avatar(membro, { tamanho: 24, falando: falando(id) && !p.mudo }),
    el('span', { class: 'nome', text: membro.nome }),
    p.surdo ? icone('foneMudo', 'mudo') : p.mudo ? icone('micMudo', 'mudo') : null,
    live ? el('button', {
      class: 'ao-vivo', text: 'Ao vivo', attrs: { title: `Assistir ${membro.nome}` },
      onclick: (e) => { e.stopPropagation(); nav.irPara({ tipo: 'live', id }); },
    }) : null);
  li.addEventListener('click', (e) => (live ? nav.irPara({ tipo: 'live', id }) : cartaoPerfil(id, e.clientX + 8, e.clientY - 40)));
  aoSegurar(li, (e) => menuMembro(id, e.clientX, e.clientY));
  return li;
}

function itemSala(sala) {
  const ativa = estado.vista.tipo === 'grupo' && estado.vista.id === sala.id;
  const naSalaDeVoz = sala.tipo === 'voz' && voz.voz.sala === sala.id;
  const botao = el('button', {
    class: `sala${ativa || naSalaDeVoz ? ' ativa' : ''}${estado.naoLidas.has(sala.id) ? ' nao-lida' : ''}`,
    attrs: { 'aria-current': ativa ? 'page' : null },
    onclick: async () => {
      if (sala.tipo === 'texto') return nav.irPara({ tipo: 'grupo', id: sala.id });
      try {
        await voz.entrar(sala.id);
      } catch (falha) {
        erro(falha);
      }
    },
  }, icone(sala.tipo === 'texto' ? 'hash' : 'voz'), el('span', { class: 'nome', text: sala.nome }));
  const partes = [botao];
  if (sala.tipo === 'voz') {
    const ids = [...estado.presenca.entries()].filter(([, p]) => p.voz === sala.id).map(([id]) => id)
      .filter((id) => estado.membros.get(id)?.ativo);
    if (ids.length) {
      const ordenados = ordenarPorNome(ids.map((id) => estado.membros.get(id)), (m) => m.nome).map((m) => m.user_id);
      partes.push(el('ul', { class: 'na-voz' }, ordenados.map((id) => itemNaVoz(id))));
    }
  }
  return partes;
}

export function desenharSalas(lista) {
  const textos = estado.salas.filter((s) => s.tipo === 'texto');
  const vozes = estado.salas.filter((s) => s.tipo === 'voz');
  const emSalaDeVoz = new Set([...estado.presenca.values()].map((p) => p.voz).filter(Boolean));
  // Lives de quem não está em nenhuma sala de voz aparecem numa seção própria.
  const livesSoltas = [...estado.lives.keys()].filter((id) => liveDe(id) && !emSalaDeVoz.has(estado.presenca.get(id)?.voz));
  const categoria = (texto, tipo) => el('div', { class: 'categoria' }, icone('abaixo'), el('span', { text: texto }),
    souDono() ? botaoIcone('mais', `Criar sala de ${tipo}`, () => nav.abrirConfig('salas'), 'acao') : null);
  limpar(lista,
    livesSoltas.length ? [
      el('div', { class: 'categoria' }, el('span', { text: 'Ao vivo' })),
      el('ul', { class: 'na-voz' }, livesSoltas.map((id) => itemNaVoz(id))),
    ] : null,
    categoria('Salas de texto', 'texto'),
    textos.map(itemSala),
    categoria('Salas de voz', 'voz'),
    vozes.map(itemSala));
}

export function desenharTopoGrupo(topo) {
  const titulo = el('button', {
    class: 'lateral-topo-titulo',
    onclick: () => {
      const r = topo.getBoundingClientRect();
      menu([
        { rotulo: 'Convidar pessoas', icone: 'addAmigo', fn: () => nav.convidar() },
        { rotulo: 'Transmitir (programa do Windows)', icone: 'tela', fn: () => nav.abrirConfig('transmitir') },
        souDono() ? { rotulo: 'Salas do grupo', icone: 'engrenagem', fn: () => nav.abrirConfig('salas') } : null,
        souDono() ? { rotulo: 'Membros do grupo', icone: 'pessoas', fn: () => nav.abrirConfig('membros') } : null,
      ], r.left + 10, r.bottom + 6);
    },
  }, el('span', { class: 'titulo', text: 'Exilados' }), icone('abaixo'));
  limpar(topo, el('div', { class: 'lateral-topo' }, titulo,
    botaoIcone('addAmigo', 'Convidar pessoas (link ou ID)', () => nav.convidar(), 'convidar')));
}

// ---------- lista de membros ----------

function atividade(id) {
  const live = liveDe(id);
  const salaVoz = estado.presenca.get(id)?.voz;
  if (live) return { texto: salaVoz ? `Ao vivo na ${nomeDaSala(salaVoz)}` : 'Ao vivo', vivo: true };
  if (salaVoz) return { texto: `Na sala ${nomeDaSala(salaVoz)}`, vivo: false };
  return null;
}

function itemMembro(m) {
  const status = statusDe(m.user_id);
  const a = atividade(m.user_id);
  const botao = el('button', {
    class: `membro${status === 'offline' ? ' offline' : ''}`,
    onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      cartaoPerfil(m.user_id, r.left - 310, r.top);
    },
  },
  avatar(m, { tamanho: 32, status, falando: falando(m.user_id) }),
  el('div', { class: 'textos' },
    el('div', { class: 'nome' }, el('span', { text: m.nome }), m.papel === 'dono' ? icone('coroa', 'coroa') : null),
    a ? el('span', { class: `atividade${a.vivo ? ' vivo' : ''}`, text: a.texto }) : null));
  aoSegurar(botao, (e) => menuMembro(m.user_id, e.clientX, e.clientY));
  return botao;
}

export function desenharMembros(coluna) {
  const ativos = membrosAtivos();
  const online = ordenarPorNome(ativos.filter((m) => statusDe(m.user_id) !== 'offline'));
  const offline = ordenarPorNome(ativos.filter((m) => statusDe(m.user_id) === 'offline'));
  limpar(coluna,
    el('button', { class: 'botao pequeno convidar-membros', onclick: () => nav.convidar() }, icone('addAmigo'), 'Convidar pessoas'),
    el('div', { class: 'categoria', text: `Online — ${online.length}` }), online.map(itemMembro),
    offline.length ? [el('div', { class: 'categoria', text: `Offline — ${offline.length}` }), offline.map(itemMembro)] : null);
}

// ---------- painel do usuário e de voz ----------

export function desenharPainelUsuario(painel) {
  const meu = eu();
  if (!meu) return;
  const status = statusDe(meu.user_id) === 'offline' ? 'online' : statusDe(meu.user_id);
  const v = voz.voz;
  const calado = v.mudo || v.surdo;
  limpar(painel,
    el('button', { class: 'quem', title: 'Minha conta', onclick: () => nav.abrirConfig('conta') },
      avatar(meu, { tamanho: 32, status, falando: falando(meu.user_id) && !calado }),
      el('div', { class: 'textos' }, el('strong', { text: meu.nome }), el('small', { text: status === 'ausente' ? 'Ausente' : 'Online' }))),
    botaoIcone(calado ? 'micMudo' : 'mic', calado ? 'Ativar microfone' : 'Silenciar microfone', () => voz.alternarMudo().catch(erro), calado ? 'ligado' : ''),
    botaoIcone(v.surdo ? 'foneMudo' : 'fone', v.surdo ? 'Ativar som' : 'Desligar som', () => voz.alternarSurdo().catch(erro), v.surdo ? 'ligado' : ''),
    botaoIcone('engrenagem', 'Configurações', () => nav.abrirConfig()));
}

export function desenharPainelVoz(painel) {
  const v = voz.voz;
  painel.hidden = v.situacao === 'desligada';
  if (painel.hidden) return;
  const textos = { conectando: 'Conectando...', reconectando: 'Reconectando...', conectada: 'Voz conectada' };
  limpar(painel,
    el('div', { class: 'linha' },
      el('div', { class: 'estado' },
        el('strong', { class: v.situacao === 'conectada' ? '' : 'aguardando' }, icone('ondas'), textos[v.situacao] || ''),
        el('span', { text: `${nomeDaSala(v.sala)} / Exilados` })),
      botaoIcone('desligar', 'Sair da sala de voz', () => voz.sair().catch(erro))),
    v.semMicrofone ? el('div', { class: 'aviso-mic', text: 'Sem microfone: só ouvindo.' }) : null);
}

// ---------- cartão de perfil e menu de um membro ----------

function botaoAmizade(id) {
  const amizade = amizadeCom(id);
  if (!amizade) return el('button', { class: 'botao', text: 'Adicionar amigo', onclick: () => nav.pedirAmizade(id) });
  if (amizade.estado === 'aceita') return el('button', { class: 'botao', text: 'Enviar mensagem', onclick: () => nav.abrirDM(id) });
  if (amizade.para === meuId()) return el('button', { class: 'botao verde', text: 'Aceitar pedido de amizade', onclick: () => nav.aceitarAmizade(amizade) });
  return el('button', { class: 'botao cinza', text: 'Pedido de amizade enviado', disabled: true });
}

export function cartaoPerfil(id, x, y) {
  const m = estado.membros.get(id);
  if (!m) return;
  const live = liveDe(id);
  const souEu = id === meuId();
  const faixa = el('div', { class: 'faixa-cor' });
  faixa.style.backgroundColor = '#c0662b';
  // O ID de cada membro (para achar amigos pelo número); carregado à parte.
  const linhaId = el('div', { class: 'papel' });
  sb.from('exilados_ids').select('codigo').eq('user_id', id).maybeSingle()
    .then(({ data }) => { if (data?.codigo) linhaId.textContent = `ID ${formatarId(data.codigo)}`; });
  const cartao = el('div', { class: 'cartao-perfil' },
    faixa,
    el('div', { class: 'corpo' },
      avatar(m, { tamanho: 80, status: statusDe(id) }),
      el('h3', {}, el('span', { text: m.nome }), m.papel === 'dono' ? icone('coroa', 'coroa') : null),
      el('div', { class: 'papel', text: `${m.papel === 'dono' ? 'Dono do grupo' : 'Membro'} desde ${dataPorExtenso(m.entrou_em)}` }),
      linhaId,
      el('div', { class: 'acoes' },
        live ? el('button', { class: 'botao vermelho', text: 'Assistir à live', onclick: () => nav.irPara({ tipo: 'live', id }) }) : null,
        souEu ? el('button', { class: 'botao cinza', text: 'Editar perfil', onclick: () => nav.abrirConfig('conta') }) : botaoAmizade(id),
        souDono() && !souEu ? el('button', { class: 'botao vazio', text: 'Remover do grupo', onclick: () => removerMembro(id) }) : null)));
  cartao.addEventListener('click', (e) => { if (e.target.closest('button')) cartao.remove(); });
  posicionar(cartao, x, y);
}

export function menuMembro(id, x, y) {
  const m = estado.membros.get(id);
  if (!m) return;
  const souEu = id === meuId();
  const naMinhaSala = voz.voz.sala && estado.presenca.get(id)?.voz === voz.voz.sala;
  const amizade = amizadeCom(id);
  menu([
    { rotulo: 'Perfil', fn: () => cartaoPerfil(id, x, y) },
    liveDe(id) ? { rotulo: 'Assistir à live', fn: () => nav.irPara({ tipo: 'live', id }) } : null,
    !souEu && amizade?.estado === 'aceita' ? { rotulo: 'Mensagem', fn: () => nav.abrirDM(id) } : null,
    !souEu && !amizade ? { rotulo: 'Adicionar amigo', fn: () => nav.pedirAmizade(id) } : null,
    !souEu && naMinhaSala ? 'separador' : null,
    !souEu && naMinhaSala ? {
      rotulo: 'Volume do usuário',
      faixa: { min: 0, max: 200, valor: voz.volumeDe(id), aoMudar: (v) => voz.definirVolume(id, v) },
    } : null,
    !souEu && voz.volumeDe(id) !== 100 ? { rotulo: 'Voltar o volume a 100%', fn: () => voz.definirVolume(id, 100) } : null,
    souDono() && !souEu ? 'separador' : null,
    souDono() && !souEu ? { rotulo: `Remover ${m.nome}`, perigo: true, fn: () => removerMembro(id) } : null,
  ], x, y);
}

export async function removerMembro(id) {
  const m = estado.membros.get(id);
  const ok = await confirmar({
    titulo: `Remover ${m?.nome || 'membro'}`,
    texto: 'A pessoa perde o acesso ao grupo na hora (salas, mensagens, voz e lives). Só você pode readmiti-la depois, em Membros do grupo.',
    botao: 'Remover',
    perigo: true,
  });
  if (!ok) return;
  try {
    await api.chamar('/membros/ativo', { usuario: id, ativo: false });
  } catch (falha) {
    erro(falha);
  }
}

export function iniciarGrupo(navegacao, partes) {
  nav = navegacao;
  const redesenhar = () => {
    if (estado.modo === 'grupo') desenharSalas(partes.lista);
    desenharMembros(partes.membros);
  };
  for (const evento of ['salas', 'membros', 'presenca', 'falando', 'lives', 'vista', 'naoLidas', 'amizades']) ouvir(evento, redesenhar);
  ouvir('voz', () => {
    redesenhar();
    desenharPainelVoz(partes.painelVoz);
    desenharPainelUsuario(partes.painelUsuario);
  });
  for (const evento of ['membros', 'presenca', 'falando']) ouvir(evento, () => desenharPainelUsuario(partes.painelUsuario));
  redesenhar();
  desenharPainelUsuario(partes.painelUsuario);
  desenharPainelVoz(partes.painelVoz);
}
