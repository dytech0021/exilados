// Conversa de uma sala de texto ou de uma mensagem direta, como no Discord: histórico (50 e mais 50 ao rolar para
// cima), tempo real, envio de texto, imagem (reduzida no navegador), arquivo (até 25 MB) e GIF; responder, editar e
// apagar, reações com emoji, menções (@nome e @todos), prévia de links, "fulano está digitando" e rascunhos.
import { PASTA_IMAGENS, POR_PAGINA } from './config.js';
import { avisarDigitando, quemDigita } from './dados.js';
import {
  estado, meuId, membrosAtivos, nomeDe, ouvir, outroDaConversa, souDono,
} from './estado.js';
import {
  acharMencoes, agruparMensagens, carimbo, dataPorExtenso, horaCurta, jeitoDoArquivo, LIMITE_ARQUIVO, LIMITE_MENSAGEM,
  linksDoTexto, mencaoDigitando, mensagemValida, nomeSeguro, partesComMencoes, partesDoTexto, tamanhoLegivel,
} from './formato.js';
import { conferirArquivo, reduzirImagem } from './imagens.js';
import { abriu } from './lidas.js';
import { enderecoGif, escolherEmoji, escolherGif } from './seletores.js';
import { api, conferir, sb } from './supa.js';
import {
  aoSegurar, avatar, botaoIcone, confirmar, el, enderecoArquivo, enderecoImagem, erro, fecharFlutuantes, icone, limpar,
  menu, preparar, verImagem,
} from './ui.js';

const CAMPOS = 'id,sala_id,conversa_id,autor,texto,imagem,criada_em,editada_em,responde_a,mencoes,menciona_todos,arquivo,gif,chamada';
const PASTA_ARQUIVOS = 'exilados-arquivos';
const rascunhos = new Map();
const previas = new Map();
let atual = null;
let aoClicarAutor = () => {};
let aoEntrarNaChamada = () => {};
let fazerBarraDaChamada = null;

export function quandoClicarNoAutor(fn) {
  aoClicarAutor = fn;
}

/** Como mostrar a chamada numa conversa direta (chamadas.js), sem depender dela aqui. */
export function usarChamadas({ barra, entrar }) {
  fazerBarraDaChamada = barra;
  aoEntrarNaChamada = entrar;
}

function colunaDe(tipo) {
  return tipo === 'sala' ? 'sala_id' : 'conversa_id';
}

// ---------- dados ----------

async function buscarReacoes(c, ids) {
  if (!ids.length) return;
  const { data, error } = await sb.from('exilados_reacoes').select('mensagem_id,user_id,emoji').in('mensagem_id', ids);
  if (error) return;
  for (const id of ids) c.reacoes.delete(id);
  for (const r of data) reagiu(c, r, false);
}

async function buscarOriginais(c, linhas) {
  const faltam = [...new Set(linhas.map((m) => m.responde_a).filter((id) => id && !c.originais.has(id)))];
  if (!faltam.length) return;
  const { data } = await sb.from('exilados_mensagens').select(CAMPOS).in('id', faltam);
  for (const id of faltam) c.originais.set(id, null);
  for (const m of data || []) c.originais.set(m.id, m);
}

async function buscar(c, antesDe) {
  let consulta = sb.from('exilados_mensagens').select(CAMPOS).eq(colunaDe(c.tipo), c.id)
    .order('id', { ascending: false }).limit(POR_PAGINA);
  if (antesDe) consulta = consulta.lt('id', antesDe);
  const linhas = conferir(await consulta);
  preparar(linhas.map((m) => m.imagem));
  for (const m of linhas) c.originais.set(m.id, m);
  await Promise.all([buscarReacoes(c, linhas.map((m) => m.id)), buscarOriginais(c, linhas)]).catch(() => {});
  return linhas.reverse();
}

function reagiu(c, r, tirada) {
  if (!c.reacoes.has(r.mensagem_id)) c.reacoes.set(r.mensagem_id, new Map());
  const porEmoji = c.reacoes.get(r.mensagem_id);
  if (!porEmoji.has(r.emoji)) porEmoji.set(r.emoji, new Set());
  if (tirada) porEmoji.get(r.emoji).delete(r.user_id);
  else porEmoji.get(r.emoji).add(r.user_id);
  if (!porEmoji.get(r.emoji).size) porEmoji.delete(r.emoji);
}

const minha = (m) => m.autor === meuId();
const podeApagar = (m) => minha(m) || (m.sala_id && souDono());

// ---------- partes da mensagem ----------

function nomesMencionados(m) {
  const nomes = {};
  for (const id of m.mencoes || []) nomes[id] = nomeDe(id);
  return nomes;
}

function textoDaMensagem(m) {
  const nomes = nomesMencionados(m);
  const partes = [];
  for (const parte of partesDoTexto(m.texto)) {
    if (parte.tipo === 'link') {
      partes.push(el('a', { href: parte.valor, target: '_blank', rel: 'noopener noreferrer', text: parte.valor }));
      continue;
    }
    for (const pedaco of partesComMencoes(parte.valor, nomes, m.menciona_todos)) {
      if (pedaco.tipo === 'texto') partes.push(pedaco.valor);
      else {
        partes.push(el('span', {
          class: 'mencao',
          text: pedaco.valor,
          onclick: (e) => { if (pedaco.id !== 'todos') aoClicarAutor(pedaco.id, e.clientX + 10, e.clientY); },
        }));
      }
    }
  }
  return el('div', { class: 'texto' }, partes, m.editada_em
    ? el('span', { class: 'editada', text: ' (editada)', attrs: { title: `Editada ${carimbo(m.editada_em)}` } }) : null);
}

function imagemDaMensagem(m) {
  const img = el('img', { class: 'imagem carregando', alt: 'Imagem enviada', attrs: { loading: 'lazy', referrerpolicy: 'no-referrer' } });
  const mostrar = (url) => {
    if (!url) {
      img.alt = 'Imagem indisponível';
      return;
    }
    img.onload = () => {
      img.classList.remove('carregando');
      if (atual?.colado) rolarAoFim();
    };
    img.src = url;
    img.onclick = () => verImagem(url);
  };
  if (m.urlLocal) mostrar(m.urlLocal);
  else enderecoImagem(m.imagem).then(mostrar);
  return img;
}

function gifDaMensagem(m) {
  const g = m.gif;
  const largura = Math.min(320, g.largura || 240);
  const altura = Math.round(largura * ((g.altura || 180) / (g.largura || 240)));
  const img = el('img', {
    class: 'gif', src: enderecoGif(g.url), alt: g.titulo || 'GIF',
    attrs: { loading: 'lazy', width: largura, height: altura, title: g.titulo || 'GIF' },
  });
  img.onload = () => { if (atual?.colado) rolarAoFim(); };
  return img;
}

function arquivoDaMensagem(m) {
  const a = m.arquivo;
  const jeito = jeitoDoArquivo(a.tipo);
  const caixa = el('div', { class: `arquivo ${jeito}` });
  const baixar = el('a', { class: 'baixar', attrs: { download: a.nome, title: `Baixar ${a.nome}` } }, icone('baixar'));
  const cartao = el('div', { class: 'cartao-arquivo' }, icone('arquivo'),
    el('div', { class: 'textos' }, el('a', { class: 'nome', text: a.nome, attrs: { download: a.nome } }), el('small', { text: tamanhoLegivel(a.tamanho) })),
    baixar);
  const local = m.urlLocal;
  (local ? Promise.resolve(local) : enderecoArquivo(a.caminho)).then((url) => {
    if (!url) {
      cartao.querySelector('small').textContent = 'Arquivo indisponível';
      return;
    }
    baixar.href = url;
    cartao.querySelector('.nome').href = url;
    if (jeito === 'video') {
      const video = el('video', { controls: true, preload: 'metadata', src: url, attrs: { playsinline: true } });
      video.addEventListener('loadedmetadata', () => { if (atual?.colado) rolarAoFim(); });
      caixa.prepend(video);
    } else if (jeito === 'audio') {
      caixa.prepend(el('audio', { controls: true, preload: 'metadata', src: url }));
    } else if (jeito === 'imagem') {
      const img = el('img', { class: 'imagem', src: url, alt: a.nome, attrs: { loading: 'lazy' } });
      img.onclick = () => verImagem(url);
      img.onload = () => { if (atual?.colado) rolarAoFim(); };
      caixa.prepend(img);
    }
  });
  caixa.append(cartao);
  return caixa;
}

const previasProntas = new Map();

function pedirPrevia(url) {
  if (!previas.has(url)) {
    previas.set(url, api.chamar('/previa', { url }).then((r) => r.previa).catch(() => null).then((p) => {
      previasProntas.set(url, p);
      return p;
    }));
  }
  return previas.get(url);
}

const observador = typeof IntersectionObserver === 'function' ? new IntersectionObserver((itens) => {
  for (const item of itens) {
    if (!item.isIntersecting) continue;
    observador.unobserve(item.target);
    item.target.carregar?.();
  }
}, { rootMargin: '400px' }) : null;

function previaDaMensagem(url) {
  const caixa = el('div', { class: 'previas' });
  const montar = (p) => {
    if (!p || (!p.titulo && !p.descricao && !p.imagem)) return;
    const imagem = p.imagem ? el('img', { src: p.imagem, alt: '', attrs: { loading: 'lazy', referrerpolicy: 'no-referrer' } }) : null;
    if (imagem) imagem.onload = () => { if (atual?.colado) rolarAoFim(); };
    const cartao = el('div', { class: `previa${p.grande ? ' grande' : ''}${p.tipo === 'imagem' ? ' so-imagem' : ''}` },
      el('div', { class: 'textos' },
        p.site ? el('small', { class: 'site', text: p.site }) : null,
        p.titulo ? el('a', { class: 'titulo', href: p.url, target: '_blank', rel: 'noopener noreferrer', text: p.titulo }) : null,
        p.descricao ? el('p', { text: p.descricao }) : null),
      imagem ? el('a', { class: 'figura', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, imagem) : null);
    if (p.cor) cartao.style.borderLeftColor = p.cor;
    if (p.tipo === 'youtube') cartao.classList.add('video');
    limpar(caixa, cartao);
    if (atual?.colado) rolarAoFim();
  };
  // Já buscada antes (a lista foi redesenhada): aparece na hora, sem a lista pular.
  if (previasProntas.has(url)) {
    montar(previasProntas.get(url));
    return caixa;
  }
  caixa.carregar = async () => montar(await pedirPrevia(url));
  if (observador) observador.observe(caixa);
  else caixa.carregar();
  return caixa;
}

function reacoesDaMensagem(c, m) {
  const porEmoji = c.reacoes.get(m.id);
  if (!porEmoji?.size) return null;
  return el('div', { class: 'reacoes' }, [...porEmoji].map(([emoji, quem]) => {
    const eu = quem.has(meuId());
    const nomes = [...quem].map((id) => nomeDe(id)).join(', ');
    return el('button', {
      class: `reacao${eu ? ' minha' : ''}`,
      attrs: { title: `${nomes} reagiu com ${emoji}`, 'aria-pressed': String(eu) },
      onclick: () => alternarReacao(m, emoji),
    }, el('span', { class: 'emoji', text: emoji }), el('span', { class: 'n', text: String(quem.size) }));
  }), botaoIcone('emoji', 'Reagir', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    escolherEmoji(r.left, r.bottom + 4, (emoji) => alternarReacao(m, emoji));
  }, 'mais-reacao'));
}

function respostaDaMensagem(c, m) {
  const original = c.originais.get(m.responde_a);
  if (!original) {
    return el('div', { class: 'resposta apagada' }, icone('responder'), el('span', { text: 'Mensagem original apagada' }));
  }
  const autor = estado.membros.get(original.autor) || { user_id: original.autor, nome: 'Alguém' };
  const resumo = original.texto || (original.imagem ? 'Imagem' : original.gif ? 'GIF' : original.arquivo ? original.arquivo.nome : '');
  return el('button', {
    class: 'resposta',
    attrs: { title: 'Ir até a mensagem' },
    onclick: () => irAteMensagem(original.id),
  }, avatar(autor, { tamanho: 16 }), el('span', { class: 'autor', text: `@${autor.nome}` }), el('span', { class: 'resumo', text: resumo }));
}

function irAteMensagem(id) {
  const alvo = atual?.lista.querySelector(`[data-id="${id}"]`);
  if (!alvo) return;
  alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
  alvo.classList.add('destaque');
  setTimeout(() => alvo.classList.remove('destaque'), 1600);
}

// ---------- ações ----------

async function alternarReacao(m, emoji) {
  const c = atual;
  if (!c) return;
  const ja = c.reacoes.get(m.id)?.get(emoji)?.has(meuId());
  const linha = { mensagem_id: m.id, user_id: meuId(), emoji };
  reagiu(c, linha, ja);
  desenhar({ manterDoFim: true });
  try {
    if (ja) conferir(await sb.from('exilados_reacoes').delete().eq('mensagem_id', m.id).eq('user_id', meuId()).eq('emoji', emoji));
    else conferir(await sb.from('exilados_reacoes').insert(linha));
  } catch (falha) {
    reagiu(c, linha, !ja);
    desenhar({ manterDoFim: true });
    erro(falha);
  }
}

async function apagar(m) {
  const sim = await confirmar({
    titulo: 'Apagar mensagem',
    texto: 'Tem certeza? A mensagem some para todo mundo.',
    botao: 'Apagar', perigo: true,
  });
  if (!sim) return;
  try {
    conferir(await sb.from('exilados_mensagens').delete().eq('id', m.id));
    tirar(m.id);
    if (minha(m)) {
      if (m.imagem) sb.storage.from(PASTA_IMAGENS).remove([m.imagem]).catch(() => {});
      if (m.arquivo?.caminho) sb.storage.from(PASTA_ARQUIVOS).remove([m.arquivo.caminho]).catch(() => {});
    }
  } catch (falha) {
    erro(falha);
  }
}

function editar(m) {
  const c = atual;
  if (!c || !minha(m) || m.chamada) return;
  c.editando = m.id;
  c.rascunhoEdicao = m.texto || '';
  c.focarEdicao = true;
  desenhar({ manterDoFim: true });
}

async function salvarEdicao(m, texto) {
  const c = atual;
  const limpo = texto.trim();
  if (limpo === (m.texto || '').trim()) {
    c.editando = null;
    desenhar({ manterDoFim: true });
    return;
  }
  if (!mensagemValida(limpo, Boolean(m.imagem || m.arquivo || m.gif))) {
    if (!limpo) return apagar(m);
    erro(new Error(`A mensagem passa de ${LIMITE_MENSAGEM} caracteres.`));
    return;
  }
  const { mencoes, todos } = acharMencoes(limpo, membrosAtivos(), { podeTodos: c.tipo === 'sala' });
  try {
    const linha = conferir(await sb.from('exilados_mensagens').update({ texto: limpo, mencoes, menciona_todos: todos })
      .eq('id', m.id).select(CAMPOS).single());
    c.editando = null;
    trocar(linha);
    c.focar?.();
  } catch (falha) {
    erro(falha);
  }
}

function caixaDeEdicao(m) {
  const c = atual;
  // O rascunho sobrevive a mensagens que chegam enquanto se edita (a lista é redesenhada).
  const area = el('textarea', { value: c.rascunhoEdicao ?? m.texto ?? '', rows: 1, maxLength: LIMITE_MENSAGEM + 200, attrs: { 'aria-label': 'Editar mensagem' } });
  const ajustar = () => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 300)}px`;
  };
  const cancelar = () => {
    atual.editando = null;
    desenhar({ manterDoFim: true });
    atual.focar?.();
  };
  area.addEventListener('input', () => {
    c.rascunhoEdicao = area.value;
    ajustar();
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); salvarEdicao(m, area.value); }
  });
  const focar = c.focarEdicao;
  c.focarEdicao = false;
  requestAnimationFrame(() => {
    ajustar();
    if (!focar) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
  return el('div', { class: 'editando' }, area,
    el('small', {},
      'Esc para ', el('button', { class: 'link', text: 'cancelar', onclick: cancelar }),
      ' · Enter para ', el('button', { class: 'link', text: 'salvar', onclick: () => salvarEdicao(m, area.value) })));
}

function menuDaMensagem(m, x, y) {
  menu([
    { rotulo: 'Reagir', icone: 'emoji', fn: () => escolherEmoji(x, y, (emoji) => alternarReacao(m, emoji)) },
    m.chamada ? null : { rotulo: 'Responder', icone: 'responder', fn: () => atual?.responder?.(m) },
    minha(m) && !m.chamada ? { rotulo: 'Editar', icone: 'lapis', fn: () => editar(m) } : null,
    m.texto ? { rotulo: 'Copiar texto', icone: 'link', fn: () => navigator.clipboard?.writeText(m.texto).catch(() => {}) } : null,
    podeApagar(m) ? 'separador' : null,
    podeApagar(m) ? { rotulo: 'Apagar mensagem', icone: 'lixo', perigo: true, fn: () => apagar(m) } : null,
  ], x, y);
}

function ferramentas(m) {
  return el('div', { class: 'ferramentas' },
    botaoIcone('emoji', 'Reagir', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      escolherEmoji(r.left - 200, r.bottom + 4, (emoji) => alternarReacao(m, emoji));
    }),
    m.chamada ? null : botaoIcone('responder', 'Responder', () => atual?.responder?.(m)),
    minha(m) && !m.chamada ? botaoIcone('lapis', 'Editar', () => editar(m)) : null,
    botaoIcone('pontos', 'Mais', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      menuDaMensagem(m, r.left - 160, r.bottom + 4);
    }));
}

// ---------- mensagem ----------

function linhaDeChamada(c, m) {
  const autor = estado.membros.get(m.autor) || { user_id: m.autor, nome: 'Alguém' };
  const sala = `c:${m.conversa_id}`;
  const ativa = [...estado.presenca.values()].some((p) => p.voz === sala);
  const recente = Date.now() - Date.parse(m.criada_em) < 6 * 3600 * 1000;
  return el('div', { class: 'mensagem sistema', dataset: { id: m.id } },
    el('span', { class: 'icone-sistema chamada' }, icone('telefone')),
    el('span', { class: 'texto' }, el('strong', { text: autor.nome }), ` começou uma chamada. `,
      el('span', { class: 'quando', text: carimbo(m.criada_em) })),
    ativa && recente && salaDeVozAtual() !== sala
      ? el('button', { class: 'botao verde pequeno', text: 'Entrar', onclick: () => aoEntrarNaChamada(m.conversa_id) }) : null,
    ferramentas(m));
}

let salaDeVozAtual = () => null;
/** De onde saber a sala de voz atual (voz.js), sem depender dela aqui. */
export function usarSalaDeVoz(fn) {
  salaDeVozAtual = fn;
}

function elementoMensagem(c, m) {
  if (m.chamada) return linhaDeChamada(c, m);
  const autor = estado.membros.get(m.autor) || { user_id: m.autor, nome: 'Alguém' };
  const meMenciona = !minha(m) && ((m.mencoes || []).includes(meuId()) || (m.sala_id && m.menciona_todos));
  const inicio = m.inicio || Boolean(m.responde_a);
  const caixa = el('div', {
    class: `mensagem${inicio ? ' inicio' : ''}${m.pendente ? ' pendente' : ''}${meMenciona ? ' me-menciona' : ''}`,
    dataset: { id: m.id },
  });
  if (m.responde_a) caixa.append(respostaDaMensagem(c, m));
  if (inicio) {
    const foto = avatar(autor, { tamanho: 40 });
    foto.addEventListener('click', (e) => aoClicarAutor(m.autor, e.clientX + 10, e.clientY));
    caixa.append(foto, el('div', { class: 'cabecalho' },
      el('span', { class: 'autor', text: autor.nome, onclick: (e) => aoClicarAutor(m.autor, e.clientX + 10, e.clientY) }),
      el('span', { class: 'quando', text: carimbo(m.criada_em), attrs: { title: new Date(m.criada_em).toLocaleString('pt-BR') } })));
  } else {
    caixa.append(el('span', { class: 'hora-lateral', text: horaCurta(m.criada_em) }));
  }
  if (c.editando === m.id) caixa.append(caixaDeEdicao(m));
  else if (m.texto) caixa.append(textoDaMensagem(m));
  if (m.imagem || (m.urlLocal && !m.arquivo)) caixa.append(imagemDaMensagem(m));
  if (m.gif) caixa.append(gifDaMensagem(m));
  if (m.arquivo) caixa.append(arquivoDaMensagem(m));
  const link = !m.gif && linksDoTexto(m.texto || '')[0];
  if (link && !m.pendente) caixa.append(previaDaMensagem(link));
  const reacoes = reacoesDaMensagem(c, m);
  if (reacoes) caixa.append(reacoes);
  if (!m.pendente && c.editando !== m.id) caixa.append(ferramentas(m));
  aoSegurar(caixa, (e) => {
    if (e.target?.closest?.('a, video, audio, textarea, button')) return;
    menuDaMensagem(m, e.clientX, e.clientY);
  });
  return caixa;
}

function rolarAoFim() {
  if (atual) atual.lista.scrollTop = atual.lista.scrollHeight;
}

function desenhar({ manterDoFim = false } = {}) {
  const c = atual;
  if (!c) return;
  const distanciaDoFim = c.lista.scrollHeight - c.lista.scrollTop;
  const filhos = [];
  if (c.acabou) filhos.push(c.comeco);
  else filhos.push(el('button', { class: 'botao cinza pequeno carregar-mais', text: 'Carregar mensagens anteriores', onclick: carregarMais }));
  let marcouNovas = false;
  for (const m of agruparMensagens(c.mensagens)) {
    if (m.novoDia) filhos.push(el('div', { class: 'divisor-dia', attrs: { role: 'separator' } }, el('span', { text: dataPorExtenso(m.criada_em) })));
    if (!marcouNovas && c.lidaAoAbrir !== null && m.id > c.lidaAoAbrir && !minha(m) && !m.pendente) {
      marcouNovas = true;
      filhos.push(el('div', { class: 'divisor-novas', attrs: { role: 'separator' } }, el('span', { text: 'Novas' })));
    }
    filhos.push(elementoMensagem(c, m));
  }
  limpar(c.lista, filhos);
  // Quem está no fim continua no fim; quem está lendo mais acima não sai do lugar.
  if (c.colado) rolarAoFim();
  else if (manterDoFim) c.lista.scrollTop = c.lista.scrollHeight - distanciaDoFim;
}

async function carregarMais() {
  const c = atual;
  if (!c || c.carregando || c.acabou) return;
  c.carregando = true;
  try {
    const antigas = await buscar(c, c.mensagens[0]?.id);
    if (atual !== c) return;
    if (antigas.length < POR_PAGINA) c.acabou = true;
    const ids = new Set(c.mensagens.map((m) => m.id));
    c.mensagens = [...antigas.filter((m) => !ids.has(m.id)), ...c.mensagens];
    desenhar({ manterDoFim: true });
  } catch (falha) {
    erro(falha);
  } finally {
    c.carregando = false;
  }
}

function adicionar(m) {
  const c = atual;
  if (!c || m[colunaDe(c.tipo)] !== c.id) return;
  c.originais.set(m.id, m);
  if (c.mensagens.some((x) => x.id === m.id)) return;
  c.mensagens.push(m);
  c.mensagens.sort((a, b) => a.id - b.id);
  if (m.responde_a && !c.originais.has(m.responde_a)) buscarOriginais(c, [m]).then(() => desenhar({ manterDoFim: !c.colado }));
  desenhar();
  if (!document.hidden && c.colado) abriu(c.id, m.id);
}

function trocar(m) {
  const c = atual;
  if (!c || m[colunaDe(c.tipo)] !== c.id) return;
  const i = c.mensagens.findIndex((x) => x.id === m.id);
  c.originais.set(m.id, m);
  if (i < 0) return;
  c.mensagens[i] = { ...c.mensagens[i], ...m };
  desenhar({ manterDoFim: true });
}

function tirar(id) {
  const c = atual;
  if (!c) return;
  c.originais.set(id, null);
  const antes = c.mensagens.length;
  c.mensagens = c.mensagens.filter((m) => m.id !== id);
  if (c.mensagens.length !== antes || c.mensagens.some((m) => m.responde_a === id)) desenhar({ manterDoFim: true });
}

// ---------- caixa de escrever ----------

function textoDigitando(ids) {
  if (!ids.length) return '';
  if (ids.length === 1) return `${nomeDe(ids[0])} está digitando...`;
  if (ids.length === 2) return `${nomeDe(ids[0])} e ${nomeDe(ids[1])} estão digitando...`;
  return 'Várias pessoas estão digitando...';
}

function candidatosAMencao(c, busca) {
  const b = busca.toLocaleLowerCase('pt-BR');
  const pessoas = c.tipo === 'sala'
    ? membrosAtivos().filter((m) => m.user_id !== meuId())
    : [estado.membros.get(outroDaConversa(c.id))].filter(Boolean);
  const lista = pessoas.filter((m) => m.nome.toLocaleLowerCase('pt-BR').includes(b))
    .sort((x, y) => Number(!x.nome.toLocaleLowerCase('pt-BR').startsWith(b)) - Number(!y.nome.toLocaleLowerCase('pt-BR').startsWith(b))
      || x.nome.localeCompare(y.nome, 'pt-BR'))
    .slice(0, 8).map((m) => ({ id: m.user_id, nome: m.nome, pessoa: m }));
  if (c.tipo === 'sala' && 'todos'.startsWith(b)) lista.push({ id: 'todos', nome: 'todos', texto: 'avisa todo mundo da sala' });
  return lista;
}

function montarCompositor(c, rotulo) {
  const textarea = el('textarea', {
    rows: 1,
    placeholder: rotulo,
    maxLength: LIMITE_MENSAGEM + 200,
    attrs: { 'aria-label': rotulo, enterkeyhint: 'send' },
    value: rascunhos.get(c.id) || '',
  });
  const contador = el('div', { class: 'contador', hidden: true });
  const anexoCaixa = el('div', { class: 'anexo', hidden: true });
  const respostaCaixa = el('div', { class: 'respondendo', hidden: true });
  const sugestoes = el('div', { class: 'sugestoes-mencao', hidden: true, attrs: { role: 'listbox' } });
  const digitando = el('div', { class: 'digitando', attrs: { 'aria-live': 'polite' } });
  const seletor = el('input', { type: 'file', hidden: true });
  const toque = window.matchMedia('(pointer: coarse)').matches;
  let anexo = null;
  let respondendo = null;
  let enviando = false;
  let opcoes = [];
  let escolhida = 0;

  const ajustar = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.5)}px`;
    const n = textarea.value.length;
    contador.hidden = n < LIMITE_MENSAGEM - 200;
    contador.textContent = `${LIMITE_MENSAGEM - n}`;
    contador.classList.toggle('estourou', n > LIMITE_MENSAGEM);
    rascunhos.set(c.id, textarea.value);
  };

  // ----- responder -----
  c.responder = (m) => {
    respondendo = m || null;
    respostaCaixa.hidden = !m;
    if (!m) {
      limpar(respostaCaixa);
      return;
    }
    limpar(respostaCaixa,
      el('span', {}, 'Respondendo a ', el('strong', { text: nomeDe(m.autor) })),
      botaoIcone('fechar', 'Cancelar resposta', () => c.responder(null)));
    textarea.focus();
  };

  // ----- menções: sugestões ao digitar "@" -----
  const fecharSugestoes = () => {
    sugestoes.hidden = true;
    opcoes = [];
  };
  const escolher = (opcao) => {
    const cursor = textarea.selectionStart;
    const antes = textarea.value.slice(0, cursor).replace(/@[^\s@]*$/, `@${opcao.nome} `);
    textarea.value = antes + textarea.value.slice(cursor);
    textarea.setSelectionRange(antes.length, antes.length);
    fecharSugestoes();
    ajustar();
    textarea.focus();
  };
  const mostrarSugestoes = () => {
    const busca = mencaoDigitando(textarea.value, textarea.selectionStart);
    if (busca === null) return fecharSugestoes();
    opcoes = candidatosAMencao(c, busca);
    if (!opcoes.length) return fecharSugestoes();
    escolhida = Math.min(escolhida, opcoes.length - 1);
    limpar(sugestoes, el('div', { class: 'titulo', text: 'Mencionar' }), opcoes.map((o, i) => el('button', {
      class: i === escolhida ? 'escolhida' : '',
      attrs: { role: 'option', 'aria-selected': String(i === escolhida) },
      onpointerdown: (e) => { e.preventDefault(); escolher(o); },
    }, o.pessoa ? avatar(o.pessoa, { tamanho: 24 }) : el('span', { class: 'arroba', text: '@' }),
    el('span', { class: 'nome', text: o.nome }), o.texto ? el('small', { text: o.texto }) : null)));
    sugestoes.hidden = false;
  };

  // ----- anexos: imagem (reduzida), GIF animado e outros arquivos (até 25 MB) -----
  const definirAnexo = (arquivo) => {
    if (anexo?.url) URL.revokeObjectURL(anexo.url);
    anexo = null;
    limpar(anexoCaixa);
    anexoCaixa.hidden = true;
    if (!arquivo) return;
    const ehImagem = /^image\/(png|jpe?g|webp|avif|bmp|heic|heif)$/i.test(arquivo.type || '');
    if (ehImagem) {
      const motivo = conferirArquivo(arquivo);
      if (motivo) return erro(new Error(motivo));
    } else if (arquivo.size > LIMITE_ARQUIVO) {
      return erro(new Error(`O arquivo passa de ${tamanhoLegivel(LIMITE_ARQUIVO)}.`));
    } else if (!arquivo.size) {
      return erro(new Error('O arquivo está vazio.'));
    }
    anexo = { arquivo, ehImagem, url: URL.createObjectURL(arquivo) };
    const mostra = ehImagem || /^image\//.test(arquivo.type || '')
      ? el('img', { src: anexo.url, alt: 'Imagem a enviar' })
      : el('div', { class: 'cartao-arquivo' }, icone('arquivo'), el('div', { class: 'textos' }, el('strong', { text: arquivo.name }), el('small', { text: tamanhoLegivel(arquivo.size) })));
    anexoCaixa.append(el('figure', {}, mostra, botaoIcone('lixo', 'Tirar anexo', () => definirAnexo(null))));
    anexoCaixa.hidden = false;
    textarea.focus();
  };

  async function subirAnexo(a) {
    if (a.ehImagem) {
      const reduzida = await reduzirImagem(a.arquivo);
      const caminho = `${meuId()}/${crypto.randomUUID()}.${reduzida.extensao}`;
      conferir(await sb.storage.from(PASTA_IMAGENS).upload(caminho, reduzida.blob, { contentType: reduzida.tipo, upsert: false }));
      return { imagem: caminho };
    }
    const caminho = `${meuId()}/${crypto.randomUUID()}/${nomeSeguro(a.arquivo.name)}`;
    const tipo = a.arquivo.type || 'application/octet-stream';
    conferir(await sb.storage.from(PASTA_ARQUIVOS).upload(caminho, a.arquivo, { contentType: tipo, upsert: false }));
    return { arquivo: { caminho, nome: String(a.arquivo.name || 'arquivo').slice(0, 200), tipo, tamanho: String(a.arquivo.size) } };
  }

  async function inserir(campos) {
    const linha = conferir(await sb.from('exilados_mensagens')
      .insert({ [colunaDe(c.tipo)]: c.id, autor: meuId(), ...campos })
      .select(CAMPOS).single());
    c.colado = true;
    adicionar(linha);
    return linha;
  }

  const enviar = async () => {
    if (enviando) return;
    const texto = textarea.value.trim();
    if (!mensagemValida(texto, Boolean(anexo))) {
      if (texto.length > LIMITE_MENSAGEM) erro(new Error(`A mensagem passa de ${LIMITE_MENSAGEM} caracteres.`));
      return;
    }
    enviando = true;
    const anexoAgora = anexo;
    const respostaAgora = respondendo;
    try {
      const extra = anexoAgora ? await subirAnexo(anexoAgora) : {};
      const { mencoes, todos } = acharMencoes(texto, membrosAtivos(), { podeTodos: c.tipo === 'sala' });
      await inserir({ texto, ...extra, responde_a: respostaAgora?.id || null, mencoes, menciona_todos: todos });
      if (anexo === anexoAgora) definirAnexo(null);
      if (respondendo === respostaAgora) c.responder(null);
      if (textarea.value.trim() === texto) textarea.value = '';
      ajustar();
      avisarDigitando(c.id, true);
    } catch (falha) {
      // O texto e o anexo ficam na caixa para mandar de novo.
      erro(new Error(`Não enviada: ${falha.message}`));
    } finally {
      enviando = false;
    }
  };

  const enviarGif = async (gif) => {
    try {
      await inserir({ texto: '', gif, responde_a: respondendo?.id || null });
      c.responder(null);
    } catch (falha) {
      erro(new Error(`Não enviada: ${falha.message}`));
    }
  };

  textarea.addEventListener('input', () => {
    ajustar();
    mostrarSugestoes();
    if (textarea.value.trim()) avisarDigitando(c.id);
    else avisarDigitando(c.id, true);
  });
  textarea.addEventListener('click', mostrarSugestoes);
  textarea.addEventListener('blur', () => setTimeout(fecharSugestoes, 150));
  textarea.addEventListener('keydown', (e) => {
    if (!sugestoes.hidden && opcoes.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        escolhida = (escolhida + (e.key === 'ArrowDown' ? 1 : opcoes.length - 1)) % opcoes.length;
        mostrarSugestoes();
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        escolher(opcoes[escolhida]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        fecharSugestoes();
        return;
      }
    }
    if (e.key === 'Escape' && respondendo) {
      e.preventDefault();
      c.responder(null);
      return;
    }
    // Seta para cima com a caixa vazia: edita a última mensagem que eu mandei (como no Discord).
    if (e.key === 'ArrowUp' && !textarea.value && !toque) {
      const ultima = [...c.mensagens].reverse().find((m) => minha(m) && !m.chamada && !m.pendente);
      if (ultima) {
        e.preventDefault();
        editar(ultima);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !toque) {
      e.preventDefault();
      enviar();
    }
  });
  textarea.addEventListener('paste', (e) => {
    const arquivo = [...(e.clipboardData?.files || [])][0];
    if (arquivo) {
      e.preventDefault();
      definirAnexo(arquivo);
    }
  });
  seletor.addEventListener('change', () => {
    definirAnexo(seletor.files[0]);
    seletor.value = '';
  });
  const botaoGif = botaoIcone('gif', 'Enviar GIF', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    escolherGif(r.right - 340, r.top - 420, enviarGif);
  }, 'botao-gif');
  const mostrarGif = () => { botaoGif.hidden = !estado.recursos.gifs; };
  mostrarGif();
  const caixa = el('div', { class: 'caixa' },
    botaoIcone('maisCirculo', 'Enviar imagem ou arquivo', () => seletor.click()),
    textarea,
    botaoGif,
    botaoIcone('emoji', 'Emoji', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      escolherEmoji(r.right - 280, r.top - 230, (emoji) => {
        const cursor = textarea.selectionStart ?? textarea.value.length;
        textarea.value = textarea.value.slice(0, cursor) + emoji + textarea.value.slice(cursor);
        textarea.setSelectionRange(cursor + emoji.length, cursor + emoji.length);
        ajustar();
        textarea.focus();
      });
    }, 'botao-emoji'),
    toque ? botaoIcone('cima', 'Enviar', enviar) : null);
  const raiz = el('div', { class: 'compositor' }, seletor, sugestoes, respostaCaixa, anexoCaixa, caixa, el('div', { class: 'rodape' }, digitando, contador));
  raiz.addEventListener('dragover', (e) => e.preventDefault());
  raiz.addEventListener('drop', (e) => {
    const arquivo = [...(e.dataTransfer?.files || [])][0];
    if (arquivo) {
      e.preventDefault();
      definirAnexo(arquivo);
    }
  });
  const atualizarDigitando = () => { digitando.textContent = textoDigitando(quemDigita(c.id)); };
  c.pararOuvir.push(ouvir('digitando', (alvo) => { if (alvo === c.id) atualizarDigitando(); }));
  c.pararOuvir.push(ouvir('recursos', mostrarGif));
  const relogio = setInterval(atualizarDigitando, 2000);
  c.pararOuvir.push(() => clearInterval(relogio));
  c.focar = () => { if (!toque) textarea.focus(); };
  requestAnimationFrame(ajustar);
  return raiz;
}

/**
 * Abre a conversa em `corpo`. tipo: 'sala' ou 'conversa'; `comeco` é o bloco "Este é o começo...".
 */
export async function montarConversa(corpo, { tipo, id, rotulo, comeco }) {
  fecharConversa();
  const lista = el('div', { class: 'mensagens', attrs: { role: 'log', 'aria-live': 'polite' } });
  const c = {
    tipo, id, lista, mensagens: [], acabou: false, carregando: true, colado: true, comeco,
    reacoes: new Map(), originais: new Map(), editando: null, pararOuvir: [],
    lidaAoAbrir: estado.lidas.has(id) ? estado.lidas.get(id) : null,
  };
  atual = c;
  lista.addEventListener('scroll', () => {
    const estava = c.colado;
    c.colado = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
    if (c.colado && !estava && !document.hidden) abriu(c.id, c.mensagens.at(-1)?.id);
    if (lista.scrollTop < 300) carregarMais();
  });
  const barra = tipo === 'conversa' && fazerBarraDaChamada ? fazerBarraDaChamada(id) : null;
  if (barra) c.pararOuvir.push(() => barra.parar?.());
  limpar(corpo, barra, lista, montarCompositor(c, rotulo));
  try {
    const linhas = await buscar(c);
    if (atual !== c) return;
    c.mensagens = linhas;
    c.acabou = linhas.length < POR_PAGINA;
    c.carregando = false;
    desenhar();
    abriu(c.id, linhas.at(-1)?.id);
    c.focar?.();
  } catch (falha) {
    if (atual !== c) return;
    limpar(lista, el('div', { class: 'comeco' }, el('p', { text: `Não deu para carregar as mensagens: ${falha.message}` })));
  }
}

export function fecharConversa() {
  if (atual) {
    atual.pararOuvir.forEach((f) => f());
    avisarDigitando(atual.id, true);
  }
  fecharFlutuantes();
  atual = null;
}

export function conversaAberta() {
  return atual ? { tipo: atual.tipo, id: atual.id, colado: atual.colado } : null;
}

ouvir('mensagem', (m) => adicionar(m));
ouvir('mensagemMudou', (m) => { if (m?.id) trocar(m); });
ouvir('mensagemApagada', (id) => { if (id) tirar(id); });
ouvir('reacao', ({ tirada, linha }) => {
  const c = atual;
  if (!c || !linha?.mensagem_id || !c.mensagens.some((m) => m.id === linha.mensagem_id)) return;
  if (linha.user_id === meuId() && Boolean(c.reacoes.get(linha.mensagem_id)?.get(linha.emoji)?.has(meuId())) !== tirada) return;
  reagiu(c, linha, tirada);
  desenhar({ manterDoFim: true });
});
ouvir('membros', () => { if (atual && !atual.carregando) desenhar({ manterDoFim: true }); });
ouvir('presenca', () => {
  // O botão "Entrar" dos avisos de chamada depende de quem está nela.
  if (atual?.tipo === 'conversa' && !atual.carregando && atual.mensagens.some((m) => m.chamada)) desenhar({ manterDoFim: true });
});
ouvir('reconectado', async () => {
  // Busca o que chegou (e o que mudou) enquanto a conexão estava fora.
  const c = atual;
  if (!c || c.carregando) return;
  try {
    const recentes = await buscar(c);
    if (atual !== c) return;
    const novas = new Map(recentes.map((m) => [m.id, m]));
    const menor = recentes[0]?.id ?? Infinity;
    c.mensagens = c.mensagens.filter((m) => m.id < menor || novas.has(m.id)).map((m) => novas.get(m.id) || m);
    for (const m of recentes) if (!c.mensagens.some((x) => x.id === m.id)) c.mensagens.push(m);
    c.mensagens.sort((a, b) => a.id - b.id);
    desenhar();
  } catch {
    // Tenta de novo na próxima reconexão.
  }
});

export function blocoComeco({ icone: nomeIcone, pessoa, titulo, texto }) {
  return el('div', { class: 'comeco' },
    pessoa ? avatar(pessoa, { tamanho: 80 }) : el('div', { class: 'bola' }, icone(nomeIcone)),
    el('h2', { text: titulo }),
    el('p', { text: texto }));
}

