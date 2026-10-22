// Avisos fora do site: notificação do Android (app), aviso perto do relógio do Windows (programa) ou, no navegador,
// a notificação dele (só se a pessoa já liberou). Cada app decide se mostra: com o Exilados na frente, o aviso
// dentro do site basta.
import { enviarAoPrograma, noPrograma } from './programa.js';

const app = typeof window !== 'undefined' ? window.ExiladosAndroid : undefined;

/** `chamada`: toca como ligação (som de chamada e prioridade alta). `alvo`: sala ou conversa a abrir no clique. */
export function notificarFora({ titulo, texto, alvo = '', chamada = false }) {
  if (app?.notificar) {
    try {
      app.notificar(String(titulo), String(texto), chamada ? 'chamada' : 'mensagem', String(alvo));
      return;
    } catch {
      // App de uma versão sem notificações: segue para as outras formas.
    }
  }
  if (noPrograma) {
    enviarAoPrograma({ tipo: 'notificar', titulo: String(titulo), texto: String(texto), alvo: String(alvo), chamada });
    return;
  }
  if (document.hidden && typeof Notification === 'function' && Notification.permission === 'granted') {
    try {
      const aviso = new Notification(titulo, { body: texto, tag: alvo || undefined, icon: 'icones/icone-192.png' });
      aviso.onclick = () => {
        window.focus();
        if (alvo) window.exiladosAbrir?.(alvo);
        aviso.close();
      };
    } catch {
      // Navegador sem notificação por aqui (alguns celulares): fica o aviso do site.
    }
  }
}

/** A chamada foi atendida, recusada ou desistida: para o toque e tira a notificação. */
export function pararToque() {
  try { app?.pararChamada?.(); } catch { /* app antigo */ }
  if (noPrograma) enviarAoPrograma({ tipo: 'pararChamada' });
}
