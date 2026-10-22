// Seletores que abrem por cima do chat: emoji (reações) e GIF (busca no Giphy pelo exilados-api).
import { API } from './config.js';
import { api } from './supa.js';
import { el, fecharFlutuantes, limpar, posicionar } from './ui.js';

export const EMOJIS = [
  '👍', '❤️', '😂', '🤣', '😮', '😢', '😭', '😡', '🔥', '🎉', '👀', '💀', '🙏', '👏', '😍', '😎',
  '🤔', '🥲', '😅', '🤡', '💯', '✅', '❌', '⭐', '🎮', '🍕', '🍺', '🫡', '😴', '🤝', '👎', '🙄',
];

/** Os mais usados por esta pessoa vêm primeiro (guardado neste aparelho). */
function recentes() {
  try { return JSON.parse(localStorage.getItem('exilados-emojis') || '[]').filter((e) => typeof e === 'string').slice(0, 8); } catch { return []; }
}

function lembrar(emoji) {
  try { localStorage.setItem('exilados-emojis', JSON.stringify([emoji, ...recentes().filter((e) => e !== emoji)].slice(0, 8))); } catch { /* sem armazenamento */ }
}

/** Abre o seletor de emoji perto de (x, y); `aoEscolher(emoji)`. */
export function escolherEmoji(x, y, aoEscolher) {
  const lista = [...new Set([...recentes(), ...EMOJIS])];
  const caixa = el('div', { class: 'seletor-emoji', attrs: { role: 'dialog', 'aria-label': 'Escolher emoji' } },
    lista.map((emoji) => el('button', {
      text: emoji,
      attrs: { 'aria-label': emoji },
      onclick: () => {
        fecharFlutuantes();
        lembrar(emoji);
        aoEscolher(emoji);
      },
    })));
  posicionar(caixa, x, y);
}

/** Endereço para mostrar um GIF do Giphy (passa pelo exilados-api). */
export const enderecoGif = (url) => `${API}/gif?u=${encodeURIComponent(url)}`;

/** Abre a busca de GIFs perto de (x, y); `aoEscolher({ url, largura, altura, titulo })`. */
export function escolherGif(x, y, aoEscolher) {
  const busca = el('input', { type: 'search', placeholder: 'Buscar no Giphy', attrs: { 'aria-label': 'Buscar GIF', enterkeyhint: 'search' } });
  const grade = el('div', { class: 'grade' });
  const caixa = el('div', { class: 'seletor-gif', attrs: { role: 'dialog', 'aria-label': 'Escolher GIF' } },
    busca, grade, el('div', { class: 'credito', text: 'GIFs do GIPHY' }));
  let pedido = 0;
  const carregar = async () => {
    const meu = ++pedido;
    limpar(grade, el('p', { class: 'ajuda', text: 'Carregando...' }));
    try {
      const { gifs } = await api.chamar('/gifs', { busca: busca.value });
      if (meu !== pedido) return;
      if (!gifs.length) return limpar(grade, el('p', { class: 'ajuda', text: 'Nenhum GIF encontrado.' }));
      limpar(grade, gifs.map((g) => el('button', {
        attrs: { title: g.titulo || 'GIF', 'aria-label': g.titulo || 'GIF' },
        onclick: () => {
          fecharFlutuantes();
          aoEscolher({ url: g.url, largura: g.largura, altura: g.altura, titulo: g.titulo });
        },
      }, el('img', { src: enderecoGif(g.previa), alt: '', attrs: { loading: 'lazy' } }))));
    } catch (falha) {
      if (meu === pedido) limpar(grade, el('p', { class: 'ajuda', text: falha.message }));
    }
  };
  let espera = null;
  busca.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(carregar, 350);
  });
  posicionar(caixa, x, y);
  busca.focus();
  carregar();
}
