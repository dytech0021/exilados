export const ALTURA_TITULO = 32;
export const MARGEM = 8;

const limitar = (valor, minimo, maximo) => Math.min(Math.max(valor, minimo), maximo);

/** Redimensiona por um canto, mantendo a razão real da imagem e o canto oposto fixo. */
export function redimensionar(origem, canto, dx, dy, proporcao, tela) {
  const oeste = canto.includes('w');
  const norte = canto.includes('n');
  const deltaHorizontal = dx * (oeste ? -1 : 1);
  const deltaVertical = dy * (norte ? -1 : 1) * proporcao;
  const delta = Math.abs(deltaHorizontal) >= Math.abs(deltaVertical) ? deltaHorizontal : deltaVertical;
  const limiteDireita = oeste ? origem.x + origem.largura - MARGEM : tela.largura - MARGEM - origem.x;
  const limiteBaixo = norte
    ? origem.y + origem.alturaVideo - MARGEM
    : tela.altura - MARGEM - origem.y - ALTURA_TITULO;
  const maximo = Math.max(1, Math.min(limiteDireita, limiteBaixo * proporcao));
  const largura = limitar(origem.largura + delta, Math.min(240, maximo), maximo);
  const alturaVideo = largura / proporcao;
  return {
    x: oeste ? origem.x + origem.largura - largura : origem.x,
    y: norte ? origem.y + origem.alturaVideo - alturaVideo : origem.y,
    largura,
    alturaVideo,
  };
}

export function mover(origem, dx, dy, tela) {
  return {
    ...origem,
    x: limitar(origem.x + dx, MARGEM, Math.max(MARGEM, tela.largura - origem.largura - MARGEM)),
    y: limitar(origem.y + dy, MARGEM, Math.max(MARGEM, tela.altura - origem.alturaVideo - ALTURA_TITULO - MARGEM)),
  };
}
