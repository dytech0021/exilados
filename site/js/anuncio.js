// Anúncios neurais com cache e leitura do aparelho como alternativa quando o serviço gratuito não responde.

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
  fala.rate = 1.16;
  fala.pitch = 0.97;
  const voz = escolherVoz(sintese.getVoices());
  if (voz) fala.voice = voz;
  sintese.speak(fala);
  return true;
}

/**
 * Gera a narração no demo oficial do Qwen3-TTS a partir deste aparelho (o demo não atende o servidor) e devolve o
 * endereço do áudio, que o servidor baixa e guarda para o grupo. `pedido` vem do servidor (frase e voz fixas).
 */
export async function gerarNoServicoDeVoz({ origem, texto, idioma, descricao }, { fetch = globalThis.fetch } = {}) {
  const signal = AbortSignal.timeout(40000);
  const r = await fetch(`${origem}/gradio_api/call/generate_voice_design`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ data: [texto, idioma, descricao] }),
  });
  if (!r.ok) throw Error('Serviço de voz indisponível.');
  const { event_id: id } = await r.json();
  if (!/^[\w-]{1,100}$/.test(id || '')) throw Error('Pedido de voz recusado.');
  const eventos = await (await fetch(`${origem}/gradio_api/call/generate_voice_design/${id}`, { signal })).text();
  const completo = eventos.replace(/\r\n/g, '\n').split('\n\n').find((e) => /^event: complete\n/m.test(e));
  const dados = completo?.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
  const url = new URL((dados && JSON.parse(dados)?.[0]?.url) || 'about:blank');
  if (url.origin !== origem || !url.pathname.startsWith('/gradio_api/file=')) throw Error('Áudio de voz indisponível.');
  return url.href;
}

async function tocarNoNavegador(base64, signal) {
  // blob: (e não data:), que a política de segurança do site deixa tocar.
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const endereco = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const audio = new Audio(endereco);
  audio.playbackRate = 1.06;
  return new Promise((resolve, reject) => {
    const soltar = () => URL.revokeObjectURL(endereco);
    const parar = () => { audio.pause(); audio.removeAttribute('src'); soltar(); resolve(); };
    const fim = () => { signal.removeEventListener('abort', parar); soltar(); resolve(); };
    audio.onended = fim;
    audio.onerror = () => { signal.removeEventListener('abort', parar); soltar(); reject(Error('Áudio indisponível.')); };
    signal.addEventListener('abort', parar, { once: true });
    if (signal.aborted) return parar();
    globalThis.speechSynthesis?.cancel();
    audio.play().catch((erro) => { signal.removeEventListener('abort', parar); reject(erro); });
  });
}

/** Prepara antes do evento e não deixa uma resposta atrasada narrar depois de sair da sala. */
export function criarNarrador({ buscarAudio, tocar = tocarNoNavegador, falar = anunciar, agora = () => Date.now() }) {
  const cache = new Map();
  let controle = new AbortController();
  let fila = Promise.resolve();

  function preparar(id, nome, evento) {
    const chave = JSON.stringify([id, nome, evento]);
    const guardado = cache.get(chave);
    if (guardado && guardado.ate > agora()) return guardado.pedido;
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    const registro = { ate: Infinity, pedido: null };
    registro.pedido = Promise.resolve().then(() => buscarAudio(id, evento)).then((r) => r?.audio || null, () => null)
      .then((audio) => { registro.ate = audio ? Infinity : agora() + 60000; return audio; });
    cache.set(chave, registro);
    return registro.pedido;
  }

  return {
    preparar,
    cancelar() {
      controle.abort();
      controle = new AbortController();
      fila = Promise.resolve();
      globalThis.speechSynthesis?.cancel();
    },
    anunciar(id, nome, evento, opcoes = {}) {
      const { ligado, surdo, permitido = () => true } = opcoes;
      if (!ligado || surdo || !textoDoAnuncio(nome, evento)) return Promise.resolve(false);
      const { signal } = controle;
      const quando = agora();
      const valido = () => !signal.aborted && permitido() && agora() - quando < 10000;
      const anuncio = fila.then(async () => {
        if (!valido()) return false;
        let timer;
        // A geração continua aquecendo o cache, mas a fala atual não espera uma fila longa do serviço gratuito.
        const audio = await Promise.race([
          preparar(id, nome, evento), new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1800); }),
        ]).finally(() => clearTimeout(timer));
        if (!valido()) return false;
        if (audio) {
          try { await tocar(audio, signal); return true; } catch { /* alternativa local */ }
        }
        return valido() ? falar(nome, evento, opcoes) : false;
      });
      fila = anuncio.catch(() => {});
      return anuncio;
    },
  };
}
