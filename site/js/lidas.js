// O que cada um já leu, guardado no banco (exilados_lidas): as não lidas e as menções não se perdem ao recarregar e
// valem em todos os aparelhos (ler no PC limpa no celular). Como o Stoat: "li até a mensagem X" por sala e conversa.
import { avisar, estado, meuId } from './estado.js';
import { sb } from './supa.js';

const pendentes = new Map();
let timer = null;

function mudou() {
  avisar('naoLidas');
}

/** Carga inicial. Onde a pessoa nunca abriu (sem linha), começa tudo lido, sem acender o grupo inteiro. */
export async function carregarLidas() {
  const { data, error } = await sb.rpc('exilados_nao_lidas');
  if (error || !Array.isArray(data)) return; // banco sem a 003: fica só a contagem desta sessão
  const primeiraVez = [];
  for (const linha of data) {
    if (linha.ultima) estado.ultimas.set(linha.alvo, Number(linha.ultima));
    if (linha.lida === null || linha.lida === undefined) {
      if (linha.ultima) primeiraVez.push(linha);
      continue;
    }
    estado.lidas.set(linha.alvo, Number(linha.lida));
    if (linha.novas > 0) estado.naoLidas.add(linha.alvo);
    if (linha.mencoes > 0) estado.mencoes.set(linha.alvo, linha.mencoes);
  }
  for (const linha of primeiraVez) marcarLida(linha.alvo, Number(linha.ultima));
  mudou();
}

/** Guarda "li até `ate`" (junta pedidos seguidos e nunca volta para trás). */
export function marcarLida(alvo, ate) {
  if (!alvo || !ate) return;
  if ((estado.lidas.get(alvo) || 0) >= ate) return;
  estado.lidas.set(alvo, ate);
  pendentes.set(alvo, Math.max(pendentes.get(alvo) || 0, ate));
  clearTimeout(timer);
  timer = setTimeout(enviar, 800);
}

async function enviar() {
  const lista = [...pendentes];
  pendentes.clear();
  for (const [alvo, ate] of lista) {
    await sb.rpc('exilados_marcar_lida', { alvo, ate }).catch(() => {});
  }
}

/** Abriu a sala ou conversa (e está vendo o fim): limpa o aviso e marca como lida até a última. */
export function abriu(alvo, ultimaVista) {
  const ultima = Math.max(ultimaVista || 0, estado.ultimas.get(alvo) || 0);
  const tinha = estado.naoLidas.delete(alvo) | estado.mencoes.delete(alvo);
  if (ultima) marcarLida(alvo, ultima);
  if (tinha) mudou();
}

/** Uma mensagem nova chegou. Devolve se ela me menciona (para avisar com mais destaque). */
export function chegou(m, { aberta }) {
  const alvo = m.sala_id || m.conversa_id;
  estado.ultimas.set(alvo, Math.max(estado.ultimas.get(alvo) || 0, m.id));
  if (m.autor === meuId()) {
    marcarLida(alvo, m.id);
    return false;
  }
  const mencionado = (m.mencoes || []).includes(meuId()) || Boolean(m.sala_id && m.menciona_todos);
  if (aberta) {
    marcarLida(alvo, m.id);
    return mencionado;
  }
  estado.naoLidas.add(alvo);
  if (mencionado) estado.mencoes.set(alvo, (estado.mencoes.get(alvo) || 0) + 1);
  mudou();
  return mencionado;
}

/** Outro aparelho marcou como lida: se chegou até a última que se conhece, apaga o aviso aqui também. */
export function lidaEmOutroLugar(linha) {
  if (!linha || linha.user_id !== meuId()) return;
  const ate = Number(linha.ultima) || 0;
  if (ate > (estado.lidas.get(linha.alvo) || 0)) estado.lidas.set(linha.alvo, ate);
  if (ate >= (estado.ultimas.get(linha.alvo) || 0)) {
    const tinha = estado.naoLidas.delete(linha.alvo) | estado.mencoes.delete(linha.alvo);
    if (tinha) mudou();
  }
}

/** Total de menções não lidas em `alvos`. */
export function mencoesEm(alvos) {
  let total = 0;
  for (const alvo of alvos) total += estado.mencoes.get(alvo) || 0;
  return total;
}
