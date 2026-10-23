// O celular não deve precisar decodificar a única faixa em 1080p/60 fps.
// Com simulcast, o servidor pode entregar uma camada menor sem reduzir a imagem no computador.
export function opcoesPublicacaoTela(LK, q) {
  const camadas = [LK.VideoPresets.h360];
  if (q.altura > 720) camadas.push(LK.VideoPresets.h720);
  return {
    source: LK.Track.Source.ScreenShare,
    videoCodec: 'h264',
    backupCodec: false,
    simulcast: true,
    screenShareEncoding: { maxBitrate: q.bitrate, maxFramerate: q.fps },
    screenShareSimulcastLayers: camadas,
  };
}

/**
 * Camada pedida ao servidor. Com várias telas abertas lado a lado, cada uma vem em 720p (a de tela cheia, `destaque`,
 * na máxima): com o dynacast, quem transmite nem envia o 1080p que ninguém está vendo grande.
 */
export function qualidadeRecebida(LK, celular, temCamadas, { varias = false, destaque = false } = {}) {
  // Quem ainda transmite com uma única camada precisa continuar recebível até reiniciar a live.
  if (!temCamadas) return LK.VideoQuality.HIGH;
  if (celular) return LK.VideoQuality.LOW;
  return varias && !destaque ? LK.VideoQuality.MEDIUM : LK.VideoQuality.HIGH;
}
