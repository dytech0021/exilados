// Imagens enviadas no chat e fotos de perfil: conferidas e reduzidas no navegador antes de subir.
// As contas de tamanho são puras (testadas); a redução usa o canvas do navegador.

export const LIMITE_ORIGINAL = 15 * 1024 * 1024;
export const LIMITE_FINAL = 600 * 1024;
export const LADO_MAXIMO = 1600;
export const LADO_PERFIL = 256;

/** Cabe em `maximo` pelo lado maior, sem aumentar imagens pequenas. */
export function tamanhoAlvo(largura, altura, maximo) {
  const escala = Math.min(1, maximo / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
}

/** Quadrado central (para a foto de perfil). */
export function recorteQuadrado(largura, altura) {
  const lado = Math.min(largura, altura);
  return { x: Math.floor((largura - lado) / 2), y: Math.floor((altura - lado) / 2), lado };
}

/** Motivo da recusa, ou null se dá para tentar reduzir. */
export function conferirArquivo(arquivo) {
  if (!arquivo || !/^image\//.test(arquivo.type || '')) return 'Esse arquivo não é uma imagem.';
  if (arquivo.size > LIMITE_ORIGINAL) return 'A imagem passa de 15 MB.';
  return null;
}

function paraBlob(canvas, tipo, qualidade) {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, qualidade));
}

async function abrir(arquivo) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    } catch {
      // Alguns navegadores não abrem certos formatos por aqui; tenta pelo <img>.
    }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('Não deu para abrir essa imagem (formato desconhecido).');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Reduz para WebP (ou JPEG onde o navegador não gera WebP) até caber em `limite`.
 * Devolve { blob, tipo, extensao, largura, altura }.
 */
export async function reduzirImagem(arquivo, { maximo = LADO_MAXIMO, limite = LIMITE_FINAL, quadrado = false } = {}) {
  const motivo = conferirArquivo(arquivo);
  if (motivo) throw new Error(motivo);
  const origem = await abrir(arquivo);
  const largura0 = origem.width || origem.naturalWidth;
  const altura0 = origem.height || origem.naturalHeight;
  const corte = quadrado ? recorteQuadrado(largura0, altura0) : { x: 0, y: 0, lado: 0 };
  const larguraFonte = quadrado ? corte.lado : largura0;
  const alturaFonte = quadrado ? corte.lado : altura0;
  let alvo = tamanhoAlvo(larguraFonte, alturaFonte, maximo);
  const canvas = document.createElement('canvas');
  for (let tentativa = 0; tentativa < 6; tentativa += 1) {
    canvas.width = alvo.largura;
    canvas.height = alvo.altura;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(origem, corte.x, corte.y, larguraFonte, alturaFonte, 0, 0, alvo.largura, alvo.altura);
    for (const qualidade of [0.86, 0.76, 0.64, 0.5]) {
      let blob = await paraBlob(canvas, 'image/webp', qualidade);
      if (!blob || blob.type !== 'image/webp') blob = await paraBlob(canvas, 'image/jpeg', qualidade);
      if (blob && blob.size <= limite) {
        if (origem.close) origem.close();
        const webp = blob.type === 'image/webp';
        return { blob, tipo: blob.type, extensao: webp ? 'webp' : 'jpg', largura: alvo.largura, altura: alvo.altura };
      }
    }
    alvo = tamanhoAlvo(alvo.largura, alvo.altura, Math.round(Math.max(alvo.largura, alvo.altura) * 0.75));
  }
  if (origem.close) origem.close();
  throw new Error('Não deu para deixar essa imagem com menos de 600 KB.');
}
