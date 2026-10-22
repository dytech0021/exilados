// Lê em voz alta o nome de quem entra na sala de voz (pela leitura de texto do próprio navegador/Windows).
// No app do Android o WebView não tem leitura em voz alta: lá o anúncio simplesmente não acontece.

const navegador = () => ({
  sintese: typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined,
  Fala: typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined,
});

/** Fala "<nome> entrou". Devolve se falou. */
export function anunciarEntrada(nome, { ligado, surdo, ...ambiente }) {
  const { sintese, Fala } = ambiente.sintese ? ambiente : navegador();
  if (!ligado || surdo || !sintese || !Fala) return false;
  const fala = new Fala(`${nome} entrou`);
  fala.lang = 'pt-BR';
  const voz = sintese.getVoices().find((v) => /^pt[-_]BR/i.test(v.lang)) || sintese.getVoices().find((v) => /^pt/i.test(v.lang));
  if (voz) fala.voice = voz;
  sintese.speak(fala);
  return true;
}
