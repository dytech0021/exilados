// O celular não deve precisar decodificar a única faixa em 1080p/60 fps.
// Com simulcast, o servidor pode entregar uma camada menor sem reduzir a imagem no computador.
// Só duas camadas (360p e a original), mesmo em 1080p: cada camada é um codificador a mais rodando no PC de quem
// transmite. Medido no programa (WebView2, H.264 na placa AMD, 1080p30): 3 camadas = 111% de um núcleo e 1,19 s de
// motor de vídeo a cada 5 s; 2 camadas = 64% e 0,90 s; 1 camada = 48% e 0,85 s. A de 720p no meio custava ~40% da CPU
// da transmissão para servir só janelas de tamanho médio, que agora recebem a original.
export function opcoesPublicacaoTela(LK, q) {
  const camadas = [LK.VideoPresets.h360];
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
export function qualidadeRecebida(LK, celular, temCamadas, {
  varias = false, destaque = false, larguraVista = 0, densidade = 1, camadas = 3,
} = {}) {
  const q = qualidadePeloTamanho(LK, celular, temCamadas, { varias, destaque, larguraVista, densidade });
  // Sem a camada do meio (transmissões novas têm só a leve e a original), a janela média recebe a original: pedir a
  // do meio faria o servidor entregar a leve, borrada.
  return q === LK.VideoQuality.MEDIUM && camadas <= 2 ? LK.VideoQuality.HIGH : q;
}

function qualidadePeloTamanho(LK, celular, temCamadas, { varias, destaque, larguraVista, densidade }) {
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
