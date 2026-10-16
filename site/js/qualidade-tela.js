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

export function qualidadeRecebida(LK, celular, temCamadas) {
  // Quem ainda transmite com uma única camada precisa continuar recebível até reiniciar a live.
  return celular && temCamadas ? LK.VideoQuality.LOW : LK.VideoQuality.HIGH;
}
