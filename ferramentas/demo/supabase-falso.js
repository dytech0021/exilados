// Supabase de mentira para ver e testar o site sem contas de verdade (modo de demonstração local).
// Imita só o que o site usa: login, consultas simples, funções, imagens, mudanças em tempo real e presença.
// Uma pessoa fictícia fala de vez em quando, manda mensagens e fica "ao vivo".
// Com ?como=lucas (ou marina, bia) a aba entra como outra pessoa; abas abertas ao mesmo tempo dividem a presença
// (para testar duas pessoas na mesma sala de voz, como compartilhar e assistir uma tela).
(function () {
  const DYEGO = '00000000-0000-4000-8000-000000000001';
  const LUCAS = '00000000-0000-4000-8000-000000000002';
  const MARINA = '00000000-0000-4000-8000-000000000003';
  const BIA = '00000000-0000-4000-8000-000000000004';
  const RAFA = '00000000-0000-4000-8000-000000000005';
  const PEDRO = '00000000-0000-4000-8000-000000000006'; // tem conta, mas não é do grupo (para "Adicionar pelo ID")
  const S_GERAL = '10000000-0000-4000-8000-000000000001';
  const S_PRINTS = '10000000-0000-4000-8000-000000000002';
  const V_GERAL = '10000000-0000-4000-8000-000000000003';
  const V_JOGANDO = '10000000-0000-4000-8000-000000000004';
  const parametros = new URLSearchParams(location.search);
  const EU = { lucas: LUCAS, marina: MARINA, bia: BIA }[parametros.get('como')] || DYEGO;
  const MEU_NOME = { [LUCAS]: 'Lucas', [MARINA]: 'Marina', [BIA]: 'Bia' }[EU] || 'Dyego';
  const semLogin = parametros.has('sair');
  const comoMembro = !parametros.has('convite-demo');
  const agora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const uuid = () => crypto.randomUUID();

  let idMensagem = 1000;
  const db = {
    exilados_membros: [
      { user_id: DYEGO, nome: 'Dyego', avatar: null, papel: 'dono', ativo: true, entrou_em: iso(agora - 30 * 864e5) },
      { user_id: LUCAS, nome: 'Lucas', avatar: null, papel: 'membro', ativo: true, entrou_em: iso(agora - 20 * 864e5) },
      { user_id: MARINA, nome: 'Marina', avatar: null, papel: 'membro', ativo: true, entrou_em: iso(agora - 10 * 864e5) },
      { user_id: BIA, nome: 'Bia', avatar: null, papel: 'membro', ativo: true, entrou_em: iso(agora - 5 * 864e5) },
      { user_id: RAFA, nome: 'Rafa', avatar: null, papel: 'membro', ativo: false, entrou_em: iso(agora - 40 * 864e5) },
    ].filter((m) => comoMembro || m.user_id !== EU),
    exilados_salas: [
      { id: S_GERAL, nome: 'geral', tipo: 'texto', ordem: 0 },
      { id: S_PRINTS, nome: 'prints', tipo: 'texto', ordem: 10 },
      { id: V_GERAL, nome: 'Geral', tipo: 'voz', ordem: 20 },
      { id: V_JOGANDO, nome: 'Jogando', tipo: 'voz', ordem: 30 },
    ],
    exilados_mensagens: [],
    exilados_lives: [{ user_id: MARINA, caminho: 'ex/AAAAAAAAAAAAAAAAAAAAAAAA', comecou_em: iso(agora - 600000), ultimo_sinal: iso(agora) }],
    // Dyego e Lucas são amigos e já têm uma conversa direta (a mesma nas duas abas, para testar chamadas).
    exilados_amizades: [
      { id: 'a0000000-0000-4000-8000-000000000001', de: EU === LUCAS ? DYEGO : EU, para: LUCAS, estado: 'aceita', criada_em: iso(agora - 864e5) },
      { id: uuid(), de: BIA, para: EU, estado: 'pendente', criada_em: iso(agora - 3600e3) },
    ],
    exilados_conversas: [DYEGO, LUCAS].includes(EU) ? [{ id: '20000000-0000-4000-8000-000000000001', a: DYEGO, b: LUCAS }] : [],
    exilados_reacoes: [],
    exilados_lidas: [],
    exilados_ids: [
      { user_id: EU, codigo: '855593920', nome: null },
      { user_id: LUCAS, codigo: '123456789', nome: null },
      { user_id: MARINA, codigo: '234567891', nome: null },
      { user_id: BIA, codigo: '345678912', nome: null },
      { user_id: RAFA, codigo: '456789123', nome: null },
      { user_id: PEDRO, codigo: '567891234', nome: 'Pedro' },
    ],
  };
  const falas = [
    [LUCAS, 'alguém pra jogar hoje?'], [EU, 'bora, daqui a pouco entro na Geral'], [MARINA, 'tô ao vivo, colem lá'],
    [LUCAS, 'link útil: https://filabox3d.com.br/exilados/ (é aqui mesmo kkk)'], [BIA, 'chegando!'],
  ];
  const NOVA = {
    editada_em: null, responde_a: null, mencoes: [], menciona_todos: false, arquivo: null, gif: null, chamada: false,
  };
  for (let i = 0; i < 120; i += 1) {
    const [autor, texto] = falas[i % falas.length];
    db.exilados_mensagens.push({
      ...NOVA, id: idMensagem++, sala_id: S_GERAL, conversa_id: null, autor, texto: i < 115 ? `${texto} (${i + 1})` : texto, imagem: null,
      criada_em: iso(agora - (120 - i) * 9 * 60000),
    });
  }
  // Exemplos da conversa nova: menção, resposta, link do YouTube, reações e mensagem editada.
  const comVideo = idMensagem++;
  db.exilados_mensagens.push(
    { ...NOVA, id: comVideo, sala_id: S_GERAL, conversa_id: null, autor: LUCAS, texto: `@${MEU_NOME} olha isso https://www.youtube.com/watch?v=dQw4w9WgXcQ`, imagem: null, mencoes: [EU], criada_em: iso(agora - 5 * 60000) },
    { ...NOVA, id: idMensagem++, sala_id: S_GERAL, conversa_id: null, autor: MARINA, texto: 'kkkkk clássico', imagem: null, responde_a: comVideo, criada_em: iso(agora - 4 * 60000), editada_em: iso(agora - 3 * 60000) },
    { ...NOVA, id: idMensagem++, sala_id: S_GERAL, conversa_id: null, autor: BIA, texto: '@todos hoje tem Geral às 21h', imagem: null, menciona_todos: true, criada_em: iso(agora - 2 * 60000) },
  );
  db.exilados_reacoes.push({ mensagem_id: comVideo, user_id: MARINA, emoji: '😂' }, { mensagem_id: comVideo, user_id: BIA, emoji: '😂' }, { mensagem_id: comVideo, user_id: LUCAS, emoji: '🔥' });
  // Já leu até antes dos exemplos: eles aparecem como novos (com a linha "Novas").
  db.exilados_lidas.push({ user_id: EU, alvo: S_GERAL, ultima: comVideo - 1 });

  const imagens = new Map();
  const ouvintes = [];
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  function emitir(tabela, eventType, novo, velho) {
    for (const o of ouvintes) {
      if (o.table !== tabela) continue;
      if (o.event !== '*' && o.event !== eventType) continue;
      setTimeout(() => o.fn({ eventType, new: novo || {}, old: velho || {}, table: tabela, schema: 'public' }), 30);
    }
  }

  class Consulta {
    constructor(tabela) {
      this.tabela = tabela;
      this.filtros = [];
      this.ordem = null;
      this.limite = null;
      this.acao = 'select';
      this.valores = null;
      this.unico = null;
    }
    select() { return this; }
    eq(campo, valor) { this.filtros.push((r) => r[campo] === valor); return this; }
    in(campo, valores) { this.filtros.push((r) => valores.includes(r[campo])); return this; }
    lt(campo, valor) { this.filtros.push((r) => r[campo] < valor); return this; }
    order(campo, { ascending = true } = {}) { this.ordem = { campo, ascending }; return this; }
    limit(n) { this.limite = n; return this; }
    maybeSingle() { this.unico = 'talvez'; return this; }
    single() { this.unico = 'um'; return this; }
    insert(valores) { this.acao = 'insert'; this.valores = valores; return this; }
    update(valores) { this.acao = 'update'; this.valores = valores; return this; }
    delete() { this.acao = 'delete'; return this; }
    then(ok, falha) { return this.executar().then(ok, falha); }
    async executar() {
      await espera(60 + Math.random() * 120);
      const tabela = db[this.tabela];
      if (!tabela) return { data: null, error: { message: `tabela ${this.tabela} não existe` } };
      let linhas;
      if (this.acao === 'insert') {
        const lista = Array.isArray(this.valores) ? this.valores : [this.valores];
        linhas = lista.map((v) => {
          const linha = { ...v };
          if (this.tabela === 'exilados_mensagens') Object.assign(linha, { ...NOVA, ...v, id: idMensagem++, criada_em: iso(Date.now()), sala_id: v.sala_id || null, conversa_id: v.conversa_id || null });
          if (this.tabela === 'exilados_reacoes' && tabela.some((r) => r.mensagem_id === v.mensagem_id && r.user_id === v.user_id && r.emoji === v.emoji)) {
            throw Object.assign(new Error('duplicate key value violates unique constraint'), {});
          }
          if (this.tabela === 'exilados_amizades') {
            const repetida = tabela.some((a) => (a.de === v.de && a.para === v.para) || (a.de === v.para && a.para === v.de));
            if (repetida) throw Object.assign(new Error('duplicate key value violates unique constraint'), {});
            Object.assign(linha, { id: uuid(), estado: 'pendente', criada_em: iso(Date.now()) });
          }
          if (this.tabela === 'exilados_salas') linha.id = uuid();
          tabela.push(linha);
          emitir(this.tabela, 'INSERT', linha);
          return linha;
        });
      } else {
        linhas = tabela.filter((r) => this.filtros.every((f) => f(r)));
        if (this.acao === 'update') {
          for (const r of linhas) {
            if (this.tabela === 'exilados_mensagens' && 'texto' in this.valores && this.valores.texto !== r.texto) r.editada_em = iso(Date.now());
            Object.assign(r, this.valores);
            emitir(this.tabela, 'UPDATE', { ...r });
          }
        } else if (this.acao === 'delete') {
          for (const r of linhas) {
            tabela.splice(tabela.indexOf(r), 1);
            emitir(this.tabela, 'DELETE', null, { ...r });
          }
        }
        linhas = linhas.map((r) => ({ ...r }));
        if (this.ordem) {
          const { campo, ascending } = this.ordem;
          linhas.sort((a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0) * (ascending ? 1 : -1));
        }
        if (this.limite) linhas = linhas.slice(0, this.limite);
      }
      if (this.unico === 'um') return linhas.length === 1 ? { data: linhas[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      if (this.unico === 'talvez') return { data: linhas[0] || null, error: null };
      return { data: linhas, error: null };
    }
  }

  async function rpc(nome, args) {
    await espera(100);
    if (nome === 'exilados_nao_lidas') {
      const alvos = [
        ...db.exilados_salas.filter((x) => x.tipo === 'texto').map((x) => ({ alvo: x.id, sala: true })),
        ...db.exilados_conversas.map((x) => ({ alvo: x.id, sala: false })),
      ];
      return {
        data: alvos.map(({ alvo, sala }) => {
          const daqui = db.exilados_mensagens.filter((m) => m.sala_id === alvo || m.conversa_id === alvo);
          const lida = db.exilados_lidas.find((l) => l.user_id === EU && l.alvo === alvo)?.ultima ?? null;
          const novas = daqui.filter((m) => m.id > (lida || 0) && m.autor !== EU);
          return {
            alvo, ultima: daqui.length ? Math.max(...daqui.map((m) => m.id)) : null, lida,
            novas: Math.min(99, novas.length), mencoes: novas.filter((m) => (m.mencoes || []).includes(EU) || (sala && m.menciona_todos)).length,
          };
        }),
        error: null,
      };
    }
    if (nome === 'exilados_marcar_lida') {
      const linha = db.exilados_lidas.find((l) => l.user_id === EU && l.alvo === args.alvo);
      if (linha) linha.ultima = Math.max(linha.ultima, args.ate);
      else db.exilados_lidas.push({ user_id: EU, alvo: args.alvo, ultima: args.ate });
      return { data: null, error: null };
    }
    if (nome === 'exilados_info_convite') return { data: [{ valido: true, convidado_por: 'Dyego' }], error: null };
    if (nome === 'exilados_criar_convite') return { data: 'demo'.padEnd(64, '0'), error: null };
    if (nome === 'exilados_meu_id') {
      const meu = db.exilados_ids.find((i) => i.user_id === EU);
      if (args?.nome) meu.nome = args.nome;
      return { data: meu.codigo, error: null };
    }
    if (nome === 'exilados_adicionar_por_id') {
      const numero = String(args.codigo || '').replace(/\D/g, '');
      if (!/^[1-9]\d{8}$/.test(numero)) return { data: null, error: { message: 'O ID tem 9 dígitos.' } };
      const alvo = db.exilados_ids.find((i) => i.codigo === numero);
      if (!alvo) return { data: null, error: { message: 'Nenhuma conta com esse ID. Peça para a pessoa abrir o Exilados e conferir o número.' } };
      const atual = db.exilados_membros.find((m) => m.user_id === alvo.user_id);
      if (atual?.ativo) return { data: null, error: { message: `${atual.nome} já faz parte do grupo.` } };
      if (atual) {
        atual.ativo = true;
        emitir('exilados_membros', 'UPDATE', { ...atual });
        return { data: atual.nome, error: null };
      }
      const novo = { user_id: alvo.user_id, nome: alvo.nome || 'Novo membro', avatar: null, papel: 'membro', ativo: true, entrou_em: iso(Date.now()) };
      db.exilados_membros.push(novo);
      emitir('exilados_membros', 'INSERT', novo);
      return { data: novo.nome, error: null };
    }
    if (nome === 'exilados_entrar') {
      db.exilados_membros.push({ user_id: EU, nome: args.nome, avatar: null, papel: 'membro', ativo: true, entrou_em: iso(Date.now()) });
      return { data: null, error: null };
    }
    if (nome === 'exilados_abrir_conversa') {
      const [a, b] = [EU, args.outro].sort();
      let c = db.exilados_conversas.find((x) => x.a === a && x.b === b);
      if (!c) {
        c = { id: uuid(), a, b };
        db.exilados_conversas.push(c);
        db.exilados_mensagens.push({ ...NOVA, id: idMensagem++, sala_id: null, conversa_id: c.id, autor: args.outro, texto: 'e aí! (mensagem direta de demonstração)', imagem: null, criada_em: iso(Date.now() - 60000) });
      }
      return { data: c.id, error: null };
    }
    return { data: null, error: { message: `função ${nome} não existe na demonstração` } };
  }

  // ---------- tempo real ----------
  const presencaOutros = {
    [LUCAS]: [{ status: 'online', voz: V_GERAL, desde: 1, mudo: false, surdo: false }],
    [MARINA]: [{ status: 'online', voz: V_GERAL, desde: 2, mudo: true, surdo: false }],
    [BIA]: [{ status: 'ausente', voz: null }],
  };
  let minha = null;
  const canais = [];

  class Canal {
    constructor(nome) {
      this.nome = nome;
      this.ouvintes = [];
      canais.push(this);
    }
    on(tipo, filtro, fn) {
      if (tipo === 'postgres_changes') ouvintes.push({ ...filtro, fn });
      else this.ouvintes.push({ tipo, evento: filtro.event, fn });
      return this;
    }
    subscribe(cb) {
      setTimeout(() => cb?.('SUBSCRIBED'), 150);
      return this;
    }
    presenceState() {
      const estado = { ...presencaOutros };
      if (minha) estado[EU] = [minha];
      return estado;
    }
    async track(meta) {
      minha = meta;
      entreAbas?.postMessage({ id: EU, meta });
      this.disparar('presence', 'sync');
      return 'ok';
    }
    // Recado do canal (digitando, chamada): vai para as outras abas da demonstração.
    async send(mensagem) {
      if (mensagem?.type === 'broadcast') entreAbas?.postMessage({ recado: { event: mensagem.event, payload: mensagem.payload } });
      return 'ok';
    }
    disparar(tipo, evento, dados) {
      for (const o of this.ouvintes) if (o.tipo === tipo && o.evento === evento) setTimeout(() => o.fn(dados || {}), 10);
    }
    unsubscribe() { return Promise.resolve('ok'); }
  }

  function canalGrupo() {
    return canais.find((c) => c.nome === 'exilados');
  }

  // Presença dividida entre as abas da demonstração abertas neste navegador.
  const entreAbas = typeof BroadcastChannel === 'function' ? new BroadcastChannel('exilados-demo-presenca') : null;
  if (entreAbas) {
    entreAbas.onmessage = ({ data }) => {
      if (data?.recado) {
        canalGrupo()?.disparar('broadcast', data.recado.event, { payload: data.recado.payload });
        return;
      }
      if (data?.pedir) {
        if (minha) entreAbas.postMessage({ id: EU, meta: minha });
        return;
      }
      if (!data?.id || data.id === EU) return;
      if (data.meta) presencaOutros[data.id] = [data.meta];
      else delete presencaOutros[data.id];
      canalGrupo()?.disparar('presence', 'sync');
    };
    entreAbas.postMessage({ pedir: true });
    addEventListener('pagehide', () => entreAbas.postMessage({ id: EU, meta: null }));
  }

  // A pessoa fictícia: fala na sala de voz, manda mensagem de vez em quando, e a live mantém o sinal de vida.
  setInterval(() => {
    const falando = Math.random() < 0.5;
    canalGrupo()?.disparar('broadcast', 'falando', { payload: { id: LUCAS, falando } });
  }, 1500);
  setInterval(() => {
    const linha = { ...NOVA, id: idMensagem++, sala_id: S_GERAL, conversa_id: null, autor: LUCAS, texto: `mensagem automática ${new Date().toLocaleTimeString('pt-BR')}`, imagem: null, criada_em: iso(Date.now()) };
    db.exilados_mensagens.push(linha);
    emitir('exilados_mensagens', 'INSERT', linha);
  }, 45000);
  setInterval(() => {
    const live = db.exilados_lives.find((l) => l.user_id === MARINA);
    if (!live) return;
    live.ultimo_sinal = iso(Date.now());
    emitir('exilados_lives', 'UPDATE', { ...live });
  }, 10000);

  const sessao = () => ({ access_token: `demo-${EU}`, refresh_token: 'demo', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: EU, email: 'demo@exemplo.com', user_metadata: { full_name: MEU_NOME } } });
  let logado = !semLogin;
  const ouvintesAuth = [];

  window.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: logado ? sessao() : null }, error: null }; },
          async refreshSession() { return { data: { session: logado ? sessao() : null }, error: null }; },
          onAuthStateChange(fn) { ouvintesAuth.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
          async signInWithPassword({ password }) {
            await espera(300);
            if (password !== 'demo1234') return { data: null, error: { message: 'Invalid login credentials' } };
            logado = true;
            ouvintesAuth.forEach((fn) => fn('SIGNED_IN', sessao()));
            return { data: { session: sessao() }, error: null };
          },
          async signUp() { await espera(300); return { data: { session: null, user: {} }, error: null }; },
          async signInWithOAuth() { return { data: null, error: { message: 'Google não funciona na demonstração.' } }; },
          async resetPasswordForEmail() { return { data: {}, error: null }; },
          async updateUser() { return { data: {}, error: null }; },
          async signOut() { logado = false; ouvintesAuth.forEach((fn) => fn('SIGNED_OUT', null)); return { error: null }; },
        },
        from: (tabela) => new Consulta(tabela),
        rpc,
        storage: {
          from() {
            return {
              async upload(caminho, blob) { await espera(200); imagens.set(caminho, URL.createObjectURL(blob)); return { data: { path: caminho }, error: null }; },
              async createSignedUrl(caminho) { return { data: { signedUrl: imagens.get(caminho) || null }, error: imagens.has(caminho) ? null : { message: 'não achei' } }; },
              async createSignedUrls(caminhos) { return { data: caminhos.map((p) => ({ path: p, signedUrl: imagens.get(p) || null })), error: null }; },
              async remove(caminhos) { for (const c of caminhos) imagens.delete(c); return { data: [], error: null }; },
            };
          },
        },
        channel: (nome) => new Canal(nome),
        removeChannel: async () => 'ok',
        realtime: { setAuth: async () => {} },
      };
    },
  };
  window.EXILADOS_DEMO = { db, EU, emitir };
}());
