// Configurações em tela cheia (como no Discord): Minha conta, Voz e áudio, e para o dono Salas e Membros.
// Também o convite.
import { BASE, PASTA_IMAGENS } from './config.js';
import { avisar, estado, eu, meuId, ouvir, souDono } from './estado.js';
import { limparNome, ordenarPorNome } from './formato.js';
import { conferirArquivo, LADO_PERFIL, reduzirImagem } from './imagens.js';
import { api, conferir, sb } from './supa.js';
import { sair } from './auth.js';
import {
  avatar, aviso, botaoIcone, confirmar, copiar, el, erro, icone, janela, limpar,
} from './ui.js';
import * as voz from './voz.js';

let aberta = null;

// ---------- Minha conta ----------

function paginaConta(secao) {
  const meu = eu();
  const seletor = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const nome = el('input', { class: 'entrada', value: meu.nome, maxLength: 32, attrs: { 'aria-label': 'Nome no grupo' } });
  const faixa = el('div', { class: 'faixa-cor' });
  faixa.style.backgroundColor = '#c0662b';
  seletor.addEventListener('change', async () => {
    const arquivo = seletor.files[0];
    seletor.value = '';
    if (!arquivo) return;
    const motivo = conferirArquivo(arquivo);
    if (motivo) return erro(new Error(motivo));
    try {
      const foto = await reduzirImagem(arquivo, { maximo: LADO_PERFIL, quadrado: true });
      const caminho = `${meuId()}/perfil-${crypto.randomUUID()}.${foto.extensao}`;
      conferir(await sb.storage.from(PASTA_IMAGENS).upload(caminho, foto.blob, { contentType: foto.tipo, upsert: false }));
      await salvarMembro({ avatar: caminho });
      aviso('Foto de perfil trocada.');
    } catch (falha) {
      erro(falha);
    }
  });
  limpar(secao,
    el('h2', { text: 'Minha conta' }),
    el('div', { class: 'cartao-conta' },
      faixa,
      el('div', { class: 'topo' }, avatar(meu, { tamanho: 80, status: 'online' }), el('strong', { text: meu.nome }),
        el('button', { class: 'botao pequeno', text: 'Trocar foto', onclick: () => seletor.click() }),
        meu.avatar ? el('button', { class: 'botao pequeno cinza', text: 'Tirar foto', onclick: () => salvarMembro({ avatar: null }).catch(erro) }) : null),
      el('div', { class: 'campos' },
        el('div', { class: 'linha' }, el('div', {}, el('small', { text: 'Nome no grupo' }), nome),
          el('button', {
            class: 'botao pequeno', text: 'Salvar',
            onclick: async () => {
              const limpo = limparNome(nome.value);
              if (!limpo) return erro(new Error('O nome precisa ter de 1 a 32 caracteres.'));
              try {
                await salvarMembro({ nome: limpo });
                aviso('Nome salvo.');
              } catch (falha) {
                erro(falha);
              }
            },
          })),
        el('div', { class: 'linha' }, el('div', {}, el('small', { text: 'E-mail' }), el('span', { text: estado.eu.email || '' }))))),
    seletor,
    el('h3', { text: 'Conta' }),
    el('p', { class: 'ajuda', text: 'A conta é a do FilaBox. Sair daqui desconecta só este navegador.' }),
    el('button', { class: 'botao vermelho', text: 'Sair da conta', onclick: sairDaConta }));
}

async function salvarMembro(campos) {
  const linha = conferir(await sb.from('exilados_membros').update(campos).eq('user_id', meuId())
    .select('user_id,nome,avatar,papel,ativo,entrou_em').single());
  estado.membros.set(linha.user_id, linha);
  avisar('membros');
  if (aberta?.pagina === 'conta') mostrarPagina('conta');
}

async function sairDaConta() {
  const ok = await confirmar({ titulo: 'Sair da conta', texto: 'Tem certeza de que quer sair do Exilados neste navegador?', botao: 'Sair', perigo: true });
  if (!ok) return;
  await voz.sair().catch(() => {});
  await sair();
}

// ---------- Voz e áudio ----------

async function paginaVoz(secao) {
  const p = voz.preferencias();
  const entrada = el('select', { class: 'entrada', attrs: { 'aria-label': 'Dispositivo de entrada' } });
  const saida = el('select', { class: 'entrada', attrs: { 'aria-label': 'Dispositivo de saída' } });
  const volume = el('input', { type: 'range', class: 'faixa-config', min: 0, max: 200, value: p.volumeEntrada, attrs: { 'aria-label': 'Volume de entrada' } });
  const valorVolume = el('span', { text: `${p.volumeEntrada}%` });
  const barra = el('div');
  const medidor = el('div', { class: 'medidor' }, barra);
  const botaoTeste = el('button', { class: 'botao' }, 'Testar microfone');
  const avisoTexto = el('p', { class: 'ajuda' });
  let parar = null;

  const preencher = async () => {
    const { entradas, saidas, semNomes } = await voz.listarDispositivos();
    const opcao = (d, i, tipo) => el('option', { value: d.deviceId, text: d.label || `${tipo} ${i + 1}` });
    limpar(entrada, el('option', { value: '', text: 'Padrão do sistema' }), entradas.filter((d) => d.deviceId !== 'default').map((d, i) => opcao(d, i, 'Microfone')));
    entrada.value = entradas.some((d) => d.deviceId === p.entrada) ? p.entrada : '';
    if (voz.saidaDisponivel()) {
      limpar(saida, el('option', { value: '', text: 'Padrão do sistema' }), saidas.filter((d) => d.deviceId !== 'default').map((d, i) => opcao(d, i, 'Saída')));
      saida.value = saidas.some((d) => d.deviceId === p.saida) ? p.saida : '';
    } else {
      limpar(saida, el('option', { text: 'Segue a saída do sistema' }));
      saida.disabled = true;
    }
    limpar(avisoTexto,
      semNomes ? ['Os nomes dos aparelhos aparecem depois de liberar o microfone. ', el('a', { href: '#', text: 'Liberar agora', onclick: async (e) => { e.preventDefault(); try { await voz.liberarNomes(); preencher(); } catch { erro(new Error('O microfone foi bloqueado. Libere no cadeado ao lado do endereço.')); } } })] : null,
      voz.saidaDisponivel() ? null : 'Este navegador não deixa escolher a saída de som (Safari e iPhone): ela segue a do sistema.');
  };

  entrada.addEventListener('change', async () => {
    try {
      await voz.definirEntrada(entrada.value);
      if (parar) { parar(); parar = await voz.testarMicrofone(mostrarNivel); }
    } catch (falha) {
      erro(falha);
    }
  });
  saida.addEventListener('change', () => voz.definirSaida(saida.value).catch(erro));
  volume.addEventListener('input', () => {
    valorVolume.textContent = `${volume.value}%`;
    voz.definirVolumeEntrada(Number(volume.value));
  });
  const mostrarNivel = (nivel) => { barra.style.width = `${Math.round(nivel * 100)}%`; };
  botaoTeste.addEventListener('click', async () => {
    if (parar) {
      parar();
      parar = null;
      mostrarNivel(0);
      botaoTeste.textContent = 'Testar microfone';
      return;
    }
    try {
      parar = await voz.testarMicrofone(mostrarNivel);
      botaoTeste.textContent = 'Parar teste';
    } catch {
      erro(new Error('Não deu para abrir o microfone. Confira se ele está liberado para este site.'));
    }
  });

  limpar(secao,
    el('h2', { text: 'Voz e áudio' }),
    el('div', { class: 'duas-colunas' },
      el('label', { class: 'campo' }, el('span', { text: 'Dispositivo de entrada' }), entrada),
      el('label', { class: 'campo' }, el('span', { text: 'Dispositivo de saída' }), saida)),
    avisoTexto,
    el('label', { class: 'campo' }, el('span', {}, 'Volume de entrada ', valorVolume), volume),
    el('h3', { text: 'Teste do microfone' }),
    el('p', { class: 'ajuda', text: 'Fale algo: a barra mostra o que o microfone capta (com o volume de entrada acima).' }),
    botaoTeste, medidor,
    el('h3', { text: 'Processamento' }),
    el('p', { class: 'ajuda', text: 'Redução de ruído, cancelamento de eco e ajuste automático de ganho do navegador ficam sempre ligados. O volume de cada pessoa se ajusta com o botão direito no nome dela (ou segurando, no celular).' }));
  await preencher();
  const pararOuvir = ouvir('dispositivos', preencher);
  return () => {
    parar?.();
    pararOuvir();
  };
}

// ---------- Salas (dono) ----------

async function salvarOrdem(lista) {
  const mudancas = lista.map((s, i) => ({ ...s, ordem: i * 10 })).filter((s, i) => lista[i].ordem !== s.ordem);
  for (const s of mudancas) conferir(await sb.from('exilados_salas').update({ ordem: s.ordem }).eq('id', s.id));
}

function paginaSalas(secao) {
  const desenhar = () => {
    const nome = el('input', { class: 'entrada', placeholder: 'nome-da-sala', maxLength: 40, dataset: { criar: '1' }, attrs: { 'aria-label': 'Nome da sala nova' } });
    const tipo = el('select', { class: 'entrada', attrs: { 'aria-label': 'Tipo da sala' } },
      el('option', { value: 'texto', text: 'Texto' }), el('option', { value: 'voz', text: 'Voz' }));
    const lista = (qual) => {
      const salas = estado.salas.filter((s) => s.tipo === qual);
      return el('div', { class: 'lista-config' }, salas.length ? salas.map((s, i) => {
        const campo = el('input', { class: 'entrada', value: s.nome, maxLength: 40, dataset: { renomear: s.id }, attrs: { 'aria-label': `Nome da sala ${s.nome}` } });
        const renomear = async () => {
          const novo = campo.value.replace(/\s+/g, ' ').trim();
          if (!novo || novo === s.nome) { campo.value = s.nome; return; }
          try { conferir(await sb.from('exilados_salas').update({ nome: novo }).eq('id', s.id)); } catch (falha) { erro(falha); campo.value = s.nome; }
        };
        campo.addEventListener('change', renomear);
        const mover = async (passo) => {
          const todas = [...estado.salas];
          const doTipo = todas.filter((x) => x.tipo === qual);
          const j = i + passo;
          if (j < 0 || j >= doTipo.length) return;
          [doTipo[i], doTipo[j]] = [doTipo[j], doTipo[i]];
          const outras = todas.filter((x) => x.tipo !== qual);
          const nova = qual === 'texto' ? [...doTipo, ...outras] : [...outras, ...doTipo];
          try { await salvarOrdem(nova); } catch (falha) { erro(falha); }
        };
        return el('div', { class: 'item' },
          icone(qual === 'texto' ? 'hash' : 'voz'), el('div', { class: 'nome' }, campo),
          botaoIcone('cima', 'Subir', () => mover(-1)), botaoIcone('baixo', 'Descer', () => mover(1)),
          botaoIcone('lixo', 'Apagar sala', async () => {
            const ok = await confirmar({
              titulo: `Apagar ${qual === 'texto' ? '#' : ''}${s.nome}`,
              texto: qual === 'texto' ? 'A sala e todas as mensagens dela somem para todos. Não dá para desfazer.' : 'A sala de voz some para todos.',
              botao: 'Apagar sala', perigo: true,
            });
            if (!ok) return;
            try { conferir(await sb.from('exilados_salas').delete().eq('id', s.id)); } catch (falha) { erro(falha); }
          }));
      }) : el('div', { class: 'item' }, el('span', { class: 'nome ajuda', text: 'Nenhuma sala.' })));
    };
    limpar(secao,
      el('h2', { text: 'Salas do grupo' }),
      el('h3', { text: 'Salas de texto' }), lista('texto'),
      el('h3', { text: 'Salas de voz' }), lista('voz'),
      el('h3', { text: 'Criar sala' }),
      el('form', {
        class: 'linha-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const limpo = nome.value.replace(/\s+/g, ' ').trim();
          if (!limpo) return nome.focus();
          const ultima = Math.max(0, ...estado.salas.map((s) => s.ordem));
          try {
            conferir(await sb.from('exilados_salas').insert({ nome: limpo, tipo: tipo.value, ordem: ultima + 10 }));
            nome.value = '';
          } catch (falha) {
            erro(falha);
          }
        },
      }, nome, tipo, el('button', { class: 'botao', type: 'submit', text: 'Criar' })));
  };
  desenhar();
  return ouvir('salas', () => {
    // Não atrapalha quem está renomeando uma sala; quem está criando continua com o campo de criar.
    const foco = secao.contains(document.activeElement) ? document.activeElement : null;
    if (foco?.dataset?.renomear) return;
    const tipoEscolhido = secao.querySelector('select')?.value;
    desenhar();
    if (tipoEscolhido) secao.querySelector('select').value = tipoEscolhido;
    if (foco?.dataset?.criar) secao.querySelector('input[data-criar]')?.focus();
  });
}

// ---------- Membros (dono) ----------

function paginaMembros(secao) {
  const desenhar = () => {
    const todos = ordenarPorNome([...estado.membros.values()]);
    const ativos = todos.filter((m) => m.ativo);
    const removidos = todos.filter((m) => !m.ativo);
    const mudar = async (m, ativo) => {
      if (!ativo) {
        const ok = await confirmar({ titulo: `Remover ${m.nome}`, texto: 'A pessoa perde o acesso ao grupo na hora (salas, mensagens, voz e lives).', botao: 'Remover', perigo: true });
        if (!ok) return;
      }
      try {
        await api.chamar('/membros/ativo', { usuario: m.user_id, ativo });
        aviso(ativo ? `${m.nome} foi readmitido.` : `${m.nome} foi removido do grupo.`);
      } catch (falha) {
        erro(falha);
      }
    };
    const item = (m) => el('div', { class: 'item' }, avatar(m, { tamanho: 32 }),
      el('div', { class: 'nome' }, m.nome, m.papel === 'dono' ? el('small', { text: 'dono' }) : null),
      m.papel === 'dono' ? null : el('button', {
        class: `botao pequeno ${m.ativo ? 'vermelho' : 'verde'}`, text: m.ativo ? 'Remover' : 'Readmitir', onclick: () => mudar(m, !m.ativo),
      }));
    limpar(secao,
      el('h2', { text: 'Membros do grupo' }),
      el('p', { class: 'ajuda', text: `${ativos.length} de no máximo 30 membros. Para chamar alguém, use Convidar pessoas.` }),
      el('button', { class: 'botao', text: 'Convidar pessoas', onclick: convidar }),
      el('h3', { text: `Membros — ${ativos.length}` }), el('div', { class: 'lista-config' }, ativos.map(item)),
      removidos.length ? [el('h3', { text: `Removidos — ${removidos.length}` }), el('div', { class: 'lista-config' }, removidos.map(item))] : null);
  };
  desenhar();
  return ouvir('membros', desenhar);
}

// ---------- Transmitir (programa do Windows) ----------

async function paginaTransmitir(secao) {
  const versao = el('span', { text: '' });
  limpar(secao,
    el('h2', { text: 'Transmitir' }),
    el('p', { class: 'ajuda', text: 'As lives saem do programa Exilados para Windows. Ele transmite uma tela (com o som do computador) ou um programa (só o som dele, no Windows 11), e o grupo assiste aqui, com menos de 1 segundo de atraso. Quem está ao vivo aparece com a etiqueta AO VIVO.' }),
    el('a', { class: 'botao', href: `${BASE}atualizacao/Exilados.exe`, attrs: { download: 'Exilados.exe' } }, 'Baixar o Exilados para Windows'),
    el('p', { class: 'ajuda' }, versao),
    el('h3', { text: 'Como usar' }),
    el('p', { class: 'ajuda', text: '1. Abra o Exilados.exe (pode deixar na pasta que quiser). 2. Entre com a mesma conta daqui. 3. Escolha a tela ou o programa e clique em Entrar ao vivo. Ele fica perto do relógio, abre junto com o Windows (dá para desligar no menu dele) e se atualiza sozinho.' }),
    el('h3', { text: 'Requisitos' }),
    el('p', { class: 'ajuda', text: 'Windows 10 ou 11 de 64 bits, uma placa de vídeo NVIDIA, AMD ou Intel recente e o .NET Desktop Runtime 10 (na primeira vez, o Windows mostra o link para instalar). Na primeira live o programa baixa o componente de vídeo (cerca de 40 MB).' }));
  try {
    const resposta = await fetch(`${BASE}atualizacao/manifest.json`, { cache: 'no-store' });
    if (resposta.ok) versao.textContent = `Versão ${(await resposta.json()).Version}.`;
  } catch {
    // Sem a versão, o botão continua valendo.
  }
}

// ---------- tela de configurações ----------

const PAGINAS = {
  conta: { rotulo: 'Minha conta', montar: paginaConta },
  voz: { rotulo: 'Voz e áudio', montar: paginaVoz },
  transmitir: { rotulo: 'Transmitir', montar: paginaTransmitir },
  salas: { rotulo: 'Salas', montar: paginaSalas, dono: true },
  membros: { rotulo: 'Membros', montar: paginaMembros, dono: true },
};

async function mostrarPagina(pagina) {
  if (!aberta) return;
  aberta.desfazer?.();
  aberta.pagina = pagina;
  for (const b of aberta.nav.querySelectorAll('button[data-pagina]')) b.classList.toggle('ativo', b.dataset.pagina === pagina);
  const secao = el('section');
  const voltar = el('button', { class: 'botao vazio voltar', onclick: () => aberta.raiz.classList.remove('mostrar-pagina') }, icone('voltar'), 'Configurações');
  secao.prepend(voltar);
  limpar(aberta.pagina_el, secao);
  aberta.raiz.classList.add('mostrar-pagina');
  try {
    aberta.desfazer = await PAGINAS[pagina].montar(secao);
  } catch (falha) {
    erro(falha);
  }
}

export function abrirConfig(pagina) {
  if (aberta) {
    if (pagina) mostrarPagina(pagina);
    return;
  }
  const nav = el('nav', {},
    el('h4', { text: 'Configurações de usuário' }),
    ['conta', 'voz', 'transmitir'].map((p) => el('button', { dataset: { pagina: p }, text: PAGINAS[p].rotulo, onclick: () => mostrarPagina(p) })),
    souDono() ? [el('div', { class: 'separador' }), el('h4', { text: 'Grupo Exilados' }),
      ['salas', 'membros'].map((p) => el('button', { dataset: { pagina: p }, text: PAGINAS[p].rotulo, onclick: () => mostrarPagina(p) }))] : null,
    el('div', { class: 'separador' }),
    el('button', { text: 'Convidar pessoas', onclick: convidar }),
    el('button', { class: 'perigo', text: 'Sair da conta', onclick: sairDaConta }));
  const paginaEl = el('div', { class: 'pagina' });
  const fechar = () => {
    aberta?.desfazer?.();
    aberta?.raiz.remove();
    document.removeEventListener('keydown', teclas);
    aberta = null;
  };
  const teclas = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.fundo-modal')) fechar();
  };
  const raiz = el('div', { class: 'configuracoes', attrs: { role: 'dialog', 'aria-label': 'Configurações' } },
    el('div', { class: 'nav' }, nav),
    paginaEl,
    el('button', { class: 'fechar', onclick: fechar, attrs: { 'aria-label': 'Fechar configurações' } },
      el('span', { class: 'circulo' }, icone('fechar')), el('small', { text: 'ESC' })));
  document.body.append(raiz);
  document.addEventListener('keydown', teclas);
  aberta = { raiz, nav, pagina_el: paginaEl, pagina: null, desfazer: null };
  // No celular, sem página pedida, abre na lista (como no Discord); no computador, em Minha conta.
  if (pagina || !window.matchMedia('(max-width: 760px)').matches) mostrarPagina(pagina || 'conta');
}

// ---------- convite ----------

export async function convidar() {
  let codigo;
  try {
    codigo = conferir(await sb.rpc('exilados_criar_convite'));
  } catch (falha) {
    return erro(falha);
  }
  const link = `${location.origin}${BASE}#convite=${codigo}`;
  const campo = el('input', { value: link, readOnly: true, attrs: { 'aria-label': 'Link do convite' } });
  janela({
    titulo: 'Convidar amigos para Exilados',
    conteudo: el('div', {},
      el('p', { text: 'Mande este link para quem você quer chamar. Ele vale por 7 dias e serve para várias pessoas.' }),
      el('div', { class: 'copiar' }, campo, el('button', { class: 'botao pequeno', text: 'Copiar', onclick: () => copiar(link) })),
      navigator.share ? el('p', { class: 'ajuda' }, el('a', {
        href: '#', text: 'Compartilhar...',
        onclick: (e) => { e.preventDefault(); navigator.share({ title: 'Exilados', text: 'Entra no Exilados:', url: link }).catch(() => {}); },
      })) : null),
    botoes: [{ rotulo: 'Pronto' }],
  });
  campo.select();
}

ouvir('membros', () => {
  if (aberta && !eu()?.ativo) aberta.raiz.remove();
});
