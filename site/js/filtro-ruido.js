/** Liga o filtro e mantém a voz disponível se o AudioWorklet falhar depois da criação. */
export function conectarFiltroRuido(fonte, filtro, ganho) {
  if (!filtro) {
    fonte.connect(ganho);
    return () => {};
  }
  const aoFalhar = () => {
    console.warn('Exilados: o filtro de ruído falhou; usando o áudio normal do microfone.');
    fonte.disconnect(filtro);
    filtro.disconnect(ganho);
    fonte.connect(ganho);
  };
  filtro.addEventListener('processorerror', aoFalhar, { once: true });
  fonte.connect(filtro);
  filtro.connect(ganho);
  return () => filtro.removeEventListener('processorerror', aoFalhar);
}
