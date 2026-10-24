// Janelas de vídeo independentes, compartilhadas pelas lives do programa e telas da sala de voz.
import { ALTURA_TITULO, MARGEM, mover, redimensionar } from './flutuante.js';

const abertas = new Set();
let numeroSeparada = 0;

/**
 * Onde a transmissão aparece:
 * - 'sistema': no programa do Windows (1.0.9+), já abre numa janela do Windows, que vai para qualquer lugar ou outro
 *   monitor. A janela desenhada no site nunca sai do programa, por isso lá ela não serve.
 * - 'com-botao': no navegador do computador, a janela fica no site com o botão de destacar (o navegador pode barrar
 *   janelas novas, e muita gente prefere tudo numa aba só).
 * - 'site': no celular, no app Android e no programa antigo, só a janela do site.
 */
export function modoDaJanela({ programa, agente, app = false, ponteiroFino = true } = {}) {
  if (/Android|iPhone|iPad|iPod/i.test(agente || '') || app || !ponteiroFino) return 'site';
  if (programa) return versaoAoMenos(programa.versao, [1, 0, 9]) ? 'sistema' : 'site';
  return 'com-botao';
}

const modoDaqui = () => (typeof window.open !== 'function' ? 'site' : modoDaJanela({
  programa: window.exiladosPrograma,
  agente: navigator.userAgent,
  app: Boolean(window.ExiladosAndroid),
  ponteiroFino: window.matchMedia?.('(pointer: fine)').matches !== false,
}));

function versaoAoMenos(versao, minima) {
  const partes = String(versao || '').split('.').map(Number);
  for (let i = 0; i < minima.length; i++) {
    if ((partes[i] || 0) !== minima[i]) return (partes[i] || 0) > minima[i];
  }
  return true;
}

/** Desenho do botão de destacar (uma janelinha com uma seta saindo). */
function desenhoDeJanela() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const caminho = document.createElementNS(NS, 'path');
  caminho.setAttribute('d', 'M13 5H5v14h14v-8M14 10l6-6M15 4h5v5');
  svg.append(caminho);
  return svg;
}

/** Um vídeo que muda de página precisa voltar a tocar (o fluxo continua o mesmo). */
function retomarVideos(raiz) {
  for (const video of raiz.querySelectorAll('video')) {
    const fluxo = video.srcObject;
    if (fluxo) { video.srcObject = null; video.srcObject = fluxo; }
    video.play().catch(() => {});
  }
}
const viewport = () => ({ largura: window.innerWidth, altura: window.innerHeight });
const avisar = () => window.dispatchEvent(new Event('janelas-video'));

export function criarJanelaLive({ titulo, conteudo, aoFechar }) {
  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    e.className = classe;
    if (texto) e.textContent = texto;
    return e;
  };
  const nome = criar('span', 'janela-live-nome', titulo);
  const fechar = criar('button', 'botao-icone janela-live-fechar', '×');
  fechar.type = 'button';
  fechar.title = 'Fechar esta transmissão';
  fechar.setAttribute('aria-label', fechar.title);
  fechar.addEventListener('click', aoFechar);
  const modo = modoDaqui();
  const destacarBotao = criar('button', 'botao-icone janela-live-destacar');
  destacarBotao.type = 'button';
  destacarBotao.title = 'Abrir numa janela separada (leve para qualquer lugar ou outro monitor)';
  destacarBotao.setAttribute('aria-label', destacarBotao.title);
  destacarBotao.append(desenhoDeJanela()); // desenho, e não um caractere que pode faltar na fonte
  destacarBotao.addEventListener('click', () => destacar());
  const barra = criar('div', 'janela-live-titulo');
  barra.append(nome, ...(modo === 'com-botao' ? [destacarBotao] : []), fechar);
  const elemento = criar('section', 'janela-live');
  elemento.setAttribute('aria-label', titulo);
  elemento.append(barra, conteudo);
  const tela = viewport();
  const largura = Math.max(1, Math.min(480, tela.largura - MARGEM * 2));
  const alturaVideo = Math.max(1, Math.min(270, tela.altura - ALTURA_TITULO - MARGEM * 2));
  const deslocamento = (abertas.size % 8) * 28;
  let geometria = mover({ x: tela.largura - largura - 24 - deslocamento, y: 80 + deslocamento, largura, alturaVideo }, 0, 0, tela);
  let pararArraste = null;
  const aplicar = (nova) => {
    geometria = nova;
    Object.assign(elemento.style, {
      left: `${nova.x}px`, top: `${nova.y}px`, width: `${nova.largura}px`, height: `${nova.alturaVideo + ALTURA_TITULO}px`,
    });
  };
  const focar = () => {
    abertas.delete(janela);
    abertas.add(janela);
    let ordem = 80;
    for (const outra of abertas) {
      outra.elemento.style.zIndex = String(ordem++);
      outra.elemento.dataset.foco = String(outra === janela);
    }
  };
  const iniciar = (evento, borda) => {
    if (evento.button !== 0 || document.fullscreenElement) return;
    evento.preventDefault();
    focar();
    pararArraste?.();
    const alvo = evento.currentTarget;
    const origem = { ...geometria };
    const { clientX: x, clientY: y, pointerId } = evento;
    alvo.setPointerCapture(pointerId);
    const arrastar = (e) => aplicar(borda
      ? redimensionar(origem, borda, e.clientX - x, e.clientY - y, viewport())
      : mover(origem, e.clientX - x, e.clientY - y, viewport()));
    const parar = () => {
      alvo.removeEventListener('pointermove', arrastar);
      alvo.removeEventListener('pointerup', parar);
      alvo.removeEventListener('pointercancel', parar);
      alvo.removeEventListener('lostpointercapture', parar);
      pararArraste = null;
    };
    pararArraste = parar;
    alvo.addEventListener('pointermove', arrastar);
    alvo.addEventListener('pointerup', parar);
    alvo.addEventListener('pointercancel', parar);
    alvo.addEventListener('lostpointercapture', parar);
  };
  barra.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) iniciar(e); });
  elemento.addEventListener('pointerdown', focar);
  for (const borda of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
    const alca = criar('div', `janela-live-borda ${borda}`);
    alca.dataset.borda = borda;
    alca.setAttribute('aria-label', 'Redimensionar transmissão');
    alca.addEventListener('pointerdown', (e) => iniciar(e, borda));
    elemento.append(alca);
  }
  const ajustar = () => {
    const tela = viewport();
    aplicar(mover({ ...geometria,
      largura: Math.max(1, Math.min(geometria.largura, tela.largura - MARGEM * 2)),
      alturaVideo: Math.max(1, Math.min(geometria.alturaVideo, tela.altura - ALTURA_TITULO - MARGEM * 2)),
    }, 0, 0, tela));
  };
  let destruida = false;
  // Janela separada (de verdade, do sistema): o vídeo que já toca muda de página, sem reconectar.
  let separada = null;
  const fecharSeparada = () => { if (separada && !separada.closed) separada.close(); };
  function destacar() {
    if (separada && !separada.closed) return separada.focus();
    try {
      separada = window.open('', `exilados-video-${++numeroSeparada}`,
        `popup,width=${Math.round(geometria.largura)},height=${Math.round(geometria.alturaVideo)}`);
    } catch {
      separada = null;
    }
    // Janela barrada (navegador) ou indisponível: fica a janela desenhada no site.
    if (!separada) return;
    const doc = separada.document;
    doc.title = nome.textContent;
    const estilo = doc.createElement('link');
    estilo.rel = 'stylesheet';
    estilo.href = new URL('css/app.css', document.baseURI).href;
    doc.head.append(estilo);
    doc.body.className = 'janela-destacada';
    doc.body.append(doc.adoptNode(conteudo));
    retomarVideos(conteudo);
    elemento.hidden = true;
    // Fechar a janela separada fecha a transmissão (como fechar a janela dentro do site).
    separada.addEventListener('pagehide', () => { if (!destruida) aoFechar(); });
    avisar();
  }
  window.addEventListener('pagehide', fecharSeparada);
  const janela = {
    elemento, focar,
    definirTitulo(texto) {
      nome.textContent = texto;
      elemento.setAttribute('aria-label', texto);
      if (separada && !separada.closed) separada.document.title = texto;
    },
    destruir() {
      if (destruida) return;
      destruida = true;
      window.removeEventListener('pagehide', fecharSeparada);
      fecharSeparada();
      pararArraste?.();
      window.removeEventListener('resize', ajustar);
      abertas.delete(janela);
      elemento.remove();
      [...abertas].at(-1)?.focar();
      avisar();
    },
  };
  aplicar(geometria);
  document.getElementById('app').append(elemento);
  window.addEventListener('resize', ajustar);
  focar();
  // No programa do Windows, a janela desenhada no site não sai dele: a transmissão já abre numa janela do Windows.
  if (modo === 'sistema') destacar();
  avisar();
  return janela;
}
