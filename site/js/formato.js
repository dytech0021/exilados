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

/** ID de 9 dígitos de uma conta, em três grupos ("123 456 789"). */
export function formatarId(codigo) {
  const d = String(codigo || '').replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d;
}

/** Os 9 dígitos de um ID digitado com espaços, pontos ou traços; null se não for um ID. */
export function lerId(texto) {
  const d = String(texto || '').replace(/[\s.\-]/g, '');
  return /^[1-9]\d{8}$/.test(d) ? d : null;
}

// ---------- menções ----------

const LIMITE_DE_PALAVRA = /[\s.,:;!?'")\]}>]/;

/**
 * Quem a mensagem menciona: `@Nome` de cada membro em `membros` ([{ user_id, nome }], nomes com espaço valem) e
 * `@todos` (só onde `podeTodos`). Ignora maiúsculas; o nome precisa terminar ali (não vale "@Anabela" para "Ana").
 */
export function acharMencoes(texto, membros, { podeTodos = false } = {}) {
  const t = String(texto || '');
  const minusculo = t.toLocaleLowerCase('pt-BR');
  const ids = new Set();
  const terminaAqui = (fim) => fim >= t.length || LIMITE_DE_PALAVRA.test(t[fim]);
  for (const m of membros) {
    const alvo = `@${String(m.nome || '').toLocaleLowerCase('pt-BR')}`;
    if (alvo.length < 2) continue;
    let i = minusculo.indexOf(alvo);
    while (i >= 0) {
      if ((i === 0 || /\s|[(\[]/.test(t[i - 1])) && terminaAqui(i + alvo.length)) {
        ids.add(m.user_id);
        break;
      }
      i = minusculo.indexOf(alvo, i + 1);
    }
  }
  const todos = podeTodos && /(^|\s)@todos(?=$|[\s.,:;!?])/i.test(t);
  return { mencoes: [...ids], todos };
}

/**
 * Divide um pedaço de texto em texto comum e menções: `nomes` é { user_id: nome } dos mencionados; `todos` marca
 * "@todos". Devolve [{ tipo: 'texto'|'mencao', valor, id? }].
 */
export function partesComMencoes(texto, nomes, todos = false) {
  const alvos = Object.entries(nomes || {}).map(([id, nome]) => ({ id, rotulo: `@${nome}` }));
  if (todos) alvos.push({ id: 'todos', rotulo: '@todos' });
  alvos.sort((a, b) => b.rotulo.length - a.rotulo.length);
  const t = String(texto || '');
  const minusculo = t.toLocaleLowerCase('pt-BR');
  const partes = [];
  let fim = 0;
  let i = 0;
  while (i < t.length) {
    const achado = t[i] === '@' && (i === 0 || /\s|[(\[]/.test(t[i - 1]))
      ? alvos.find((a) => minusculo.startsWith(a.rotulo.toLocaleLowerCase('pt-BR'), i)
        && (i + a.rotulo.length >= t.length || LIMITE_DE_PALAVRA.test(t[i + a.rotulo.length])))
      : null;
    if (!achado) {
      i += 1;
      continue;
    }
    if (i > fim) partes.push({ tipo: 'texto', valor: t.slice(fim, i) });
    partes.push({ tipo: 'mencao', valor: t.slice(i, i + achado.rotulo.length), id: achado.id });
    i += achado.rotulo.length;
    fim = i;
  }
  if (fim < t.length) partes.push({ tipo: 'texto', valor: t.slice(fim) });
  return partes;
}

/** A palavra com "@" que está sendo digitada até o cursor ("@an" → "an"), ou null. */
export function mencaoDigitando(texto, cursor) {
  const antes = String(texto || '').slice(0, cursor);
  const achado = /(?:^|\s)@([^\s@]{0,32})$/.exec(antes);
  return achado ? achado[1] : null;
}

// ---------- arquivos ----------

export const LIMITE_ARQUIVO = 25 * 1024 * 1024;

/** "1,5 MB", "820 KB", "12 bytes". */
export function tamanhoLegivel(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

/** Nome de arquivo seguro para o armazenamento (sem pastas, acentos ou símbolos estranhos), até 80 caracteres. */
export function nomeSeguro(nome) {
  const limpo = String(nome || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '');
  const ponto = limpo.lastIndexOf('.');
  const ext = ponto > 0 ? limpo.slice(ponto).slice(0, 12) : '';
  const base = (ponto > 0 ? limpo.slice(0, ponto) : limpo).slice(0, 80 - ext.length) || 'arquivo';
  return base + ext;
}

/** Como mostrar um arquivo pelo tipo: 'video', 'audio', 'imagem' ou 'arquivo'. */
export function jeitoDoArquivo(tipo) {
  const t = String(tipo || '');
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(t)) return 'video';
  if (/^audio\//.test(t)) return 'audio';
  if (/^image\/(png|jpe?g|gif|webp|avif)$/.test(t)) return 'imagem';
  return 'arquivo';
}

/** Os links http(s) do texto, sem repetir, na ordem. */
export function linksDoTexto(texto) {
  return [...new Set(partesDoTexto(texto).filter((p) => p.tipo === 'link').map((p) => p.valor))];
}
