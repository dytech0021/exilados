// Entrar: login (e-mail e senha ou Google, contas do FilaBox), convite, nova senha e avisos de acesso.
import { BASE } from './config.js';
import { limparNome } from './formato.js';
import { conferir, sb, traduzirErro } from './supa.js';
import { el, limpar } from './ui.js';

const CHAVE_CONVITE = 'exilados-convite';
const RETORNO = () => `${location.origin}${BASE}`;

/** Guarda o código de um link #convite=... (sobrevive à ida e volta do login) e limpa o endereço. */
export function lerConviteDaUrl() {
  const achado = location.hash.match(/convite=([A-Za-z0-9]{32,128})/);
  if (achado) {
    try { localStorage.setItem(CHAVE_CONVITE, achado[1]); } catch { /* sem armazenamento: segue só nesta visita */ }
    history.replaceState(null, '', location.pathname + location.search);
    return achado[1];
  }
  try { return localStorage.getItem(CHAVE_CONVITE); } catch { return null; }
}

export function esquecerConvite() {
  try { localStorage.removeItem(CHAVE_CONVITE); } catch { /* nada */ }
}

export async function infoConvite(codigo) {
  if (!codigo) return null;
  try {
    const linhas = conferir(await sb.rpc('exilados_info_convite', { codigo }));
    return { codigo, ...(linhas?.[0] || { valido: false }) };
  } catch {
    return { codigo, valido: false };
  }
}

export async function sair() {
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  location.replace(BASE);
}

function mostrar(...conteudo) {
  document.getElementById('carregando').hidden = true;
  document.getElementById('app').hidden = true;
  const tela = document.getElementById('entrada');
  limpar(tela, el('div', { class: 'cartao' }, conteudo));
  tela.hidden = false;
  tela.querySelector('input')?.focus();
}

function topoConvite(info) {
  return el('div', { class: 'convite-topo' },
    el('div', { class: 'logo-ex', text: 'EX' }),
    el('p', { class: 'subtitulo', text: `${info.convidado_por || 'Alguém do grupo'} convidou você para entrar em` }),
    el('h1', { text: 'Exilados' }));
}

function campo(rotulo, entrada, ajuda) {
  return el('label', { class: 'campo' }, el('span', { text: rotulo }), entrada, ajuda || null);
}

function formulario(aoEnviar, ...filhos) {
  const erroTexto = el('p', { class: 'erro-texto', attrs: { role: 'alert' } });
  const form = el('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      erroTexto.textContent = '';
      const botoes = form.querySelectorAll('button');
      botoes.forEach((b) => { b.disabled = true; });
      try {
        await aoEnviar(form);
      } catch (falha) {
        erroTexto.textContent = traduzirErro(falha).message;
      } finally {
        botoes.forEach((b) => { b.disabled = false; });
      }
    },
  }, ...filhos, erroTexto);
  return form;
}

/** Tela de login e cadastro. `convite` (opcional) é o resultado de infoConvite. */
export function telaLogin(convite, modo = 'entrar') {
  const email = el('input', { class: 'entrada', type: 'email', autocomplete: 'email', required: true, attrs: { inputmode: 'email' } });
  const senha = el('input', { class: 'entrada', type: 'password', autocomplete: modo === 'entrar' ? 'current-password' : 'new-password', required: true });
  const google = el('button', {
    type: 'button', class: 'botao cheio botao-google',
    onclick: async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: RETORNO() } });
      if (error) erroGoogle.textContent = traduzirErro(error).message;
    },
  }, el('strong', { text: 'G' }), 'Entrar com Google');
  const erroGoogle = el('p', { class: 'erro-texto' });
  const titulo = convite?.valido ? topoConvite(convite) : null;

  if (modo === 'criar') {
    const confirmar = el('input', { class: 'entrada', type: 'password', autocomplete: 'new-password', required: true });
    return mostrar(
      titulo || el('h1', { text: 'Criar uma conta' }),
      titulo ? null : el('p', { class: 'subtitulo', text: 'A conta é a mesma do FilaBox.' }),
      formulario(async () => {
        if (!email.value.includes('@')) throw new Error('Esse e-mail não parece válido.');
        if (senha.value.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
        if (senha.value !== confirmar.value) throw new Error('As duas senhas não são iguais.');
        const dados = conferir(await sb.auth.signUp({ email: email.value.trim(), password: senha.value, options: { emailRedirectTo: RETORNO() } }));
        if (!dados.session) {
          mostrar(
            el('h1', { text: 'Confira seu e-mail' }),
            el('p', { class: 'subtitulo', text: `Enviamos um link de confirmação para ${email.value.trim()}. Abra o link neste aparelho e você volta para cá já conectado.` }),
            el('button', { class: 'botao cheio cinza', text: 'Voltar para o login', onclick: () => telaLogin(convite) }));
        }
      },
      campo('E-mail', email), campo('Senha', senha), campo('Confirmar senha', confirmar),
      el('button', { class: 'botao cheio', type: 'submit', text: 'Criar conta' })),
      el('div', { class: 'linha-ou', text: 'ou' }), google, erroGoogle,
      el('p', { class: 'rodape' }, el('a', { href: '#', text: 'Já tem uma conta? Entrar', onclick: (e) => { e.preventDefault(); telaLogin(convite); } })));
  }

  const esqueci = el('a', {
    href: '#', text: 'Esqueceu sua senha?',
    onclick: async (e) => {
      e.preventDefault();
      if (!email.value.includes('@')) {
        email.focus();
        erroGoogle.textContent = 'Escreva seu e-mail acima e clique de novo em "Esqueceu sua senha?".';
        return;
      }
      const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: RETORNO() });
      erroGoogle.textContent = error ? traduzirErro(error).message : `Enviamos um link para criar uma senha nova para ${email.value.trim()}.`;
    },
  });
  return mostrar(
    titulo || el('h1', { text: 'Boas-vindas de volta!' }),
    titulo ? null : el('p', { class: 'subtitulo', text: 'Entre com a sua conta do FilaBox para abrir o Exilados.' }),
    formulario(async () => {
      conferir(await sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value }));
    },
    campo('E-mail', email), campo('Senha', senha, el('p', { class: 'ajuda' }, esqueci)),
    el('button', { class: 'botao cheio', type: 'submit', text: 'Entrar' })),
    el('div', { class: 'linha-ou', text: 'ou' }), google, erroGoogle,
    el('p', { class: 'rodape' }, 'Precisa de uma conta? ', el('a', { href: '#', text: 'Registre-se', onclick: (e) => { e.preventDefault(); telaLogin(convite, 'criar'); } })));
}

export function telaNovaSenha() {
  const senha = el('input', { class: 'entrada', type: 'password', autocomplete: 'new-password' });
  mostrar(
    el('h1', { text: 'Criar senha nova' }),
    formulario(async () => {
      if (senha.value.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
      conferir(await sb.auth.updateUser({ password: senha.value }));
      location.replace(BASE);
    }, campo('Senha nova', senha), el('button', { class: 'botao cheio', type: 'submit', text: 'Salvar e entrar' })));
}

/** Logado, mas ainda não é membro: escolhe o nome e entra pelo convite. */
export function telaConvite(info, usuario, aoEntrar) {
  const sugestao = limparNome(usuario?.user_metadata?.full_name || usuario?.user_metadata?.name || (usuario?.email || '').split('@')[0]) || '';
  const nome = el('input', { class: 'entrada', value: sugestao, maxLength: 32, autocomplete: 'nickname' });
  mostrar(
    topoConvite(info),
    formulario(async () => {
      const limpo = limparNome(nome.value);
      if (!limpo) throw new Error('O nome precisa ter de 1 a 32 caracteres.');
      conferir(await sb.rpc('exilados_entrar', { codigo: info.codigo, nome: limpo }));
      esquecerConvite();
      await aoEntrar();
    },
    campo('Como você quer aparecer no grupo', nome, el('p', { class: 'ajuda', text: 'Dá para mudar depois nas configurações.' })),
    el('button', { class: 'botao cheio', type: 'submit', text: 'Entrar no Exilados' })),
    el('p', { class: 'rodape' }, `Conectado como ${usuario?.email || ''}. `, el('a', { href: '#', text: 'Usar outra conta', onclick: (e) => { e.preventDefault(); sair(); } })));
}

export function telaAviso(titulo, texto, usuario) {
  mostrar(
    el('div', { class: 'convite-topo' }, el('div', { class: 'logo-ex', text: 'EX' })),
    el('h1', { text: titulo }),
    el('p', { class: 'subtitulo', text: texto }),
    el('button', { class: 'botao cheio cinza', text: 'Sair da conta', onclick: sair }),
    usuario ? el('p', { class: 'rodape', text: `Conectado como ${usuario.email || ''}.` }) : null);
}
