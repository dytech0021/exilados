// Site aberto dentro do app Android do Exilados (window.ExiladosAndroid). O app mantém a voz com a tela apagada
// enquanto a pessoa está numa sala de voz (serviço com a notificação "Na sala de voz", como o Discord); o site avisa
// quando ela entra, troca de sala ou sai.

export const noApp = typeof window !== 'undefined' && Boolean(window.ExiladosAndroid);
export const ENDERECO_APK = 'https://filabox3d.com.br/exilados/atualizacao/Exilados.apk';

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
