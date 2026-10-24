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
 * Camada pedida ao servidor para a tela de alguém. Segue o tamanho de verdade da janela em que ela aparece
 * (`larguraVista`, em pixels do site; `densidade` é o devicePixelRatio): uma janelinha de canto não precisa de 1080p,
 * e decodificar menos pixels pesa menos no computador de quem está jogando. É a ideia do adaptiveStream do LiveKit,
 * feita à mão porque as janelas separadas são outra página e o automático não as enxerga.
 * Sem medida ainda, vale a regra antiga: com várias telas abertas, 720p em cada uma.
 */
export function qualidadeRecebida(LK, celular, temCamadas, { varias = false, destaque = false, larguraVista = 0, densidade = 1 } = {}) {
  // Quem ainda transmite com uma única camada precisa continuar recebível até reiniciar a live.
  if (!temCamadas) return LK.VideoQuality.HIGH;
  if (celular) return LK.VideoQuality.LOW;
  if (destaque) return LK.VideoQuality.HIGH;
  const pixels = Math.round(larguraVista * (densidade > 0 ? densidade : 1));
  if (pixels > 0) {
    if (pixels <= 800) return LK.VideoQuality.LOW; // a camada de 360p já enche essa janela
    return pixels <= 1300 ? LK.VideoQuality.MEDIUM : LK.VideoQuality.HIGH;
  }
  return varias ? LK.VideoQuality.MEDIUM : LK.VideoQuality.HIGH;
}
