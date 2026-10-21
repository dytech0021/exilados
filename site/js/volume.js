// Volume de uma voz (ou do som de uma tela) acima de 100% onde o som toca direto no <audio> (programa do Windows): o
// <audio> só vai até 100%, então a faixa passa por um reforço (Web Audio) enquanto estiver acima disso, com o <audio>
// mudo para não tocar duas vezes; voltando a 100% ou menos, volta para o <audio>.

/** Aplica `volume` (0 a 2) na faixa remota do LiveKit; `contexto()` dá o AudioContext do reforço. */
export function volumeNaFaixa(faixa, volume, contexto) {
  const reforco = volume > 1;
  if (reforco && !faixa.reforcada) {
    faixa.setAudioContext(contexto());
    faixa.reforcada = true;
  } else if (!reforco && faixa.reforcada) {
    faixa.setAudioContext(undefined);
    faixa.reforcada = false;
  }
  for (const elemento of faixa.attachedElements) {
    elemento.muted = reforco;
    if (reforco) elemento.volume = 0;
  }
  faixa.setVolume(volume);
}
