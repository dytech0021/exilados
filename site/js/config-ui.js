// Configurações em tela cheia (como no Discord): Minha conta, Voz e áudio, e para o dono Salas e Membros.
// Também o convite.
import { BASE, PASTA_IMAGENS } from './config.js';
import { avisar, estado, eu, meuId, ouvir, souDono } from './estado.js';
import { formatarId, lerId, limparNome, ordenarPorNome } from './formato.js';
import { conferirArquivo, LADO_PERFIL, reduzirImagem } from './imagens.js';
import { abrirTransmitir, noPrograma, versaoDoPrograma } from './programa.js';
import { COMMIT_SITE, VERSAO_SITE } from './versao.js';
import { versaoDoApp } from './android.js';
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
  faixa.style.backgroundColor = 'var(--lavanda)';
  const campoId = el('span', { text: '...' });
  sb.rpc('exilados_meu_id').then(({ data }) => {
    if (data) {
      campoId.textContent = formatarId(data);
      campoId.dataset.codigo = data;
    }
  });
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
        el('div', { class: 'linha' }, el('div', {}, el('small', { text: 'E-mail' }), el('span', { text: estado.eu.email || '' }))),
        el('div', { class: 'linha' }, el('div', {}, el('small', { text: 'Seu ID no Exilados' }), campoId),
          el('button', { class: 'botao pequeno cinza', text: 'Copiar', onclick: () => copiar(campoId.dataset.codigo || '') })))),
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
  const entrada = el('select', { class: 'entrada', attrs: { 'aria-label': voz.ANDROID ? 'Microfone e som' : 'Dispositivo de entrada' } });
  const saida = el('select', { class: 'entrada', attrs: { 'aria-label': 'Dispositivo de saída' } });
  const volume = el('input', { type: 'range', class: 'faixa-config', min: 0, max: 200, value: p.volumeEntrada, attrs: { 'aria-label': 'Volume de entrada' } });
  const valorVolume = el('span', { text: `${p.volumeEntrada}%` });
  const cancelamentoRuido = el('input', { type: 'checkbox', checked: p.cancelamentoRuido, attrs: { 'aria-label': 'Cancelamento de ruído do microfone' } });
  const ruidoForte = el('input', { type: 'checkbox', checked: p.ruidoForte, attrs: { 'aria-label': 'Filtragem forte do microfone' } });
  ruidoForte.disabled = !p.cancelamentoRuido;
  const portaDeVoz = el('input', { type: 'checkbox', checked: p.portaDeVoz, attrs: { 'aria-label': 'Porta de voz' } });
  portaDeVoz.disabled = p.cancelamentoRuido;
  portaDeVoz.addEventListener('change', async () => {
    portaDeVoz.disabled = true;
    try { await voz.definirPortaDeVoz(portaDeVoz.checked); }
    catch (falha) { portaDeVoz.checked = !portaDeVoz.checked; erro(falha); }
    finally { portaDeVoz.disabled = cancelamentoRuido.checked; }
  });
  const somDoComputador = el('input', { type: 'checkbox', checked: p.somDoComputador, attrs: { 'aria-label': 'Tirar do microfone o som do computador' } });
  somDoComputador.addEventListener('change', async () => {
    somDoComputador.disabled = true;
    try { await voz.definirSomDoComputador(somDoComputador.checked); }
    catch (falha) { somDoComputador.checked = !somDoComputador.checked; erro(falha); }
    finally { somDoComputador.disabled = false; }
  });
  const anunciarEntradas = el('input', { type: 'checkbox', checked: p.anunciarEntradas, attrs: { 'aria-label': 'Ler em voz alta quem entra e sai da sala e quem abre live' } });
  anunciarEntradas.addEventListener('change', () => voz.definirAnunciarEntradas(anunciarEntradas.checked));
  const volumeSaida = el('input', {
    type: 'range', class: 'faixa-config', min: 0, max: voz.VOLUME_MAXIMO, value: Math.min(p.volumeSaida, voz.VOLUME_MAXIMO),
    attrs: { 'aria-label': 'Volume de saída' },
  });
  const valorSaida = el('span', { text: `${Math.min(p.volumeSaida, voz.VOLUME_MAXIMO)}%` });
  volumeSaida.addEventListener('input', () => {
    valorSaida.textContent = `${volumeSaida.value}%`;
    voz.definirVolumeSaida(Number(volumeSaida.value));
  });
  const barra = el('div');
  const medidor = el('div', { class: 'medidor' }, barra);
  const botaoTeste = el('button', { class: 'botao' }, 'Testar microfone');
  const avisoTexto = el('p', { class: 'ajuda' });
  let parar = null;

  const preencher = async () => {
    const { entradas, saidas, semNomes } = await voz.listarDispositivos();
    const opcao = (d, i, tipo) => el('option', { value: d.deviceId, text: tipo === 'Microfone' ? voz.nomeDoAparelho(d, i) : (d.label || `${tipo} ${i + 1}`) });
    limpar(entrada, el('option', { value: '', text: voz.ANDROID ? 'Automático (fone, se houver)' : 'Padrão do sistema' }),
      entradas.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => opcao(d, i, 'Microfone')));
    entrada.value = entradas.some((d) => d.deviceId === p.entrada) ? p.entrada : '';
    if (voz.saidaDisponivel()) {
      limpar(saida, el('option', { value: '', text: 'Padrão do sistema' }), saidas.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => opcao(d, i, 'Saída')));
      saida.value = saidas.some((d) => d.deviceId === p.saida) ? p.saida : '';
    } else {
      limpar(saida, el('option', { text: voz.ANDROID ? 'A mesma do microfone escolhido' : 'Segue a saída do sistema' }));
      saida.disabled = true;
    }
    const temFone = entradas.some((d) => /bluetooth/i.test(d.label || ''));
    limpar(avisoTexto,
      semNomes ? ['Os nomes dos aparelhos aparecem depois de liberar o microfone. ', el('a', { href: '#', text: 'Liberar agora', onclick: async (e) => { e.preventDefault(); try { await voz.liberarNomes(); preencher(); } catch { erro(new Error('O microfone foi bloqueado. Libere no cadeado ao lado do endereço.')); } } })] : null,
      voz.ANDROID
        ? ['No Android, a escolha vale para o microfone e o som juntos: "Fone Bluetooth" usa o microfone e o som do fone; "Alto-falante do celular" usa os do celular.',
          temFone ? null : ' Não aparece o fone Bluetooth? Nas configurações do Android, em Apps → Chrome → Permissões, libere "Dispositivos por perto" e entre de novo na sala.']
        : voz.saidaDisponivel() ? null : 'Este navegador não deixa escolher a saída de som (Safari e iPhone): ela segue a do sistema.');
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
  cancelamentoRuido.addEventListener('change', async () => {
    cancelamentoRuido.disabled = true;
    try { await voz.definirCancelamentoRuido(cancelamentoRuido.checked); }
    catch (falha) { cancelamentoRuido.checked = !cancelamentoRuido.checked; erro(falha); }
    finally { cancelamentoRuido.disabled = false; ruidoForte.disabled = !cancelamentoRuido.checked; portaDeVoz.disabled = cancelamentoRuido.checked; }
  });
  ruidoForte.addEventListener('change', async () => {
    ruidoForte.disabled = true;
    try { await voz.definirRuidoForte(ruidoForte.checked); }
    catch (falha) { ruidoForte.checked = !ruidoForte.checked; erro(falha); }
    finally { ruidoForte.disabled = !cancelamentoRuido.checked; }
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
      el('label', { class: 'campo' }, el('span', { text: voz.ANDROID ? 'Microfone e som (fone ou celular)' : 'Dispositivo de entrada' }), entrada),
      el('label', { class: 'campo' }, el('span', { text: 'Dispositivo de saída' }), saida)),
    avisoTexto,
    el('label', { class: 'campo' }, el('span', {}, 'Volume de entrada ', valorVolume), volume),
    el('label', { class: 'campo' }, el('span', {}, 'Volume de saída (todos da sala) ', valorSaida), volumeSaida),
    voz.ANDROID ? el('p', { class: 'ajuda', text: 'No celular, a voz usa o volume de chamada, que é separado do volume de música e vídeos: aumente pelos botões de volume do celular durante a conversa.' }) : null,
    el('label', { class: 'opcao-voz' }, anunciarEntradas, el('span', { text: 'Ler em voz alta quem entra e sai da sala e quem abre live' })),
    el('h3', { text: 'Teste do microfone' }),
    el('p', { class: 'ajuda', text: 'Fale algo: a barra mostra o que o microfone capta (com o volume de entrada acima).' }),
    botaoTeste, medidor,
    el('h3', { text: 'Processamento' }),
    voz.ANDROID ? null : el('label', { class: 'opcao-voz' }, somDoComputador, el('span', { text: 'Tirar do microfone o som do computador (jogo, vídeo, live)' })),
    voz.ANDROID ? null : el('p', { class: 'ajuda', text: 'Como no Discord: tudo o que sai do computador serve de referência para apagar o que vaza do fone para o microfone. Se sua voz falhar enquanto toca algum som, desligue.' }),
    voz.ANDROID ? null : el('label', { class: 'opcao-voz' }, portaDeVoz, el('span', { text: 'Só mandar som quando eu estiver falando (porta de voz)' })),
    voz.ANDROID ? null : el('p', { class: 'ajuda', text: 'Entre as falas, o microfone fica fechado: o som do jogo ou do vídeo que vaza do fone para o microfone não vai para a sala. A voz passa como é, sem filtro.' }),
    el('label', { class: 'opcao-voz' }, cancelamentoRuido, el('span', { text: 'Cancelamento de ruído do microfone' })),
    el('label', { class: 'opcao-voz' }, ruidoForte, el('span', { text: 'Filtragem forte para sons distantes' })),
    el('p', { class: 'ajuda', text: 'O cancelamento de ruído vem desligado: ele tira barulhos fortes de fundo, mas deixa a voz robótica e abafada. Ligue só se houver muito barulho onde você está. A filtragem forte reduz o som de fundo entre as falas; se sua voz ficar cortada, desligue a filtragem forte. A redução de ruído e o cancelamento de eco do navegador continuam ativos. O volume de cada pessoa se ajusta com o botão direito no nome dela (ou segurando, no celular).' }));
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
      el('button', { class: 'botao', text: 'Criar link de convite', onclick: convidar }),
      el('h3', { text: 'Adicionar pelo ID' }),
      el('p', { class: 'ajuda', text: 'Digite o ID (9 dígitos) que a pessoa vê ao abrir o Exilados.' }),
      formAdicionarPorId(),
      el('h3', { text: `Membros — ${ativos.length}` }), el('div', { class: 'lista-config' }, ativos.map(item)),
      removidos.length ? [el('h3', { text: `Removidos — ${removidos.length}` }), el('div', { class: 'lista-config' }, removidos.map(item))] : null);
  };
  desenhar();
  return ouvir('membros', desenhar);
}

// ---------- Transmitir (programa do Windows) ----------

async function paginaTransmitir(secao) {
  if (noPrograma) {
    limpar(secao,
      el('h2', { text: 'Transmitir' }),
      el('p', { class: 'ajuda', text: 'As lives saem deste programa: ele transmite uma tela (com o som do computador) ou um programa (só o som dele, no Windows 11), e o grupo assiste aqui, com menos de 1 segundo de atraso. Quem está ao vivo aparece com a etiqueta AO VIVO.' }),
      el('button', { class: 'botao', text: 'Abrir a janela de transmitir', onclick: abrirTransmitir }),
      el('p', { class: 'ajuda', text: `Versão do programa: ${versaoDoPrograma}.` }),
      el('h3', { text: 'Como usar' }),
      el('p', { class: 'ajuda', text: 'Escolha a tela ou o programa e a qualidade, e clique em Entrar ao vivo. Fechar esta janela não fecha o programa: ele fica perto do relógio (a voz continua).' }),
      el('h3', { text: 'Atualizações' }),
      el('p', { class: 'ajuda', text: 'Quando sai uma versão nova, o programa baixa sozinho e aparece uma setinha verde no canto esquerdo: clique nela para reiniciar na versão nova. Se você não clicar, ela entra sozinha quando você fechar e abrir o programa de novo (nunca no meio de uma live ou de uma conversa de voz).' }));
    return;
  }
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
  const app = versaoDoApp(navigator.userAgent);
  const nav = el('nav', {},
    // As versões no topo (ajudam a saber se a atualização já chegou).
    el('div', { class: 'versoes' },
      app ? el('small', { text: `App ${app} para Android` }) : null,
      noPrograma ? el('small', { text: `Programa ${versaoDoPrograma} para Windows` }) : null,
      el('small', { text: `Site ${VERSAO_SITE}${COMMIT_SITE ? ` (${COMMIT_SITE})` : ''}` })),
    el('div', { class: 'separador' }),
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

/** Formulário "Adicionar pelo ID": a pessoa entra no grupo na hora. */
function formAdicionarPorId() {
  const campoId = el('input', {
    class: 'entrada', placeholder: '123 456 789', maxLength: 13,
    attrs: { inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'ID da pessoa' },
  });
  const resposta = el('p', { class: 'erro-texto', attrs: { role: 'status' } });
  const form = el('form', {
    class: 'linha-form',
    onsubmit: async (e) => {
      e.preventDefault();
      resposta.textContent = '';
      resposta.style.color = '';
      const numero = lerId(campoId.value);
      if (!numero) {
        resposta.textContent = 'O ID tem 9 dígitos (a pessoa vê o dela ao abrir o Exilados).';
        return;
      }
      const botao = form.querySelector('button');
      botao.disabled = true;
      try {
        const nome = conferir(await sb.rpc('exilados_adicionar_por_id', { codigo: numero }));
        campoId.value = '';
        resposta.style.color = 'var(--verde)';
        resposta.textContent = `${nome} entrou no grupo.`;
        aviso(`${nome} entrou no grupo.`);
      } catch (falha) {
        resposta.textContent = falha.message;
      } finally {
        botao.disabled = false;
      }
    },
  }, campoId, el('button', { class: 'botao', type: 'submit', text: 'Adicionar' }));
  return el('div', {}, form, resposta);
}

/** Convidar: criar o link de convite ou adicionar alguém digitando o ID da conta dela. */
export function convidar() {
  const areaLink = el('div');
  const criar = el('button', {
    class: 'botao', type: 'button', text: 'Criar link de convite',
    onclick: async () => {
      criar.disabled = true;
      try {
        const codigo = conferir(await sb.rpc('exilados_criar_convite'));
        const link = `${location.origin}${BASE}#convite=${codigo}`;
        const campo = el('input', { value: link, readOnly: true, attrs: { 'aria-label': 'Link do convite' } });
        limpar(areaLink,
          el('div', { class: 'copiar' }, campo, el('button', { class: 'botao pequeno', text: 'Copiar', onclick: () => copiar(link) })),
          navigator.share ? el('p', { class: 'ajuda' }, el('a', {
            href: '#', text: 'Compartilhar...',
            onclick: (e) => { e.preventDefault(); navigator.share({ title: 'Exilados', text: 'Entra no Exilados:', url: link }).catch(() => {}); },
          })) : null);
        criar.textContent = 'Criar outro link';
        campo.select();
        // Já deixa copiado quando o navegador permite; se não, o link fica selecionado no campo.
        navigator.clipboard?.writeText(link).then(() => aviso('Link copiado.')).catch(() => {});
      } catch (falha) {
        erro(falha);
      } finally {
        criar.disabled = false;
      }
    },
  });
  janela({
    titulo: 'Convidar para o Exilados',
    conteudo: el('div', {},
      el('section', { class: 'secao-convite' },
        el('h3', { text: 'Link de convite' }),
        el('p', { text: 'Crie um link e mande para quem você quer chamar. Ele vale por 7 dias e serve para várias pessoas.' }),
        criar, areaLink),
      el('section', { class: 'secao-convite' },
        el('h3', { text: 'Adicionar pelo ID' }),
        el('p', { text: 'Quem já tem conta vê o próprio ID (9 dígitos) ao abrir o Exilados. Digite aqui e a pessoa entra no grupo na hora.' }),
        formAdicionarPorId())),
    botoes: [{ rotulo: 'Pronto' }],
  });
}

ouvir('membros', () => {
  if (aberta && !eu()?.ativo) aberta.raiz.remove();
});
