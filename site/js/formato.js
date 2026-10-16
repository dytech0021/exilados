// Funções puras de texto, datas e montagem das mensagens (testadas com node --test).

export const LIMITE_MENSAGEM = 2000;
const AGRUPAR_MS = 7 * 60 * 1000;
const CORES = ['#5865F2', '#3BA55C', '#8E5BD6', '#C0662B', '#ED4245', '#1F8B9E', '#B8572D', '#D2508E', '#4E7A2F', '#6A6FD6'];

/** Divide o texto em pedaços de texto comum e links http(s), para montar a mensagem sem HTML. */
export function partesDoTexto(texto) {
  const partes = [];
  const padrao = /\bhttps?:\/\/[^\s<>"]+/gi;
  let fim = 0;
  for (const achado of String(texto).matchAll(padrao)) {
    let link = achado[0];
    // Pontuação no fim normalmente é da frase, não do link.
    while (/[.,:;!?'")\]]$/.test(link)) {
      if (link.endsWith(')') && (link.match(/\(/g) || []).length >= (link.match(/\)/g) || []).length) break;
      link = link.slice(0, -1);
    }
    if (achado.index > fim) partes.push({ tipo: 'texto', valor: texto.slice(fim, achado.index) });
    partes.push({ tipo: 'link', valor: link });
    fim = achado.index + link.length;
  }
  if (fim < String(texto).length) partes.push({ tipo: 'texto', valor: String(texto).slice(fim) });
  return partes;
}

export function mesmoDia(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function horaCurta(data) {
  const d = new Date(data);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
  'novembro', 'dezembro'];

export function dataPorExtenso(data) {
  const d = new Date(data);
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** "Hoje às 21:03", "Ontem às 21:03" ou "15/10/2026 21:03". */
export function carimbo(data, agora = Date.now()) {
  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(data, agora)) return `Hoje às ${horaCurta(data)}`;
  if (mesmoDia(data, ontem)) return `Ontem às ${horaCurta(data)}`;
  const d = new Date(data);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${horaCurta(data)}`;
}

/**
 * Marca, em mensagens em ordem crescente, onde começa um bloco (mostra foto e nome, como no Discord) e onde muda o
 * dia (divisor com a data). Mensagens do mesmo autor com menos de 7 minutos entre si ficam no mesmo bloco.
 */
export function agruparMensagens(mensagens) {
  return mensagens.map((mensagem, i) => {
    const anterior = mensagens[i - 1];
    const quando = Date.parse(mensagem.criada_em);
    const novoDia = !anterior || !mesmoDia(anterior.criada_em, mensagem.criada_em);
    const inicio = novoDia || anterior.autor !== mensagem.autor || quando - Date.parse(anterior.criada_em) > AGRUPAR_MS;
    return { ...mensagem, inicio, novoDia };
  });
}

/** Nome do grupo: sem espaços sobrando; null se ficar fora de 1 a 32 caracteres. */
export function limparNome(nome) {
  const limpo = String(nome || '').replace(/\s+/g, ' ').trim();
  return limpo.length >= 1 && limpo.length <= 32 ? limpo : null;
}

export function inicial(nome) {
  const letra = String(nome || '?').trim().charAt(0);
  return letra ? letra.toUpperCase() : '?';
}

/** Cor fixa para cada conta (foto padrão). */
export function corDoId(id) {
  let soma = 0;
  for (const c of String(id)) soma = (soma * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[soma % CORES.length];
}

/** Mensagem que pode ser enviada: texto até 2.000 caracteres e não vazio, ou com imagem. */
export function mensagemValida(texto, temImagem) {
  const t = String(texto || '');
  if (t.length > LIMITE_MENSAGEM) return false;
  return t.trim().length > 0 || Boolean(temImagem);
}

export function ordenarPorNome(lista, nome = (x) => x.nome) {
  return [...lista].sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR', { sensitivity: 'base' }));
}
