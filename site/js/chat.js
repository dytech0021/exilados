// Conversa de uma sala de texto ou de uma mensagem direta: histórico (50 e mais 50 ao rolar para cima), tempo
// real, envio de texto e imagem (reduzida no navegador), rascunhos que não se perdem.
import { PASTA_IMAGENS, POR_PAGINA } from './config.js';
import { estado, meuId, ouvir } from './estado.js';
import {
  agruparMensagens, carimbo, dataPorExtenso, horaCurta, LIMITE_MENSAGEM, mensagemValida, partesDoTexto,
} from './formato.js';
import { conferirArquivo, reduzirImagem } from './imagens.js';
import { conferir, sb } from './supa.js';
import {
  avatar, botaoIcone, el, enderecoImagem, erro, icone, limpar, preparar, verImagem,
} from './ui.js';

const CAMPOS = 'id,sala_id,conversa_id,autor,texto,imagem,criada_em';
const rascunhos = new Map();
let atual = null;
let aoClicarAutor = () => {};

export function quandoClicarNoAutor(fn) {
  aoClicarAutor = fn;
}

function colunaDe(tipo) {
  return tipo === 'sala' ? 'sala_id' : 'conversa_id';
}

async function buscar(c, antesDe) {
  let consulta = sb.from('exilados_mensagens').select(CAMPOS).eq(colunaDe(c.tipo), c.id)
    .order('id', { ascending: false }).limit(POR_PAGINA);
  if (antesDe) consulta = consulta.lt('id', antesDe);
  const linhas = conferir(await consulta);
  preparar(linhas.map((m) => m.imagem));
  return linhas.reverse();
}

function textoDaMensagem(texto) {
  return el('div', { class: 'texto' }, partesDoTexto(texto).map((parte) => (parte.tipo === 'link'
    ? el('a', { href: parte.valor, target: '_blank', rel: 'noopener noreferrer', text: parte.valor })
    : parte.valor)));
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

function elementoMensagem(m) {
  const autor = estado.membros.get(m.autor) || { user_id: m.autor, nome: 'Alguém' };
  const caixa = el('div', {
    class: `mensagem${m.inicio ? ' inicio' : ''}${m.pendente ? ' pendente' : ''}`,
    dataset: { id: m.id },
  });
  if (m.inicio) {
    const foto = avatar(autor, { tamanho: 40 });
    foto.addEventListener('click', (e) => aoClicarAutor(m.autor, e.clientX + 10, e.clientY));
    caixa.append(foto, el('div', { class: 'cabecalho' },
      el('span', { class: 'autor', text: autor.nome, onclick: (e) => aoClicarAutor(m.autor, e.clientX + 10, e.clientY) }),
      el('span', { class: 'quando', text: carimbo(m.criada_em), attrs: { title: new Date(m.criada_em).toLocaleString('pt-BR') } })));
  } else {
    caixa.append(el('span', { class: 'hora-lateral', text: horaCurta(m.criada_em) }));
  }
  if (m.texto) caixa.append(textoDaMensagem(m.texto));
  if (m.imagem || m.urlLocal) caixa.append(imagemDaMensagem(m));
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
  for (const m of agruparMensagens(c.mensagens)) {
    if (m.novoDia) filhos.push(el('div', { class: 'divisor-dia', attrs: { role: 'separator' } }, el('span', { text: dataPorExtenso(m.criada_em) })));
    filhos.push(elementoMensagem(m));
  }
  limpar(c.lista, filhos);
  if (manterDoFim) c.lista.scrollTop = c.lista.scrollHeight - distanciaDoFim;
  else if (c.colado) rolarAoFim();
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
  if (c.mensagens.some((x) => x.id === m.id)) return;
  c.mensagens.push(m);
  c.mensagens.sort((a, b) => a.id - b.id);
  desenhar();
}

// ---------- caixa de escrever ----------

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
  const seletor = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const toque = window.matchMedia('(pointer: coarse)').matches;
  let anexo = null;
  let enviando = false;

  const ajustar = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.5)}px`;
    const n = textarea.value.length;
    contador.hidden = n < LIMITE_MENSAGEM - 200;
    contador.textContent = `${LIMITE_MENSAGEM - n}`;
    contador.classList.toggle('estourou', n > LIMITE_MENSAGEM);
    rascunhos.set(c.id, textarea.value);
  };

  const definirAnexo = (arquivo) => {
    if (anexo?.url) URL.revokeObjectURL(anexo.url);
    anexo = null;
    limpar(anexoCaixa);
    anexoCaixa.hidden = true;
    if (!arquivo) return;
    const motivo = conferirArquivo(arquivo);
    if (motivo) {
      erro(new Error(motivo));
      return;
    }
    anexo = { arquivo, url: URL.createObjectURL(arquivo) };
    anexoCaixa.append(el('figure', {}, el('img', { src: anexo.url, alt: 'Imagem a enviar' }), botaoIcone('lixo', 'Tirar imagem', () => definirAnexo(null))));
    anexoCaixa.hidden = false;
    textarea.focus();
  };

  const enviar = async () => {
    if (enviando) return;
    const texto = textarea.value.trim();
    if (!mensagemValida(texto, Boolean(anexo))) {
      if (texto.length > LIMITE_MENSAGEM) erro(new Error(`A mensagem passa de ${LIMITE_MENSAGEM} caracteres.`));
      return;
    }
    enviando = true;
    const anexoAgora = anexo;
    try {
      let caminho = null;
      if (anexoAgora) {
        const reduzida = await reduzirImagem(anexoAgora.arquivo);
        caminho = `${meuId()}/${crypto.randomUUID()}.${reduzida.extensao}`;
        conferir(await sb.storage.from(PASTA_IMAGENS).upload(caminho, reduzida.blob, { contentType: reduzida.tipo, upsert: false }));
      }
      const linha = conferir(await sb.from('exilados_mensagens')
        .insert({ [colunaDe(c.tipo)]: c.id, autor: meuId(), texto, imagem: caminho })
        .select(CAMPOS).single());
      if (anexo === anexoAgora) definirAnexo(null);
      if (textarea.value.trim() === texto) textarea.value = '';
      ajustar();
      c.colado = true;
      adicionar(linha);
    } catch (falha) {
      // O texto e a imagem ficam na caixa para mandar de novo.
      erro(new Error(`Não enviada: ${falha.message}`));
    } finally {
      enviando = false;
    }
  };

  textarea.addEventListener('input', ajustar);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !toque) {
      e.preventDefault();
      enviar();
    }
  });
  textarea.addEventListener('paste', (e) => {
    const arquivo = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (arquivo) {
      e.preventDefault();
      definirAnexo(arquivo);
    }
  });
  seletor.addEventListener('change', () => {
    definirAnexo(seletor.files[0]);
    seletor.value = '';
  });
  const caixa = el('div', { class: 'caixa' },
    botaoIcone('maisCirculo', 'Enviar imagem', () => seletor.click()),
    textarea,
    toque ? botaoIcone('cima', 'Enviar', enviar) : null);
  const raiz = el('div', { class: 'compositor' }, seletor, anexoCaixa, caixa, contador);
  raiz.addEventListener('dragover', (e) => e.preventDefault());
  raiz.addEventListener('drop', (e) => {
    const arquivo = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (arquivo) {
      e.preventDefault();
      definirAnexo(arquivo);
    }
  });
  c.focar = () => { if (!toque) textarea.focus(); };
  requestAnimationFrame(ajustar);
  return raiz;
}

/**
 * Abre a conversa em `corpo`. tipo: 'sala' ou 'conversa'; `comeco` é o bloco "Este é o começo...".
 */
export async function montarConversa(corpo, { tipo, id, rotulo, comeco }) {
  const lista = el('div', { class: 'mensagens', attrs: { role: 'log', 'aria-live': 'polite' } });
  const c = { tipo, id, lista, mensagens: [], acabou: false, carregando: true, colado: true, comeco };
  atual = c;
  lista.addEventListener('scroll', () => {
    c.colado = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
    if (lista.scrollTop < 300) carregarMais();
  });
  limpar(corpo, lista, montarCompositor(c, rotulo));
  estado.naoLidas.delete(id);
  try {
    const linhas = await buscar(c);
    if (atual !== c) return;
    c.mensagens = linhas;
    c.acabou = linhas.length < POR_PAGINA;
    c.carregando = false;
    desenhar();
    c.focar?.();
  } catch (falha) {
    if (atual !== c) return;
    limpar(lista, el('div', { class: 'comeco' }, el('p', { text: `Não deu para carregar as mensagens: ${falha.message}` })));
  }
}

export function fecharConversa() {
  atual = null;
}

export function conversaAberta() {
  return atual ? { tipo: atual.tipo, id: atual.id } : null;
}

ouvir('mensagem', (m) => adicionar(m));
ouvir('membros', () => { if (atual && !atual.carregando) desenhar({ manterDoFim: true }); });
ouvir('reconectado', async () => {
  // Busca o que chegou enquanto a conexão estava fora.
  const c = atual;
  if (!c || c.carregando) return;
  try {
    const recentes = await buscar(c);
    if (atual !== c) return;
    const ids = new Set(c.mensagens.map((m) => m.id));
    for (const m of recentes) if (!ids.has(m.id)) c.mensagens.push(m);
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
