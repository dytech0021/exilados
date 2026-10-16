// Site aberto dentro do programa Exilados para Windows (janela principal com WebView2). O programa avisa que está
// por perto com window.exiladosPrograma; o site pede a janela Transmitir e empresta o próprio login às lives (o
// programa não precisa de um segundo login) e diz se a pessoa está numa sala de voz (o programa não se atualiza no
// meio de uma conversa).
const ponte = typeof window !== 'undefined' ? window.chrome?.webview : undefined;

export const noPrograma = Boolean(ponte && window.exiladosPrograma);

/** Abre a janela Transmitir do programa. */
export function abrirTransmitir() {
  ponte?.postMessage({ tipo: 'transmitir' });
}

/**
 * Responde aos pedidos do programa. `sessao()` devolve { token, usuario, email, nome } ou null (sem login);
 * `ocupado()` diz se a pessoa está numa sala de voz ou assistindo a algo.
 */
export function iniciarPrograma({ sessao, ocupado }) {
  if (!noPrograma) return;
  ponte.addEventListener('message', async (evento) => {
    const pedido = evento.data;
    if (!pedido || typeof pedido !== 'object' || typeof pedido.id !== 'number') return;
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
}
