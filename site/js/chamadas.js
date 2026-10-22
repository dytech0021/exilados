// Chamadas nas conversas diretas, como no Discord e no Stoat: quem liga entra na sala de voz da conversa, um aviso
// "começou uma chamada" fica na conversa e o celular ou o PC do outro toca (até atender, recusar ou 45 s). A voz é a
// mesma das salas (LiveKit), na sala "c:<id da conversa>".
import { enviarChamada } from './dados.js';
import { estado, meuId, nomeDe, ouvir, outroDaConversa } from './estado.js';
import { notificarFora, pararToque } from './nativo.js';
import { conferir, sb } from './supa.js';
import {
  avatar, aviso, botaoIcone, el, erro, icone, janela, limpar,
} from './ui.js';
import * as voz from './voz.js';

const TOQUE_MS = 45000;
let nav = null;
let saindo = null; // chamada que eu fiz e ainda toca do outro lado: { conversa, timer }
let entrando = null; // chamada que toca aqui: { conversa, de, fechar, som, timer }

const salaDa = (conversa) => `c:${conversa}`;

/** Quem está na chamada da conversa agora (pela presença). */
export function naChamada(conversa) {
  const sala = salaDa(conversa);
  return [...estado.presenca.entries()].filter(([, p]) => p.voz === sala).map(([id]) => id);
}

// ---------- som de chamada (duas notas, como um telefone) ----------

function tocarSom() {
  let contexto;
  try {
    contexto = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return () => {};
  }
  let parado = false;
  const tocarUmaVez = () => {
    if (parado) return;
    const agora = contexto.currentTime;
    for (const [inicio, freq] of [[0, 440], [0, 480], [0.5, 440], [0.5, 480]]) {
      const osc = contexto.createOscillator();
      const ganho = contexto.createGain();
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0, agora + inicio);
      ganho.gain.linearRampToValueAtTime(0.08, agora + inicio + 0.02);
      ganho.gain.setValueAtTime(0.08, agora + inicio + 0.4);
      ganho.gain.linearRampToValueAtTime(0, agora + inicio + 0.45);
      osc.connect(ganho).connect(contexto.destination);
      osc.start(agora + inicio);
      osc.stop(agora + inicio + 0.5);
    }
  };
  contexto.resume?.().catch(() => {});
  tocarUmaVez();
  const timer = setInterval(tocarUmaVez, 3000);
  return () => {
    parado = true;
    clearInterval(timer);
    contexto.close?.().catch(() => {});
  };
}

// ---------- ligar ----------

/** Liga para o outro da conversa: entra na chamada, deixa o aviso na conversa e faz o aparelho dele tocar. */
export async function ligar(conversa) {
  const outro = outroDaConversa(conversa);
  if (!outro) return;
  const jaTinha = naChamada(conversa).some((id) => id !== meuId());
  await voz.entrar(salaDa(conversa));
  if (jaTinha) return; // o outro já estava na chamada: só entrou
  try {
    conferir(await sb.from('exilados_mensagens').insert({ conversa_id: conversa, autor: meuId(), texto: '', chamada: true }));
  } catch {
    // Sem o aviso na conversa, a chamada segue.
  }
  enviarChamada(conversa, 'tocar');
  clearTimeout(saindo?.timer);
  saindo = {
    conversa,
    timer: setTimeout(() => {
      if (saindo?.conversa !== conversa) return;
      enviarChamada(conversa, 'parar');
      saindo = null;
      if (voz.voz.sala === salaDa(conversa) && naChamada(conversa).every((id) => id === meuId())) {
        aviso(`${nomeDe(outro)} não atendeu.`, { acao: { rotulo: 'Desligar', fn: () => voz.sair().catch(erro) }, duracao: 10000 });
      }
    }, TOQUE_MS),
  };
}

// ---------- receber ----------

function pararDeTocarAqui() {
  if (!entrando) return;
  const e = entrando;
  entrando = null;
  clearTimeout(e.timer);
  e.som();
  e.fechar();
  pararToque();
}

async function atender(conversa) {
  pararDeTocarAqui();
  enviarChamada(conversa, 'atender');
  try {
    await voz.entrar(salaDa(conversa));
    nav?.irPara({ tipo: 'conversa', id: conversa });
  } catch (falha) {
    erro(falha);
  }
}

function recusar(conversa) {
  pararDeTocarAqui();
  enviarChamada(conversa, 'recusar');
}

function tocando(p) {
  if (voz.voz.sala === salaDa(p.conversa)) return; // já está nela
  if (entrando?.conversa === p.conversa) return;
  pararDeTocarAqui();
  const pessoa = estado.membros.get(p.de) || { user_id: p.de, nome: 'Alguém' };
  const conteudo = el('div', { class: 'chamada-entrando' }, avatar(pessoa, { tamanho: 80 }),
    el('p', { text: voz.voz.situacao !== 'desligada' ? 'Atender sai da sala de voz em que você está.' : 'Chamada de voz' }));
  let decidiu = false;
  const { fechar } = janela({
    titulo: `${pessoa.nome} está te ligando`,
    conteudo,
    classe: 'modal-chamada',
    botoes: [
      { rotulo: 'Recusar', classe: 'vermelho', fn: () => { decidiu = true; recusar(p.conversa); } },
      { rotulo: 'Atender', classe: 'verde', fn: () => { decidiu = true; atender(p.conversa); } },
    ],
    aoFechar: () => { if (!decidiu && entrando?.conversa === p.conversa) recusar(p.conversa); },
  });
  entrando = {
    conversa: p.conversa,
    de: p.de,
    fechar,
    som: tocarSom(),
    timer: setTimeout(() => {
      decidiu = true;
      pararDeTocarAqui();
      aviso(`Chamada perdida de ${pessoa.nome}.`, {
        acao: { rotulo: 'Ligar de volta', fn: () => ligar(p.conversa).catch(erro) },
        duracao: 0,
      });
    }, TOQUE_MS),
  };
  notificarFora({ titulo: `${pessoa.nome} está te ligando`, texto: 'Toque para atender no Exilados.', alvo: p.conversa, chamada: true });
}

// ---------- barra da chamada na conversa ----------

/** Barra no alto da conversa direta enquanto há chamada: quem está nela e entrar ou desligar. */
export function barraDaChamada(conversa) {
  const barra = el('div', { class: 'barra-chamada', hidden: true });
  const desenhar = () => {
    const ids = naChamada(conversa);
    const estou = voz.voz.sala === salaDa(conversa) && voz.voz.situacao !== 'desligada';
    barra.hidden = !ids.length && !estou;
    if (barra.hidden) return;
    limpar(barra,
      icone('telefone'),
      el('span', { class: 'texto', text: estou ? (ids.length > 1 ? 'Em chamada' : 'Chamando...') : 'Chamada em andamento' }),
      el('div', { class: 'quem' }, ids.map((id) => avatar(estado.membros.get(id) || { user_id: id, nome: '?' }, { tamanho: 24, falando: estado.falando.has(id) }))),
      estou
        ? botaoIcone('desligar', 'Desligar', () => voz.sair().catch(erro), 'desligar')
        : el('button', { class: 'botao verde pequeno', text: 'Entrar', onclick: () => voz.entrar(salaDa(conversa)).catch(erro) }));
  };
  const parar = [ouvir('presenca', desenhar), ouvir('voz', desenhar), ouvir('falando', desenhar)];
  barra.parar = () => parar.forEach((f) => f());
  desenhar();
  return barra;
}

/** Liga os avisos de chamada (tocar, parar, atender, recusar) e o fim do toque ao desligar. */
export function iniciarChamadas(navegacao) {
  nav = navegacao;
  ouvir('chamada', (p) => {
    if (p.acao === 'tocar') tocando(p);
    else if (p.acao === 'parar' && entrando?.conversa === p.conversa) {
      pararDeTocarAqui();
      aviso(`Chamada perdida de ${nomeDe(p.de)}.`, { acao: { rotulo: 'Ligar de volta', fn: () => ligar(p.conversa).catch(erro) }, duracao: 0 });
    } else if (p.acao === 'recusar' && saindo?.conversa === p.conversa) {
      clearTimeout(saindo.timer);
      saindo = null;
      aviso(`${nomeDe(p.de)} recusou a chamada.`);
      if (voz.voz.sala === salaDa(p.conversa) && naChamada(p.conversa).every((id) => id === meuId())) voz.sair().catch(() => {});
    } else if (p.acao === 'atender' && saindo?.conversa === p.conversa) {
      clearTimeout(saindo.timer);
      saindo = null;
    }
  });
  // Desligou antes de atenderem: o outro para de tocar.
  ouvir('voz', () => {
    if (saindo && voz.voz.sala !== salaDa(saindo.conversa)) {
      clearTimeout(saindo.timer);
      enviarChamada(saindo.conversa, 'parar');
      saindo = null;
    }
  });
  // Atendeu em outro aparelho (a presença mostra a pessoa na chamada): para de tocar aqui.
  ouvir('presenca', () => {
    if (entrando && estado.presenca.get(meuId())?.voz === salaDa(entrando.conversa)) pararDeTocarAqui();
  });
}
