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

export function montagemDaVoz({ android, cancelamentoRuido, volumeEntrada }) {
  if (!android) return { direto: false, tratamento: true };
  return { direto: !cancelamentoRuido && volumeEntrada === 100, tratamento: false };
}
