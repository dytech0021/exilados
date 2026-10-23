// Versão à vista e atualização forçada do site. servidor/publicar.ps1 grava versao.json ao lado do site
// ({ versao, minima }); publicado com -Forcar, a mínima passa a ser a versão nova. Quem estiver numa versão mais velha
// recarrega sozinho (de tempos em tempos e ao voltar para a janela), e o servidor não deixa versão velha entrar na voz.
import { versaoDoApp } from './android.js';
import { versaoDoPrograma } from './programa.js';
import { VERSAO_SITE } from './versao.js';

const CONFERIR_MS = 60 * 1000;
const CHAVE_RECARGA = 'exilados-recarregou-para';

/** "1.0.8 · site 43": a versão do programa (ou do app) e a do site; em desenvolvimento, só o que houver. */
export function versaoAVista({ programa, app, site }) {
  return [programa || app, site && site !== 'dev' ? `site ${site}` : null].filter(Boolean).join(' · ');
}

/** "Exilados 1.0.8 · site 43" (no navegador, "Exilados · site 43"). */
export function nomeComVersao(versoes) {
  const texto = versaoAVista(versoes);
  if (!texto) return 'Exilados';
  return versoes.programa || versoes.app ? `Exilados ${texto}` : `Exilados · ${texto}`;
}

const VERSOES = {
  programa: versaoDoPrograma,
  app: versaoDoApp(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
  site: VERSAO_SITE,
};
/** Desta janela: vão no título (a barra da janela do programa) e no topo da lateral. */
export const VERSAO_A_VISTA = versaoAVista(VERSOES);
export const NOME_COM_VERSAO = nomeComVersao(VERSOES);

/** Se a versão carregada (publicada, não "dev") é mais velha que a mínima. */
export function precisaRecarregar(atual, minima) {
  const n = Number(atual);
  return Number.isFinite(n) && n > 0 && Number(minima) > n;
}

let avisar = () => {};

/**
 * Recarrega a página na versão nova. Uma vez só por motivo nesta aba: se o servidor ainda entregar a versão velha,
 * não fica recarregando sem parar.
 */
export function recarregar(motivo) {
  try {
    if (sessionStorage.getItem(CHAVE_RECARGA) === String(motivo)) return;
    sessionStorage.setItem(CHAVE_RECARGA, String(motivo));
  } catch { /* sem armazenamento: recarrega mesmo assim */ }
  avisar('Atualizando o Exilados para a versão nova...');
  setTimeout(() => location.reload(), 1500);
}

async function conferir() {
  try {
    const resposta = await fetch(new URL('../versao.json', import.meta.url), { cache: 'no-store' });
    if (!resposta.ok) return;
    const { minima } = await resposta.json();
    if (precisaRecarregar(VERSAO_SITE, minima)) recarregar(minima);
  } catch { /* sem rede: confere na próxima */ }
}

/** Confere a versão mínima agora, a cada minuto e quando a janela volta a aparecer. */
export function vigiarVersao({ aviso }) {
  avisar = aviso;
  conferir();
  setInterval(conferir, CONFERIR_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
}
