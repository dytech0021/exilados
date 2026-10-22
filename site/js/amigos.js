// Amigos e mensagens diretas: coluna das conversas, página de amigos (Online, Todos, Pendentes, Adicionar) e
// pedidos de amizade.
import {
  amigos, amizadeCom, avisar, conversaCom, estado, meuId, membrosAtivos, ouvir,
} from './estado.js';
import { formatarId, lerId, ordenarPorNome } from './formato.js';
import { statusDe } from './grupo.js';
import { conferir, sb } from './supa.js';
import {
  avatar, aviso, botaoIcone, confirmar, el, erro, icone, limpar,
} from './ui.js';

let nav = null;
let partes = null;
let aba = 'online';

export const pedidosRecebidos = () => estado.amizades.filter((a) => a.estado === 'pendente' && a.para === meuId());
const pedidosEnviados = () => estado.amizades.filter((a) => a.estado === 'pendente' && a.de === meuId());

export async function pedirAmizade(id) {
  try {
    const linha = conferir(await sb.from('exilados_amizades').insert({ de: meuId(), para: id }).select('id,de,para,estado,criada_em').single());
    if (!estado.amizades.some((a) => a.id === linha.id)) estado.amizades.push(linha);
    avisar('amizades');
    aviso(`Pedido de amizade enviado para ${estado.membros.get(id)?.nome || 'a pessoa'}.`);
  } catch (falha) {
    if (/duplicate|unique/i.test(falha.message)) aviso('Vocês já têm um pedido de amizade entre si.');
    else erro(falha);
  }
}

export async function aceitarAmizade(amizade) {
  try {
    const linha = conferir(await sb.from('exilados_amizades').update({ estado: 'aceita' }).eq('id', amizade.id).select('id,de,para,estado,criada_em').single());
    estado.amizades = estado.amizades.map((a) => (a.id === linha.id ? linha : a));
    avisar('amizades');
  } catch (falha) {
    erro(falha);
  }
}

async function desfazer(amizade, pergunta) {
  if (pergunta) {
    const outro = amizade.de === meuId() ? amizade.para : amizade.de;
    const ok = await confirmar({
      titulo: `Desfazer amizade com ${estado.membros.get(outro)?.nome || 'a pessoa'}`,
      texto: 'A conversa direta de vocês fica fechada para os dois até que voltem a ser amigos.',
      botao: 'Desfazer amizade',
      perigo: true,
    });
    if (!ok) return;
  }
  try {
    conferir(await sb.from('exilados_amizades').delete().eq('id', amizade.id));
    estado.amizades = estado.amizades.filter((a) => a.id !== amizade.id);
    avisar('amizades');
  } catch (falha) {
    erro(falha);
  }
}

/** Abre (ou cria) a conversa direta com um amigo. */
export async function abrirDM(id) {
  try {
    let conversa = conversaCom(id);
    if (!conversa) {
      const novoId = conferir(await sb.rpc('exilados_abrir_conversa', { outro: id }));
      const [a, b] = [meuId(), id].sort();
      conversa = { id: novoId, a, b };
      estado.conversas.set(novoId, conversa);
      avisar('conversas');
    }
    nav.irPara({ tipo: 'conversa', id: conversa.id, outro: id });
  } catch (falha) {
    erro(falha);
  }
}

// ---------- coluna da esquerda no modo "mensagens diretas" ----------

export function desenharTopoDM(topo) {
  limpar(topo, el('div', { class: 'lateral-topo' }, el('span', { class: 'titulo', text: 'Mensagens diretas' })));
}

export function desenharListaDM(lista) {
  const recebidos = pedidosRecebidos().length;
  const naPaginaAmigos = estado.vista.tipo === 'amigos';
  const itens = ordenarPorNome(amigos().map((id) => estado.membros.get(id)).filter((m) => m?.ativo));
  limpar(lista,
    el('button', { class: `sala${naPaginaAmigos ? ' ativa' : ''}`, onclick: () => nav.irPara({ tipo: 'amigos' }) },
      icone('amigo'), el('span', { class: 'nome', text: 'Amigos' }),
      recebidos ? el('span', { class: 'selo', text: String(recebidos) }) : null),
    el('div', { class: 'categoria' }, el('span', { text: 'Mensagens diretas' })),
    itens.length ? itens.map((m) => {
      const conversa = conversaCom(m.user_id);
      const ativa = estado.vista.tipo === 'conversa' && conversa && estado.vista.id === conversa.id;
      const naoLida = conversa && estado.naoLidas.has(conversa.id);
      const mencoes = conversa ? estado.mencoes.get(conversa.id) || 0 : 0;
      const emChamada = conversa && [...estado.presenca.values()].some((p) => p.voz === `c:${conversa.id}`);
      return el('button', {
        class: `sala${ativa ? ' ativa' : ''}${naoLida ? ' nao-lida' : ''}`,
        onclick: () => abrirDM(m.user_id),
      }, avatar(m, { tamanho: 32, status: statusDe(m.user_id) }), el('span', { class: 'nome', text: m.nome }),
      emChamada ? icone('telefone', 'em-chamada') : null,
      mencoes ? el('span', { class: 'selo', text: String(mencoes) }) : null);
    }) : el('p', { class: 'ajuda', text: 'Seus amigos aparecem aqui. Adicione alguém do grupo na página Amigos.' }));
}

// ---------- página de amigos ----------

function linhaPessoa(m, subtitulo, acoes) {
  return el('div', { class: 'amigo' },
    avatar(m, { tamanho: 32, status: statusDe(m.user_id) }),
    el('div', { class: 'textos' }, el('strong', { text: m.nome }), el('small', { text: subtitulo })),
    el('div', { class: 'acoes' }, acoes));
}

const textoStatus = (id) => ({ online: 'Online', ausente: 'Ausente', offline: 'Offline' }[statusDe(id)]);

function corpoAmigos(corpo) {
  const meus = amigos().map((id) => estado.membros.get(id)).filter((m) => m?.ativo);
  const acoesAmigo = (m) => {
    const amizade = amizadeCom(m.user_id);
    return [
      botaoIcone('balao', 'Mensagem', () => abrirDM(m.user_id)),
      botaoIcone('removerPessoa', 'Desfazer amizade', () => desfazer(amizade, true), 'recusar'),
    ];
  };
  if (aba === 'online' || aba === 'todos') {
    const lista = ordenarPorNome(aba === 'online' ? meus.filter((m) => statusDe(m.user_id) !== 'offline') : meus);
    if (!lista.length) {
      return limpar(corpo, el('div', { class: 'vazio-amigos' }, el('div', { class: 'logo-ex', attrs: { role: 'img', 'aria-label': 'Exilados' } }),
        el('p', { text: aba === 'online' ? 'Nenhum amigo online agora.' : 'Você ainda não tem amigos aqui. Adicione alguém do grupo.' }),
        el('button', { class: 'botao', text: 'Adicionar amigo', onclick: () => { aba = 'adicionar'; desenharAmigos(partes.centro, partes.topo); } })));
    }
    return limpar(corpo, el('h3', { text: `${aba === 'online' ? 'Online' : 'Todos os amigos'} — ${lista.length}` }),
      lista.map((m) => linhaPessoa(m, textoStatus(m.user_id), acoesAmigo(m))));
  }
  if (aba === 'pendentes') {
    const recebidos = pedidosRecebidos();
    const enviados = pedidosEnviados();
    if (!recebidos.length && !enviados.length) {
      return limpar(corpo, el('div', { class: 'vazio-amigos' }, el('div', { class: 'logo-ex', attrs: { role: 'img', 'aria-label': 'Exilados' } }), el('p', { text: 'Nenhum pedido de amizade pendente.' })));
    }
    const pessoa = (id) => estado.membros.get(id) || { user_id: id, nome: 'Alguém' };
    return limpar(corpo,
      recebidos.length ? [el('h3', { text: `Recebidos — ${recebidos.length}` }), recebidos.map((a) => linhaPessoa(pessoa(a.de), 'Quer ser seu amigo', [
        botaoIcone('certo', 'Aceitar', () => aceitarAmizade(a), 'aceitar'),
        botaoIcone('fechar', 'Recusar', () => desfazer(a, false), 'recusar'),
      ]))] : null,
      enviados.length ? [el('h3', { text: `Enviados — ${enviados.length}` }), enviados.map((a) => linhaPessoa(pessoa(a.para), 'Pedido enviado', [
        botaoIcone('fechar', 'Cancelar pedido', () => desfazer(a, false), 'recusar'),
      ]))] : null);
  }
  // Adicionar: qualquer membro do grupo que ainda não é amigo nem tem pedido, pelo nome ou pelo ID.
  const busca = el('input', { class: 'entrada busca', placeholder: 'Nome ou ID (9 dígitos)', attrs: { 'aria-label': 'Procurar pelo nome ou pelo ID' } });
  const resultado = el('div');
  let consulta = 0;
  const desenharCandidatos = (candidatos, vazio) => limpar(resultado, candidatos.length
    ? candidatos.map((m) => linhaPessoa(m, textoStatus(m.user_id), [
      el('button', { class: 'botao pequeno', text: 'Enviar pedido', onclick: () => pedirAmizade(m.user_id) }),
    ]))
    : el('p', { class: 'ajuda', text: vazio }));
  const disponiveis = () => membrosAtivos().filter((m) => m.user_id !== meuId() && !amizadeCom(m.user_id));
  const listar = async () => {
    const numero = lerId(busca.value);
    const esta = ++consulta;
    if (numero) {
      const { data } = await sb.from('exilados_ids').select('user_id').eq('codigo', numero).maybeSingle();
      if (esta !== consulta) return;
      const pessoa = data && disponiveis().find((m) => m.user_id === data.user_id);
      return desenharCandidatos(pessoa ? [pessoa] : [], data?.user_id === meuId() ? 'Esse é o seu próprio ID.'
        : data && amizadeCom(data.user_id) ? 'Vocês já são amigos (ou já têm um pedido).'
          : 'Nenhum membro do grupo com esse ID. Para trazer alguém novo, use Convidar pessoas.');
    }
    const termo = busca.value.trim().toLocaleLowerCase('pt-BR');
    desenharCandidatos(ordenarPorNome(disponiveis().filter((m) => !termo || m.nome.toLocaleLowerCase('pt-BR').includes(termo))),
      termo ? 'Ninguém do grupo com esse nome (ou já são amigos).' : 'Todo mundo do grupo já é seu amigo ou tem pedido pendente.');
  };
  busca.addEventListener('input', listar);
  listar();
  const seuId = el('strong', { text: '' });
  sb.rpc('exilados_meu_id').then(({ data }) => { if (data) seuId.textContent = formatarId(data); });
  limpar(corpo, el('h3', { text: 'Adicionar amigo' }),
    el('p', { class: 'ajuda' }, 'Procure alguém do grupo pelo nome ou pelo ID e mande um pedido. Quando a pessoa aceitar, vocês conversam em particular. Seu ID: ', seuId),
    busca, resultado);
  busca.focus();
  return corpo;
}

export function desenharAmigos(centroCorpo, topo) {
  const recebidos = pedidosRecebidos().length;
  const botaoAba = (id, texto, classe = '') => el('button', {
    class: `aba ${classe}${aba === id ? ' ativa' : ''}`.trim(),
    onclick: () => { aba = id; desenharAmigos(centroCorpo, topo); },
  }, texto, id === 'pendentes' && recebidos ? el('span', { class: 'selo', text: String(recebidos) }) : null);
  limpar(topo,
    nav.botaoMenu(),
    el('div', { class: 'titulo amigos-topo' }, icone('amigo'), el('span', { text: 'Amigos' }), el('span', { class: 'divisor' }),
      el('div', { class: 'abas' }, botaoAba('online', 'Online'), botaoAba('todos', 'Todos'), botaoAba('pendentes', 'Pendentes'),
        botaoAba('adicionar', 'Adicionar amigo', 'adicionar'))));
  const corpo = el('div', { class: 'amigos-corpo' });
  limpar(centroCorpo, corpo);
  corpoAmigos(corpo);
}

export function iniciarAmigos(navegacao, partesDaTela) {
  nav = navegacao;
  partes = partesDaTela;
  const redesenharLista = () => { if (estado.modo === 'dm') desenharListaDM(partes.lista); };
  for (const evento of ['amizades', 'presenca', 'membros', 'conversas', 'naoLidas', 'vista']) ouvir(evento, redesenharLista);
  ouvir('amizades', () => {
    if (estado.vista.tipo === 'amigos') desenharAmigos(partes.centro, partes.topo);
  });
  ouvir('presenca', () => {
    if (estado.vista.tipo === 'amigos' && (aba === 'online' || aba === 'todos')) desenharAmigos(partes.centro, partes.topo);
  });
  ouvir('pedidoAmizade', (a) => {
    aviso(`${estado.membros.get(a.de)?.nome || 'Alguém'} quer ser seu amigo.`, {
      acao: { rotulo: 'Ver', fn: () => { aba = 'pendentes'; nav.irPara({ tipo: 'amigos' }); } },
    });
  });
  ouvir('amizadeAceita', (a) => {
    aviso(`${estado.membros.get(a.para)?.nome || 'A pessoa'} aceitou seu pedido de amizade.`, {
      acao: { rotulo: 'Mensagem', fn: () => abrirDM(a.para) },
    });
  });
}
