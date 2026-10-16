// Dados do grupo: carga inicial, mudanças em tempo real (respeitam as regras de acesso de quem assina) e o canal
// privado "exilados" (presença e quem está falando).
import { avisar, estado, meuId, nomeDe } from './estado.js';
import { LimitadorFala, liveNoAr, resumirPresenca, vigiarAusencia } from './presenca.js';
import { api, conferir, sb } from './supa.js';
import { preparar } from './ui.js';

let canalDados = null;
let canalGrupo = null;
let caiu = false;
const minhaPresenca = {
  status: 'online', voz: null, mudo: false, surdo: false, tela: false, assistindo: null, desde: 0,
};
let presencaSincronizada = false;
const caminhosConhecidos = new Map();

function porOrdem(a, b) {
  return a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR');
}

export async function carregarTudo() {
  const [membros, salas, lives, amizades, conversas] = (await Promise.all([
    sb.from('exilados_membros').select('user_id,nome,avatar,papel,ativo,entrou_em'),
    sb.from('exilados_salas').select('id,nome,tipo,ordem'),
    sb.from('exilados_lives').select('user_id,caminho,comecou_em,ultimo_sinal'),
    sb.from('exilados_amizades').select('id,de,para,estado,criada_em'),
    sb.from('exilados_conversas').select('id,a,b'),
  ])).map(conferir);
  estado.membros = new Map(membros.map((m) => [m.user_id, m]));
  estado.salas = salas.sort(porOrdem);
  estado.lives = new Map(lives.map((l) => [l.user_id, l]));
  for (const l of lives) caminhosConhecidos.set(l.user_id, l.caminho);
  estado.amizades = amizades;
  estado.conversas = new Map(conversas.map((c) => [c.id, c]));
  preparar(membros.map((m) => m.avatar));
  for (const evento of ['membros', 'salas', 'lives', 'amizades', 'conversas']) avisar(evento);
}

async function acertarRelogio() {
  try {
    estado.diferencaRelogio = await api.diferencaDoRelogio();
  } catch {
    // Sem o servidor, fica a diferença anterior.
  }
}

function aplicar(lista, mudanca, chave = 'id') {
  if (mudanca.eventType === 'DELETE') return lista.filter((x) => x[chave] !== mudanca.old[chave]);
  const resto = lista.filter((x) => x[chave] !== mudanca.new[chave]);
  return [...resto, mudanca.new];
}

function mudouLive(mudanca) {
  if (mudanca.eventType === 'DELETE') {
    estado.lives.delete(mudanca.old.user_id);
    caminhosConhecidos.delete(mudanca.old.user_id);
  } else {
    const live = mudanca.new;
    const nova = caminhosConhecidos.get(live.user_id) !== live.caminho;
    estado.lives.set(live.user_id, live);
    caminhosConhecidos.set(live.user_id, live.caminho);
    if (nova && live.user_id !== meuId()) avisar('liveComecou', live);
  }
  avisar('lives');
}

function assinarMudancas() {
  const tabela = (nome, evento = '*') => ({ event: evento, schema: 'public', table: nome });
  canalDados = sb.channel('exilados-dados')
    .on('postgres_changes', tabela('exilados_membros'), (m) => {
      if (m.eventType === 'DELETE') estado.membros.delete(m.old.user_id);
      else estado.membros.set(m.new.user_id, m.new);
      if (m.new?.avatar) preparar([m.new.avatar]);
      avisar('membros');
      if (m.new?.user_id === meuId() && m.new.ativo === false) avisar('removido');
    })
    .on('postgres_changes', tabela('exilados_salas'), (m) => {
      estado.salas = aplicar(estado.salas, m).sort(porOrdem);
      avisar('salas');
    })
    .on('postgres_changes', tabela('exilados_lives'), mudouLive)
    .on('postgres_changes', tabela('exilados_amizades'), (m) => {
      const antes = m.eventType === 'UPDATE' ? estado.amizades.find((a) => a.id === m.new.id) : null;
      estado.amizades = aplicar(estado.amizades, m);
      avisar('amizades');
      if (m.eventType === 'INSERT' && m.new.para === meuId()) avisar('pedidoAmizade', m.new);
      if (antes && antes.estado !== 'aceita' && m.new.estado === 'aceita' && m.new.de === meuId()) avisar('amizadeAceita', m.new);
    })
    .on('postgres_changes', tabela('exilados_conversas'), (m) => {
      if (m.eventType === 'DELETE') estado.conversas.delete(m.old.id);
      else estado.conversas.set(m.new.id, m.new);
      avisar('conversas');
    })
    .on('postgres_changes', tabela('exilados_mensagens', 'INSERT'), (m) => avisar('mensagem', m.new))
    .subscribe(async (situacao) => {
      if (situacao === 'SUBSCRIBED') {
        if (caiu) {
          caiu = false;
          // Pode ter perdido mudanças enquanto estava fora: busca tudo de novo.
          await carregarTudo().catch(() => {});
          avisar('reconectado');
        }
        mudarConexao(true);
      } else if (situacao === 'CHANNEL_ERROR' || situacao === 'TIMED_OUT' || situacao === 'CLOSED') {
        caiu = true;
        mudarConexao(false);
      }
    });
}

function mudarConexao(conectado) {
  if (estado.conectado === conectado) return;
  estado.conectado = conectado;
  avisar('conexao', conectado);
}

function assinarGrupo() {
  canalGrupo = sb.channel('exilados', {
    config: { private: true, presence: { key: meuId() }, broadcast: { self: false } },
  });
  canalGrupo
    .on('presence', { event: 'sync' }, () => {
      const antes = estado.presenca;
      estado.presenca = resumirPresenca(canalGrupo.presenceState());
      // Alguém começou a compartilhar a tela (na primeira sincronia, o que já estava no ar não é novidade).
      if (presencaSincronizada) {
        for (const [id, p] of estado.presenca) {
          if (p.tela && !antes.get(id)?.tela && id !== meuId()) avisar('telaComecou', id);
        }
      }
      presencaSincronizada = true;
      for (const id of [...estado.falando]) {
        if (!estado.presenca.get(id)?.voz) estado.falando.delete(id);
      }
      avisar('presenca');
    })
    .on('broadcast', { event: 'falando' }, ({ payload }) => {
      if (!payload?.id) return;
      if (payload.falando) estado.falando.add(payload.id);
      else estado.falando.delete(payload.id);
      avisar('falando');
    })
    .subscribe(async (situacao) => {
      if (situacao === 'SUBSCRIBED') await canalGrupo.track({ ...minhaPresenca }).catch(() => {});
    });
}

/** Muda o que este site publica na presença (status, sala de voz, microfone e som). */
export function atualizarPresenca(parcial) {
  Object.assign(minhaPresenca, parcial);
  if (parcial.voz !== undefined) minhaPresenca.desde = parcial.voz ? Date.now() : 0;
  canalGrupo?.track({ ...minhaPresenca }).catch(() => {});
}

const limitador = new LimitadorFala((falando) => {
  canalGrupo?.send({ type: 'broadcast', event: 'falando', payload: { id: meuId(), falando } }).catch(() => {});
});

/** O próprio anel verde: aparece na hora aqui e vai aos outros no máximo 2 vezes por segundo. */
export function avisarQueFalo(falando) {
  const id = meuId();
  const antes = estado.falando.has(id);
  if (falando) estado.falando.add(id);
  else estado.falando.delete(id);
  if (antes !== Boolean(falando)) avisar('falando');
  limitador.atualizar(falando);
}

export async function conectar() {
  await sb.realtime.setAuth().catch(() => {});
  await acertarRelogio();
  assinarMudancas();
  assinarGrupo();
  vigiarAusencia((ausente) => atualizarPresenca({ status: ausente ? 'ausente' : 'online' }));
  setInterval(acertarRelogio, 10 * 60 * 1000);
  // As lives "envelhecem" sem mudança no banco (sinal parado): reavalia a cada 5 s.
  let noAr = '';
  setInterval(() => {
    const agora = Date.now() + estado.diferencaRelogio;
    const atual = [...estado.lives.values()].filter((l) => liveNoAr(l, agora)).map((l) => l.user_id).sort().join(',');
    if (atual !== noAr) {
      noAr = atual;
      avisar('lives');
    }
  }, 5000);
  window.addEventListener('online', () => mudarConexao(true));
  window.addEventListener('offline', () => mudarConexao(false));
}

export function nomeDaSala(id) {
  return estado.salas.find((s) => s.id === id)?.nome || 'sala';
}

export { nomeDe };
