// Lê em voz alta quem entra e quem sai da sala de voz, com a leitura de texto do próprio navegador/Windows. Prefere
// uma voz feminina natural (as "Online (Natural)" do Edge, a do Google no Chrome); no programa do Windows, a Maria.
// Nenhuma voz pronta tem sotaque carioca: o jeito carioca fica nas frases. No app do Android o WebView não tem leitura
// em voz alta, e o anúncio simplesmente não acontece.

const FRASES = {
  entrou: ['{nome} brotou na sala', '{nome} chegou', 'Olha só, {nome} chegou'],
  saiu: ['{nome} vazou', '{nome} meteu o pé', '{nome} saiu da sala'],
};

/** A frase do anúncio (`variante` escolhe entre as opções), ou null para evento desconhecido. */
export function textoDoAnuncio(nome, evento, variante = 0) {
  const opcoes = FRASES[evento];
  if (!opcoes) return null;
  return opcoes[Math.abs(Math.trunc(variante)) % opcoes.length].replace('{nome}', String(nome || 'Alguém').trim() || 'Alguém');
}

const FEMININAS = /francisca|thalita|maria|luciana|google/i;
const MASCULINAS = /daniel|antonio|antônio/i;

/** A voz em português mais natural e feminina disponível, ou null. */
export function escolherVoz(vozes) {
  const pt = vozes.filter((v) => /^pt[-_]BR/i.test(v.lang));
  const lista = pt.length ? pt : vozes.filter((v) => /^pt/i.test(v.lang));
  const nota = (v) => (FEMININAS.test(v.name) ? 2 : 0) - (MASCULINAS.test(v.name) ? 2 : 0) + (/natural|online|google/i.test(v.name) ? 3 : 0);
  return lista.sort((a, b) => nota(b) - nota(a))[0] || null;
}

const navegador = () => ({
  sintese: typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined,
  Fala: typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined,
});

/** Fala "<nome> brotou na sala" / "<nome> vazou"... (`evento`: 'entrou' ou 'saiu'). Devolve se falou. */
export function anunciar(nome, evento, { ligado, surdo, sorteio = Math.random, ...ambiente }) {
  const { sintese, Fala } = ambiente.sintese ? ambiente : navegador();
  const texto = textoDoAnuncio(nome, evento, Math.floor(sorteio() * 3));
  if (!ligado || surdo || !sintese || !Fala || !texto) return false;
  const fala = new Fala(texto);
  fala.lang = 'pt-BR';
  const voz = escolherVoz(sintese.getVoices());
  if (voz) fala.voice = voz;
  sintese.speak(fala);
  return true;
}
