// Cliente do Supabase do FilaBox. O login do Exilados fica guardado à parte ("exilados-auth"), e sair da conta
// aqui só sai deste navegador (não desconecta o FilaBox nem outros aparelhos).
import { API, SUPABASE_CHAVE, SUPABASE_URL } from './config.js';
import { criarApi } from './api.js';
import { recarregar } from './atualizacao-site.js';
import { VERSAO_SITE } from './versao.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'exilados-auth',
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const api = criarApi({
  base: API,
  obterSessao: async () => (await sb.auth.getSession()).data.session,
  renovarSessao: async () => (await sb.auth.refreshSession()).data.session,
  versao: VERSAO_SITE,
  aoVersaoVelha: () => recarregar('servidor'),
});

/** Lança o erro do Supabase com uma mensagem em português quando der. */
export function conferir({ data, error }) {
  if (error) throw traduzirErro(error);
  return data;
}

export function traduzirErro(erro) {
  const texto = String(erro?.message || erro || '');
  const mapa = [
    [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/Email not confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
    [/User already registered/i, 'Já existe uma conta com esse e-mail. Entre com ela.'],
    [/Password should be at least (\d+)/i, (m) => `A senha precisa ter pelo menos ${m[1]} caracteres.`],
    [/rate limit|too many requests/i, 'Muitas tentativas seguidas. Espere um pouco e tente de novo.'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Sem conexão. Confira a internet e tente de novo.'],
    [/row-level security|permission denied/i, 'Você não tem permissão para isso (talvez não faça mais parte do grupo).'],
    [/JWT expired/i, 'Seu login venceu. Entre de novo.'],
    [/Unable to validate email address|invalid format/i, 'Esse e-mail não parece válido.'],
    [/Signups not allowed/i, 'O cadastro de contas novas está fechado no momento.'],
  ];
  for (const [padrao, traducao] of mapa) {
    const achado = texto.match(padrao);
    if (achado) return new Error(typeof traducao === 'function' ? traducao(achado) : traducao);
  }
  return new Error(texto || 'Algo deu errado. Tente de novo.');
}
