// A tela compartilhada na sala de voz vai sempre com som: no Windows o navegador oferece o som do sistema (uma chave
// na janela de escolha que só a pessoa marca); se ela vier sem som, o site não põe no ar e pede a escolha de novo.
// Onde o navegador não oferece esse som (Mac), a tela vai como vier.

/** A captura `fluxo` deveria ter som e não tem. */
export function faltaSomDaTela(fluxo, agente) {
  return /Windows/i.test(agente || '') && fluxo.getAudioTracks().length === 0;
}
