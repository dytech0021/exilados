// Peças de interface: elementos, ícones, fotos, avisos, menus e janelas.
import { PASTA_IMAGENS } from './config.js';
import { corDoId, inicial } from './formato.js';
import { sb } from './supa.js';

const SVG = 'http://www.w3.org/2000/svg';

/** Cria um elemento: el('div', { class: 'x', text: 'oi', onclick: fn, attrs: { title: '...' } }, filho1, filho2). */
export function el(tag, props = {}, ...filhos) {
  const elemento = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (chave === 'class') elemento.className = valor;
    else if (chave === 'text') elemento.textContent = valor;
    else if (chave === 'attrs') for (const [a, v] of Object.entries(valor)) { if (v !== undefined && v !== null && v !== false) elemento.setAttribute(a, v === true ? '' : v); }
    else if (chave === 'dataset') Object.assign(elemento.dataset, valor);
    else if (chave.startsWith('on') && typeof valor === 'function') elemento.addEventListener(chave.slice(2), valor);
    else elemento[chave] = valor;
  }
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    elemento.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return elemento;
}

export function limpar(elemento, ...filhos) {
  elemento.replaceChildren(...filhos.flat(Infinity).filter(Boolean));
  return elemento;
}

// Ícones próprios (24 × 24), desenhados com traço ou preenchimento na cor do texto.
const T = (d, largura = 2) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${largura}" stroke-linecap="round" stroke-linejoin="round"/>`;
const F = (d) => `<path d="${d}"/>`;
const ICONES = {
  hash: T('M10 3 8 21M16 3l-2 18M4 8.5h16.5M3.5 15.5H20'),
  voz: F('M3 9.5h4l5-4.2v13.4l-5-4.2H3z') + T('M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
  mic: T('M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7'),
  micMudo: T('M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7') + T('M3.5 3.5l17 17', 2.4),
  fone: T('M4 16v-3.5a8 8 0 0 1 16 0V16') + F('M3 14.5h4.5v6.5H5a2 2 0 0 1-2-2zM21 14.5h-4.5v6.5H19a2 2 0 0 0 2-2z'),
  foneMudo: T('M4 16v-3.5a8 8 0 0 1 16 0V16') + F('M3 14.5h4.5v6.5H5a2 2 0 0 1-2-2zM21 14.5h-4.5v6.5H19a2 2 0 0 0 2-2z') + T('M3.5 3.5l17 17', 2.4),
  engrenagem: '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="3.2"/><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-dasharray="3.4 3.35"/>',
  desligar: F('M12 8.5c-3.3 0-6.4 1-8.6 2.7-.6.5-.7 1.3-.3 1.9l1.4 2.2c.4.6 1.2.8 1.8.5l2.3-1.2c.5-.3.8-.8.8-1.3v-1.5a12 12 0 0 1 5.2 0v1.5c0 .6.3 1.1.8 1.3l2.3 1.2c.6.3 1.4.1 1.8-.5l1.4-2.2c.4-.6.3-1.4-.3-1.9-2.2-1.7-5.3-2.7-8.6-2.7z'),
  mais: T('M12 5v14M5 12h14'),
  maisCirculo: '<circle cx="12" cy="12" r="10"/><path d="M12 7.5v9M7.5 12h9" stroke="#383a40" stroke-width="2.2" stroke-linecap="round"/>',
  imagem: T('M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18') + '<circle cx="15.5" cy="9" r="1.6"/>',
  fechar: T('M6 6l12 12M18 6 6 18'),
  coroa: F('M3 7.5l4.6 3.8L12 4.5l4.4 6.8L21 7.5 19.2 18H4.8z'),
  pessoas: T('M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.4c2.1.7 3.5 2.6 3.5 5.6'),
  amigo: T('M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21c0-4 3.1-6.5 7-6.5 1.6 0 3 .4 4.2 1.2') + T('M16 18.5l2 2 4-4.5'),
  addAmigo: T('M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21c0-4 3.1-6.5 7-6.5 1.6 0 3 .4 4.2 1.2M19 14v7M15.5 17.5h7'),
  balao: F('M4.5 4h15A2.5 2.5 0 0 1 22 6.5v9a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4h-.5A2.5 2.5 0 0 1 2 15.5v-9A2.5 2.5 0 0 1 4.5 4z'),
  menu: T('M4 6.5h16M4 12h16M4 17.5h16'),
  abaixo: T('M6 9.5l6 6 6-6'),
  voltar: T('M15 5l-7 7 7 7'),
  certo: T('M5 12.5l4.5 4.5L19 7'),
  olho: T('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z') + '<circle cx="12" cy="12" r="3"/>',
  telaCheia: T('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'),
  sairTelaCheia: T('M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5'),
  som: F('M3 9.5h4l5-4.2v13.4l-5-4.2H3z') + T('M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
  semSom: F('M3 9.5h4l5-4.2v13.4l-5-4.2H3z') + T('M16 9.5l5 5M21 9.5l-5 5'),
  tela: T('M3 4.5h18v12H3zM8 20.5h8M12 16.5v4'),
  pontos: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
  lixo: T('M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5'),
  lapis: T('M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z'),
  cima: T('M12 19V5M6 11l6-6 6 6'),
  baixo: T('M12 5v14M6 13l6 6 6-6'),
  sair: T('M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10'),
  link: T('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'),
  removerPessoa: T('M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21c0-4 3.1-6.5 7-6.5 1.6 0 3 .4 4.2 1.2M16 15.5l5 5M21 15.5l-5 5'),
  ondas: T('M5.5 8.5a9 9 0 0 0 0 7M8.5 10.5a4 4 0 0 0 0 3M18.5 8.5a9 9 0 0 1 0 7M15.5 10.5a4 4 0 0 1 0 3') + '<circle cx="12" cy="12" r="1.8"/>',
};

export function icone(nome, classe = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icone ${classe}`.trim());
  svg.innerHTML = ICONES[nome] || '';
  return svg;
}

export function botaoIcone(nomeIcone, rotulo, aoClicar, classe = '') {
  return el('button', { class: `botao-icone ${classe}`.trim(), attrs: { title: rotulo, 'aria-label': rotulo }, onclick: aoClicar }, icone(nomeIcone));
}

// ---------- imagens guardadas no Supabase (pasta privada: endereços assinados por 1 hora) ----------

const enderecos = new Map();

export async function enderecoImagem(caminho) {
  if (!caminho) return null;
  const guardado = enderecos.get(caminho);
  if (guardado && guardado.ate > Date.now()) return guardado.promessa;
  const promessa = sb.storage.from(PASTA_IMAGENS).createSignedUrl(caminho, 3600)
    .then(({ data, error }) => (error ? null : data.signedUrl))
    .catch(() => null);
  enderecos.set(caminho, { promessa, ate: Date.now() + 50 * 60 * 1000 });
  return promessa;
}

/** Pede de uma vez os endereços de várias imagens (lista de membros, histórico). */
export async function preparar(caminhos) {
  const faltam = [...new Set(caminhos.filter(Boolean))].filter((c) => !(enderecos.get(c)?.ate > Date.now()));
  if (!faltam.length) return;
  try {
    const { data } = await sb.storage.from(PASTA_IMAGENS).createSignedUrls(faltam, 3600);
    for (const item of data || []) {
      if (item.signedUrl && item.path) enderecos.set(item.path, { promessa: Promise.resolve(item.signedUrl), ate: Date.now() + 50 * 60 * 1000 });
    }
  } catch {
    // Cada imagem tenta de novo sozinha quando aparecer.
  }
}

/** Foto redonda com a inicial na cor da conta, trocada pela foto quando houver. */
export function avatar(pessoa, { tamanho = 32, status = null, falando = false } = {}) {
  const id = pessoa?.user_id || pessoa?.id || '';
  const caixa = el('div', {
    class: `avatar t${tamanho}${falando ? ' falando' : ''}`,
    attrs: { 'aria-hidden': 'true' },
  }, inicial(pessoa?.nome));
  caixa.style.backgroundColor = corDoId(id);
  if (pessoa?.avatar) {
    enderecoImagem(pessoa.avatar).then((url) => {
      if (!url) return;
      const img = el('img', { alt: '', attrs: { draggable: 'false', referrerpolicy: 'no-referrer' } });
      img.onload = () => {
        caixa.firstChild?.nodeType === Node.TEXT_NODE && caixa.firstChild.remove();
        caixa.prepend(img);
      };
      img.src = url;
    });
  }
  if (status) caixa.append(el('span', { class: `ponto ${status}`, attrs: { title: { online: 'Online', ausente: 'Ausente', offline: 'Offline' }[status] } }));
  return caixa;
}

// ---------- avisos ----------

export function aviso(texto, { tipo = '', acao = null, duracao = 5000 } = {}) {
  const raiz = document.getElementById('avisos');
  const caixa = el('div', { class: `aviso ${tipo}`.trim(), attrs: { role: tipo === 'erro' ? 'alert' : 'status' } },
    el('span', { class: 'texto', text: texto }));
  const fechar = () => caixa.remove();
  if (acao) caixa.append(el('button', { class: 'botao pequeno', text: acao.rotulo, onclick: () => { fechar(); acao.fn(); } }));
  caixa.append(botaoIcone('fechar', 'Fechar', fechar));
  raiz.append(caixa);
  while (raiz.children.length > 4) raiz.firstChild.remove();
  if (duracao) setTimeout(fechar, duracao);
  return fechar;
}

export function erro(e) {
  aviso(e?.message || String(e), { tipo: 'erro', duracao: 7000 });
}

// ---------- menus e cartões flutuantes ----------

let flutuante = null;

export function fecharFlutuantes() {
  if (flutuante) {
    flutuante.remove();
    flutuante = null;
  }
}

document.addEventListener('pointerdown', (evento) => {
  if (flutuante && !flutuante.contains(evento.target)) fecharFlutuantes();
}, true);
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') fecharFlutuantes();
});
window.addEventListener('resize', fecharFlutuantes);

/** Mostra `caixa` perto do ponto (x, y), sem sair da tela. */
export function posicionar(caixa, x, y) {
  fecharFlutuantes();
  flutuante = caixa;
  caixa.style.left = '0px';
  caixa.style.top = '0px';
  caixa.style.visibility = 'hidden';
  document.body.append(caixa);
  const { width, height } = caixa.getBoundingClientRect();
  const margem = 8;
  caixa.style.left = `${Math.max(margem, Math.min(x, window.innerWidth - width - margem))}px`;
  caixa.style.top = `${Math.max(margem, Math.min(y, window.innerHeight - height - margem))}px`;
  caixa.style.visibility = '';
  return caixa;
}

/**
 * Menu de contexto. Itens: { rotulo, fn, perigo } | 'separador' | { rotulo: 'Volume', faixa: { min, max, valor, aoMudar } }.
 */
export function menu(itens, x, y) {
  const caixa = el('div', { class: 'menu', attrs: { role: 'menu' } });
  for (const item of itens) {
    if (!item) continue;
    if (item === 'separador') {
      caixa.append(el('div', { class: 'separador' }));
    } else if (item.titulo) {
      caixa.append(el('div', { class: 'rotulo', text: item.rotulo }));
    } else if (item.faixa) {
      const valor = el('span', { text: `${item.faixa.valor}%` });
      const faixa = el('input', {
        type: 'range', min: item.faixa.min, max: item.faixa.max, value: item.faixa.valor, step: 1,
        attrs: { 'aria-label': item.rotulo },
        oninput: (e) => {
          valor.textContent = `${e.target.value}%`;
          item.faixa.aoMudar(Number(e.target.value));
        },
      });
      caixa.append(el('div', { class: 'rotulo', text: item.rotulo }), el('div', { class: 'faixa' }, faixa, el('div', { class: 'valor' }, el('span', { text: `${item.faixa.min}%` }), valor, el('span', { text: `${item.faixa.max}%` }))));
    } else {
      caixa.append(el('button', {
        class: item.perigo ? 'perigo' : '',
        attrs: { role: 'menuitem' },
        onclick: () => { fecharFlutuantes(); item.fn(); },
      }, el('span', { text: item.rotulo }), item.icone ? icone(item.icone) : null));
    }
  }
  return posicionar(caixa, x, y);
}

// ---------- janelas ----------

/** Janela no meio da tela. Devolve { fechar, caixa }. */
export function janela({ titulo, texto, conteudo, botoes = [], classe = '', aoFechar } = {}) {
  const fundo = el('div', { class: `fundo-modal ${classe}`.trim() });
  const caixa = el('div', { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo || '' } });
  const corpo = el('div', { class: 'conteudo' }, titulo ? el('h2', { text: titulo }) : null, texto ? el('p', { text: texto }) : null, conteudo || null);
  caixa.append(corpo);
  let fechado = false;
  const fechar = () => {
    if (fechado) return;
    fechado = true;
    fundo.remove();
    document.removeEventListener('keydown', teclas, true);
    aoFechar?.();
  };
  const teclas = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      fechar();
    }
  };
  if (botoes.length) {
    caixa.append(el('div', { class: 'botoes' }, botoes.map((b) => el('button', {
      class: `botao ${b.classe || ''}`.trim(),
      text: b.rotulo,
      onclick: async (e) => {
        if (b.fn) {
          const botao = e.currentTarget;
          botao.disabled = true;
          try {
            if ((await b.fn()) === false) return;
          } catch (falha) {
            erro(falha);
            return;
          } finally {
            botao.disabled = false;
          }
        }
        fechar();
      },
    }))));
  }
  fundo.append(caixa);
  fundo.addEventListener('pointerdown', (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener('keydown', teclas, true);
  document.body.append(fundo);
  caixa.querySelector('input, textarea, select')?.focus();
  return { fechar, caixa };
}

export function confirmar({ titulo, texto, botao = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    let resposta = false;
    janela({
      titulo,
      texto,
      botoes: [
        { rotulo: 'Cancelar', classe: 'vazio' },
        { rotulo: botao, classe: perigo ? 'vermelho' : '', fn: () => { resposta = true; } },
      ],
      aoFechar: () => resolve(resposta),
    });
  });
}

export function verImagem(url) {
  const fundo = el('div', { class: 'fundo-modal visor-imagem' },
    el('div', { class: 'centro-visor' },
      el('img', { src: url, alt: 'Imagem enviada' }),
      el('a', { href: url, target: '_blank', rel: 'noopener', text: 'Abrir original' })));
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', teclas, true); };
  const teclas = (e) => { if (e.key === 'Escape') fechar(); };
  fundo.addEventListener('click', (e) => { if (e.target.tagName !== 'A') fechar(); });
  document.addEventListener('keydown', teclas, true);
  document.body.append(fundo);
}

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    aviso('Copiado.');
  } catch {
    aviso('Não deu para copiar; selecione e copie o texto.', { tipo: 'erro' });
  }
}

/** Celular: segurar o dedo abre o mesmo menu do botão direito. */
export function aoSegurar(elemento, fn, ms = 500) {
  let timer = null;
  let inicio = null;
  elemento.addEventListener('touchstart', (e) => {
    const toque = e.touches[0];
    inicio = { x: toque.clientX, y: toque.clientY };
    timer = setTimeout(() => {
      timer = null;
      fn({ clientX: inicio.x, clientY: inicio.y, preventDefault() {} });
    }, ms);
  }, { passive: true });
  const cancelar = () => { clearTimeout(timer); timer = null; };
  elemento.addEventListener('touchend', cancelar);
  elemento.addEventListener('touchmove', (e) => {
    const toque = e.touches[0];
    if (inicio && Math.hypot(toque.clientX - inicio.x, toque.clientY - inicio.y) > 10) cancelar();
  }, { passive: true });
  elemento.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    fn(e);
  });
}
