export const ALTURA_TITULO = 32;
export const MARGEM = 8;

const limitar = (valor, minimo, maximo) => Math.min(Math.max(valor, minimo), maximo);

/** Cada borda controla seu eixo; a imagem se ajusta dentro da janela sem deformar. */
export function redimensionar(origem, borda, dx, dy, tela) {
  const oeste = borda.includes('w');
  const norte = borda.includes('n');
  const horizontal = oeste || borda.includes('e');
  const vertical = norte || borda.includes('s');
  const maxLargura = Math.max(1, oeste ? origem.x + origem.largura - MARGEM : tela.largura - MARGEM - origem.x);
  const maxAltura = Math.max(1, norte ? origem.y + origem.alturaVideo - MARGEM : tela.altura - MARGEM - origem.y - ALTURA_TITULO);
  const largura = horizontal ? limitar(origem.largura + dx * (oeste ? -1 : 1), Math.min(240, maxLargura), maxLargura) : origem.largura;
  const alturaVideo = vertical ? limitar(origem.alturaVideo + dy * (norte ? -1 : 1), Math.min(120, maxAltura), maxAltura) : origem.alturaVideo;
  return {
    x: oeste ? origem.x + origem.largura - largura : origem.x,
    y: norte ? origem.y + origem.alturaVideo - alturaVideo : origem.y,
    largura, alturaVideo,
  };
}

export function mover(origem, dx, dy, tela) {
  return {
    ...origem,
    x: limitar(origem.x + dx, MARGEM, Math.max(MARGEM, tela.largura - origem.largura - MARGEM)),
    y: limitar(origem.y + dy, MARGEM, Math.max(MARGEM, tela.altura - origem.alturaVideo - ALTURA_TITULO - MARGEM)),
  };
}
