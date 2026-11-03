// Coordenadas relativas: o enquadramento acompanha a janela e a tela cheia da transmissão.
export function limitarWebcam({ x = 65, y = 58, largura = 30, altura = 35 } = {}) {
  const numero = (v, padrao) => Number.isFinite(Number(v)) ? Number(v) : padrao;
  largura = Math.max(15, Math.min(90, numero(largura, 30)));
  altura = Math.max(15, Math.min(90, numero(altura, 35)));
  return { x: Math.max(0, Math.min(100 - largura, numero(x, 65))),
    y: Math.max(0, Math.min(100 - altura, numero(y, 58))), largura, altura };
}
