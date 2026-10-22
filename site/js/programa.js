// Site aberto dentro do programa Exilados para Windows (janela principal com WebView2). O programa avisa que está
// por perto com window.exiladosPrograma; o site pede a janela Transmitir e empresta o próprio login às lives (o
// programa não precisa de um segundo login), diz se a pessoa está numa sala de voz (o programa não se atualiza no
// meio de uma conversa) e mostra a setinha verde quando o programa já baixou uma versão nova.

/** A conversa com o programa por `ponte` (o window.chrome.webview do WebView2); sem ponte, nada acontece. */
export function criarPonte(ponte, info) {
  const noPrograma = Boolean(ponte && info);
  const acompanham = new Set();
  let atualizacao = null;

  return {
    noPrograma,
    /** Versão do programa ("1.0.4"), ou null fora dele. */
    versao: noPrograma ? info.versao : null,

    /** Abre a janela Transmitir do programa. */
    abrirTransmitir() {
      if (noPrograma) ponte.postMessage({ tipo: 'transmitir' });
    },

    /** Manda um aviso qualquer ao programa (notificação, parar o toque da chamada). */
    enviar(mensagem) {
      if (noPrograma) ponte.postMessage(mensagem);
    },

    /** Reinicia o programa na versão nova que ele já baixou. */
    atualizar() {
      if (noPrograma) ponte.postMessage({ tipo: 'atualizar' });
    },

    /** `fn(versao)` com a versão nova pronta para instalar, ou null quando não há; já recebe a de agora, se houver. */
    quandoAtualizacao(fn) {
      acompanham.add(fn);
      if (atualizacao) fn(atualizacao);
    },

    /**
     * Responde aos pedidos do programa. `sessao()` devolve { token, usuario, email, nome } ou null (sem login);
     * `ocupado()` diz se a pessoa está numa sala de voz ou assistindo a algo.
     */
    iniciar({ sessao, ocupado }) {
      if (!noPrograma) return;
      ponte.addEventListener('message', async (evento) => {
        const pedido = evento.data;
        if (!pedido || typeof pedido !== 'object') return;
        if (pedido.tipo === 'abrir') {
          // Clicou no aviso do programa: abre a conversa ou a sala dele.
          if (typeof pedido.alvo === 'string') window.exiladosAbrir?.(pedido.alvo);
          return;
        }
        if (pedido.tipo === 'atualizacao') {
          atualizacao = typeof pedido.versao === 'string' && pedido.versao ? pedido.versao : null;
          for (const fn of acompanham) fn(atualizacao);
          return;
        }
        if (typeof pedido.id !== 'number') return;
        const resposta = { tipo: 'resposta', id: pedido.id };
        try {
          if (pedido.tipo === 'sessao') Object.assign(resposta, (await sessao()) || {});
          else if (pedido.tipo === 'ocupado') resposta.ocupado = Boolean(ocupado());
        } catch {
          // Sem resposta útil: o programa trata como "sem login" ou "livre".
        }
        ponte.postMessage(resposta);
      });
      ponte.postMessage({ tipo: 'pronto' });
    },
  };
}

const programa = typeof window !== 'undefined' ? criarPonte(window.chrome?.webview, window.exiladosPrograma) : criarPonte();

export const { noPrograma } = programa;
export const versaoDoPrograma = programa.versao;
export const abrirTransmitir = () => programa.abrirTransmitir();
export const atualizarPrograma = () => programa.atualizar();
export const enviarAoPrograma = (mensagem) => programa.enviar(mensagem);
export const quandoAtualizacao = (fn) => programa.quandoAtualizacao(fn);
export const iniciarPrograma = (respostas) => programa.iniciar(respostas);
