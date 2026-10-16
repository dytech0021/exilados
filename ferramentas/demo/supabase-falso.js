// Supabase de mentira para ver e testar o site sem contas de verdade (modo de demonstração local).
// Imita só o que o site usa: login, consultas simples, funções, imagens, mudanças em tempo real e presença.
// Uma pessoa fictícia fala de vez em quando, manda mensagens e fica "ao vivo".
(function () {
  const EU = '00000000-0000-4000-8000-000000000001';
  const LUCAS = '00000000-0000-4000-8000-000000000002';
  const MARINA = '00000000-0000-4000-8000-000000000003';
  const BIA = '00000000-0000-4000-8000-000000000004';
  const RAFA = '00000000-0000-4000-8000-000000000005';
  const S_GERAL = '10000000-0000-4000-8000-000000000001';
  const S_PRINTS = '10000000-0000-4000-8000-000000000002';
  const V_GERAL = '10000000-0000-4000-8000-000000000003';
  const V_JOGANDO = '10000000-0000-4000-8000-000000000004';
  const parametros = new URLSearchParams(location.search);
  const semLogin = parametros.has('sair');
  const comoMembro = !parametros.has('convite-demo');
  const agora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const uuid = () => crypto.randomUUID();

  let idMensagem = 1000;
  const db = {
    exilados_membros: [
      { user_id: EU, nome: 'Dyego', avatar: null, papel: 'dono', ativo: true, entrou_em: iso(agora - 30 * 864e5) },
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
    exilados_amizades: [
      { id: uuid(), de: EU, para: LUCAS, estado: 'aceita', criada_em: iso(agora - 864e5) },
      { id: uuid(), de: BIA, para: EU, estado: 'pendente', criada_em: iso(agora - 3600e3) },
    ],
    exilados_conversas: [],
  };
  const falas = [
    [LUCAS, 'alguém pra jogar hoje?'], [EU, 'bora, daqui a pouco entro na Geral'], [MARINA, 'tô ao vivo, colem lá'],
    [LUCAS, 'link útil: https://filabox3d.com.br/exilados/ (é aqui mesmo kkk)'], [BIA, 'chegando!'],
  ];
  for (let i = 0; i < 120; i += 1) {
    const [autor, texto] = falas[i % falas.length];
    db.exilados_mensagens.push({
      id: idMensagem++, sala_id: S_GERAL, conversa_id: null, autor, texto: i < 115 ? `${texto} (${i + 1})` : texto, imagem: null,
      criada_em: iso(agora - (120 - i) * 9 * 60000),
    });
  }

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
          if (this.tabela === 'exilados_mensagens') Object.assign(linha, { id: idMensagem++, criada_em: iso(Date.now()), sala_id: v.sala_id || null, conversa_id: v.conversa_id || null });
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
            Object.assign(r, this.valores);
            emitir(this.tabela, 'UPDATE', { ...r });
          }
        } else if (this.acao === 'delete') {
          for (const r of linhas) {
            tabela.splice(tabela.indexOf(r), 1);
            emitir(this.tabela, 'DELETE', null, { id: r.id, user_id: r.user_id });
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
    if (nome === 'exilados_info_convite') return { data: [{ valido: true, convidado_por: 'Dyego' }], error: null };
    if (nome === 'exilados_criar_convite') return { data: 'demo'.padEnd(64, '0'), error: null };
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
        db.exilados_mensagens.push({ id: idMensagem++, sala_id: null, conversa_id: c.id, autor: args.outro, texto: 'e aí! (mensagem direta de demonstração)', imagem: null, criada_em: iso(Date.now() - 60000) });
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
      this.disparar('presence', 'sync');
      return 'ok';
    }
    async send() { return 'ok'; }
    disparar(tipo, evento, dados) {
      for (const o of this.ouvintes) if (o.tipo === tipo && o.evento === evento) setTimeout(() => o.fn(dados || {}), 10);
    }
    unsubscribe() { return Promise.resolve('ok'); }
  }

  function canalGrupo() {
    return canais.find((c) => c.nome === 'exilados');
  }

  // A pessoa fictícia: fala na sala de voz, manda mensagem de vez em quando, e a live mantém o sinal de vida.
  setInterval(() => {
    const falando = Math.random() < 0.5;
    canalGrupo()?.disparar('broadcast', 'falando', { payload: { id: LUCAS, falando } });
  }, 1500);
  setInterval(() => {
    const linha = { id: idMensagem++, sala_id: S_GERAL, conversa_id: null, autor: LUCAS, texto: `mensagem automática ${new Date().toLocaleTimeString('pt-BR')}`, imagem: null, criada_em: iso(Date.now()) };
    db.exilados_mensagens.push(linha);
    emitir('exilados_mensagens', 'INSERT', linha);
  }, 45000);
  setInterval(() => {
    const live = db.exilados_lives.find((l) => l.user_id === MARINA);
    if (!live) return;
    live.ultimo_sinal = iso(Date.now());
    emitir('exilados_lives', 'UPDATE', { ...live });
  }, 10000);

  const sessao = () => ({ access_token: 'demo', refresh_token: 'demo', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: EU, email: 'demo@exemplo.com', user_metadata: { full_name: 'Dyego' } } });
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
