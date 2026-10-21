// Presença (quem está online, ausente e em qual sala de voz) e quem está falando, pelo canal privado "exilados"
// do Supabase Realtime. As funções puras são testadas; o canal é montado por grupo.js.

export const SEM_SINAL_MS = 60000;
export const AUSENTE_MS = 10 * 60 * 1000;

/**
 * Junta o estado da presença ({ id: [metas de cada aba aberta] }) em um resumo por pessoa:
 * online se alguma aba está online; a sala de voz é a da aba que entrou por último.
 */
export function resumirPresenca(estado) {
  const resumo = new Map();
  for (const [id, metas] of Object.entries(estado || {})) {
    if (!Array.isArray(metas) || metas.length === 0) continue;
    const online = metas.some((m) => m.status !== 'ausente');
    const naVoz = metas.filter((m) => m.voz).sort((a, b) => (b.desde || 0) - (a.desde || 0))[0];
    resumo.set(id, {
      status: online ? 'online' : 'ausente',
      voz: naVoz ? naVoz.voz : null,
      mudo: naVoz ? Boolean(naVoz.mudo) : false,
      surdo: naVoz ? Boolean(naVoz.surdo) : false,
      // Compartilhando a tela na sala de voz, e qual transmissão está assistindo (para contar quem assiste).
      tela: naVoz ? Boolean(naVoz.tela) : false,
      assistindo: naVoz?.assistindo || null,
    });
  }
  return resumo;
}

/** Quantos estão assistindo à tela de `id` (pela presença). */
export function contarAssistindo(resumo, id) {
  let n = 0;
  for (const [quem, p] of resumo) if (quem !== id && p.assistindo === id) n += 1;
  return n;
}

/** A live está no ar se o último sinal de vida tem até 60 s (no relógio do servidor). */
export function liveNoAr(live, agoraServidor) {
  if (!live) return false;
  const sinal = Date.parse(live.ultimo_sinal);
  return Number.isFinite(sinal) && agoraServidor - sinal <= SEM_SINAL_MS;
}

/**
 * Manda "falando / parou" no máximo a cada `intervalo` ms (2 por segundo), sempre terminando no estado certo.
 */
export class LimitadorFala {
  // setTimeout/clearTimeout embrulhados: guardados como método deste objeto, o navegador lançaria "Illegal invocation"
  // (e o erro, vindo do aviso de quem fala, derrubava a conexão de voz).
  constructor(enviar, {
    intervalo = 500, agora = () => Date.now(), agendar = (fn, ms) => setTimeout(fn, ms), cancelar = (id) => clearTimeout(id),
  } = {}) {
    this.enviar = enviar;
    this.intervalo = intervalo;
    this.agora = agora;
    this.agendar = agendar;
    this.cancelar = cancelar;
    this.enviado = false;
    this.desejado = false;
    this.ultimo = -Infinity;
    this.espera = null;
  }

  atualizar(falando) {
    this.desejado = Boolean(falando);
    if (this.desejado === this.enviado) {
      if (this.espera) {
        this.cancelar(this.espera);
        this.espera = null;
      }
      return;
    }
    const falta = this.ultimo + this.intervalo - this.agora();
    if (falta <= 0) return this.#mandar();
    if (!this.espera) {
      this.espera = this.agendar(() => {
        this.espera = null;
        if (this.desejado !== this.enviado) this.#mandar();
      }, falta);
    }
  }

  #mandar() {
    this.enviado = this.desejado;
    this.ultimo = this.agora();
    this.enviar(this.enviado);
  }

  parar() {
    if (this.espera) this.cancelar(this.espera);
    this.espera = null;
  }
}

/** Observa atividade (mouse, teclado, toque) e avisa quando a pessoa fica 10 min parada e quando volta. */
export function vigiarAusencia(aoMudar, { limite = AUSENTE_MS } = {}) {
  let ausente = false;
  let timer = null;
  const reiniciar = () => {
    if (ausente) {
      ausente = false;
      aoMudar(false);
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      ausente = true;
      aoMudar(true);
    }, limite);
  };
  for (const evento of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus']) {
    window.addEventListener(evento, reiniciar, { passive: true });
  }
  reiniciar();
  return () => ausente;
}
