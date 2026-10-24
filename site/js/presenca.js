// Presença (quem está online, ausente e em qual sala de voz) e quem está falando, pelo canal privado "exilados"
// do Supabase Realtime. As funções puras são testadas; o canal é montado por grupo.js.

export const SEM_SINAL_MS = 60000;
export const AUSENTE_MS = 10 * 60 * 1000;

/**
 * Junta o estado da presença ({ id: [metas de cada aba aberta] }) em um resumo por pessoa:
 * online se alguma aba está online; a sala de voz é a da aba que entrou por último.
 */
export function resumirPresenca(estado, local = null) {
  // A publicação é assíncrona: substitui só a meta desta aba, preservando as outras abas da mesma conta.
  if (local?.id) {
    estado = {
      ...estado,
      [local.id]: [...(estado?.[local.id] || []).filter((m) => m.aba !== local.meta.aba), local.meta],
    };
  }
  const resumo = new Map();
  for (const [id, metas] of Object.entries(estado || {})) {
    if (!Array.isArray(metas) || metas.length === 0) continue;
    const online = metas.some((m) => m.status !== 'ausente');
    const naVoz = metas.filter((m) => m.voz).sort((a, b) => (b.desde || 0) - (a.desde || 0))[0];
    resumo.set(id, {
      status: online ? 'online' : 'ausente',
      voz: naVoz ? naVoz.voz : null,
      desde: naVoz?.desde || 0,
      mudo: naVoz ? Boolean(naVoz.mudo) : false,
      surdo: naVoz ? Boolean(naVoz.surdo) : false,
      // Compartilhando a tela na sala de voz, e qual transmissão está assistindo (para contar quem assiste).
      tela: naVoz ? Boolean(naVoz.tela) : false,
      assistindo: naVoz?.assistindo || null,
    });
  }
  return resumo;
}

/** A conexão desta sala é imediata; fora dela, junta presença e a última consulta ao LiveKit. */
export function idsNaSala(salaId, { presenca, servidor, local, mudancas = new Map(), saidas = new Map(), meu, agora = Date.now() }) {
  if (local?.sala === salaId) return [...local.ids];
  const foiEmbora = (id, p) => {
    const saida = saidas.get(id);
    if (!saida || (p?.desde || 0) > saida.desde) return false;
    return !(servidor && (servidor.inicio ?? servidor.quando) > saida.quando && servidor.salas[salaId]?.includes(id));
  };
  const pelaPresenca = [...presenca].filter(([, p]) => p.voz === salaId);
  if (!servidor || agora - (servidor.inicio ?? servidor.quando) > 40000) {
    return pelaPresenca.filter(([id, p]) => !foiEmbora(id, p)).map(([id]) => id);
  }
  const noServidor = new Set(servidor.salas[salaId] || []);
  const ids = new Set();
  for (const [id, p] of pelaPresenca) {
    if (foiEmbora(id, p)) continue;
    if (noServidor.has(id) || id === meu || agora - (p.desde || 0) < 30000) ids.add(id);
  }
  for (const id of noServidor) {
    const p = presenca.get(id);
    if (foiEmbora(id, p)) continue;
    // voz:null é uma saída explícita, diferente de não ter recebido presença desta pessoa.
    // Se todas as abas fecharam durante a consulta, a resposta antiga também não pode recolocá-la.
    if (p ? p.voz === salaId : !mudancas.has(id) || mudancas.get(id) < (servidor.inicio ?? servidor.quando)) ids.add(id);
  }
  return [...ids];
}

/** Quantos estão assistindo à tela de `id` (pela presença; quem assiste a várias manda a lista). */
export function contarAssistindo(resumo, id) {
  let n = 0;
  for (const [quem, p] of resumo) {
    const assiste = Array.isArray(p.assistindo) ? p.assistindo.includes(id) : p.assistindo === id;
    if (quem !== id && assiste) n += 1;
  }
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
