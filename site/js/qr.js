// QR code em SVG (para baixar o app no celular), com a biblioteca qrcode-generator (MIT) copiada em vendor/.
import qrcode from '../vendor/qrcode-generator-2.0.4.js';

const MARGEM = 4; // a margem clara que os leitores esperam em volta, em módulos

/** O desenho do QR de `texto`: o lado (em módulos, com a margem) e o caminho SVG dos módulos escuros. */
export function desenhoDoQr(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  let caminho = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (qr.isDark(y, x)) caminho += `M${x + MARGEM} ${y + MARGEM}h1v1h-1z`;
  }
  return { lado: n + 2 * MARGEM, caminho };
}

/** O QR como elemento SVG, preto no branco (a câmera do celular lê melhor assim), do tamanho do contêiner. */
export function svgDoQr(texto, rotulo) {
  const { lado, caminho } = desenhoDoQr(texto);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${lado} ${lado}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', rotulo);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const fundo = document.createElementNS(ns, 'rect');
  fundo.setAttribute('width', lado);
  fundo.setAttribute('height', lado);
  fundo.setAttribute('fill', '#fff');
  const modulos = document.createElementNS(ns, 'path');
  modulos.setAttribute('d', caminho);
  modulos.setAttribute('fill', '#000');
  svg.append(fundo, modulos);
  return svg;
}
