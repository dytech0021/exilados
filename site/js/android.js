// Site aberto dentro do app Android do Exilados (window.ExiladosAndroid). O app mantém a voz com a tela apagada
// enquanto a pessoa está numa sala de voz (serviço com a notificação "Na sala de voz", como o Discord); o site avisa
// quando ela entra, troca de sala ou sai.

export const noApp = typeof window !== 'undefined' && Boolean(window.ExiladosAndroid);
export const ENDERECO_APK = 'https://filabox3d.com.br/exilados/atualizacao/Exilados.apk';

/** A versão do app ("1.0.9"), pelo agente do WebView, ou null fora dele. */
export function versaoDoApp(agente) {
  return /ExiladosAndroid\/(\d+\.\d+\.\d+)/.exec(agente || '')?.[1] || null;
}

/**
 * Devolve `avisar(tipoDaVista)`, que conta ao `app` quando há vídeo na tela (live ou tela compartilhada): com vídeo, o
 * app vira janela flutuante ao sair dele. Só as mudanças; sem app, nada.
 */
export function avisoDeVideo(app) {
  let ultimo = null;
  return (tipo) => {
    const video = tipo === 'live' || tipo === 'tela';
    if (!app || video === ultimo) return;
    ultimo = video;
    try {
      app.video(video);
    } catch {
      // App de uma versão sem janela flutuante.
    }
  };
}

/** Devolve `avisar(ligada, sala)`, que conta ao `app` só as mudanças. Sem app (navegador), não faz nada. */
export function avisoDeVoz(app) {
  let ultimo = null;
  return (ligada, sala) => {
    const agora = ligada ? `sim:${sala}` : 'não';
    if (!app || agora === ultimo) return;
    ultimo = agora;
    try {
      app.voz(Boolean(ligada), ligada ? String(sala || '') : '');
    } catch {
      // App de uma versão sem esse aviso: a voz segue, só sem a notificação.
    }
  };
}
