// Como o microfone vira a voz publicada na sala.
// No computador: ganho (volume de entrada) e o tratamento de voz (compressor, reforço e limitador), feitos para fone.
// No Android o próprio celular já trata a voz para chamada (eco do alto-falante, ruído); o tratamento do computador por
// cima aumentava o eco e o chiado que sobram (voz ruim no viva-voz). Lá, com volume 100% e sem o filtro de ruído, a
// voz sai direto do microfone; senão passa só pelo ganho (e pelo filtro, se ligado).

/**
 * Qual microfone pedir ao navegador. Sem escolha, no Windows, o de comunicação (o que o Windows usa em chamadas): o
 * padrão geral pode ser outro aparelho, como a webcam ou o celular usado de webcam. Escolhido, o escolhido.
 */
export function restricaoDoMicrofone({ entrada, windows }) {
  if (entrada && entrada !== 'default' && entrada !== 'communications') return { exact: entrada };
  return windows ? { ideal: 'communications' } : undefined;
}

/**
 * Cancelamento de eco pedido ao navegador. No computador, 'all' faz o Chromium usar tudo o que sai do computador (não
 * só a chamada) como referência, como o Discord faz: o jogo ou a live que vaza do fone para o microfone é apagado.
 * Onde o navegador não conhece 'all', vale como `true`. No Android, o celular já cuida do eco da chamada.
 */
export function modoDoEco({ android, somDoComputador }) {
  return !android && somDoComputador ? 'all' : true;
}

export function montagemDaVoz({ android, cancelamentoRuido, volumeEntrada }) {
  if (!android) return { direto: false, tratamento: true };
  return { direto: !cancelamentoRuido && volumeEntrada === 100, tratamento: false };
}
