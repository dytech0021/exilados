// Estado do site e avisos entre as partes (quem muda o estado avisa; quem desenha escuta).

export const estado = {
  eu: null, // { id, email }
  membros: new Map(), // user_id -> linha de exilados_membros
  salas: [], // em ordem
  lives: new Map(), // user_id -> linha de exilados_lives
  presenca: new Map(), // user_id -> { status, voz, mudo, surdo }
  falando: new Set(), // user_id de quem fala agora (canal "exilados")
  amizades: [], // linhas de exilados_amizades em que eu estou
  conversas: new Map(), // id -> { id, a, b }
  naoLidas: new Set(), // ids de salas e conversas com mensagem nova
  vista: { tipo: 'grupo', id: null }, // tipo: grupo (sala de texto) | amigos | conversa | live
  modo: 'grupo', // o que a coluna da esquerda mostra: grupo | dm
  diferencaRelogio: 0, // relógio do servidor - relógio daqui (ms)
  conectado: true,
};

export const meuId = () => estado.eu?.id;
export const eu = () => estado.membros.get(estado.eu?.id);
export const souDono = () => eu()?.papel === 'dono';
export const agoraServidor = () => Date.now() + estado.diferencaRelogio;

const ouvintes = new Map();

export function ouvir(evento, fn) {
  if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
  ouvintes.get(evento).add(fn);
  return () => ouvintes.get(evento).delete(fn);
}

export function avisar(evento, dados) {
  for (const fn of ouvintes.get(evento) || []) {
    try {
      fn(dados);
    } catch (erro) {
      console.error(`Erro ao tratar "${evento}":`, erro);
    }
  }
}

/** Membros ativos (os removidos não aparecem para ninguém além deles mesmos). */
export function membrosAtivos() {
  return [...estado.membros.values()].filter((m) => m.ativo);
}

export function nomeDe(id) {
  return estado.membros.get(id)?.nome || 'Alguém';
}

export function amizadeCom(id) {
  const meu = meuId();
  return estado.amizades.find((a) => (a.de === meu && a.para === id) || (a.para === meu && a.de === id)) || null;
}

export function amigos() {
  const meu = meuId();
  return estado.amizades.filter((a) => a.estado === 'aceita').map((a) => (a.de === meu ? a.para : a.de));
}

export function conversaCom(id) {
  for (const c of estado.conversas.values()) if (c.a === id || c.b === id) return c;
  return null;
}
