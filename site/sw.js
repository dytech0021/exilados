// Service worker do Exilados (escopo /exilados/): guarda a casca do site para abrir rápido e funcionar como
// aplicativo instalado. Sempre tenta a rede primeiro (o site muda sem aviso); a cópia guardada só entra quando a
// rede falha. API, voz, lives e atualização nunca passam por aqui.
const VERSAO = 'exilados-casca-23';
const CASCA = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'vendor/supabase-2.117.2.js',
  'vendor/noise-worklet.js',
  'vendor/qrcode-generator-2.0.4.js',
  'js/app.js', 'js/android.js', 'js/anuncio.js', 'js/atualizacao-site.js', 'js/chamadas.js', 'js/lidas.js', 'js/nativo.js', 'js/seletores.js', 'js/api.js', 'js/amigos.js', 'js/auth.js', 'js/chat.js', 'js/config.js', 'js/config-ui.js',
  'js/dados.js', 'js/estabilidade.js', 'js/estado.js', 'js/filtro-ruido.js', 'js/flutuante.js', 'js/formato.js', 'js/grupo.js', 'js/imagens.js', 'js/live.js', 'js/montagem-voz.js', 'js/presenca.js', 'js/programa.js', 'js/qr.js', 'js/qualidade-tela.js',
  'js/som-tela.js', 'js/supa.js', 'js/tela.js', 'js/ui.js', 'js/versao.js', 'js/volume.js', 'js/voz.js',
  'icones/icone-192.png?v=2', 'icones/icone-180.png?v=2',
  'icones/icone-512.png?v=2', 'icones/icone-mascara-512.png?v=2',
];
const FORA = ['/exilados/api/', '/exilados/ao-vivo/', '/exilados/atualizacao/', '/exilados/rtc', '/exilados/versao.json'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(caches.keys()
    .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith('exilados-') && n !== VERSAO).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  if (pedido.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/exilados/')) return;
  if (FORA.some((p) => url.pathname.startsWith(p))) return;
  evento.respondWith((async () => {
    try {
      const resposta = await fetch(pedido);
      if (resposta.ok && resposta.type === 'basic') {
        const copia = resposta.clone();
        caches.open(VERSAO).then((cache) => cache.put(pedido, copia)).catch(() => {});
      }
      return resposta;
    } catch (falha) {
      const guardada = await caches.match(pedido, { ignoreSearch: pedido.mode === 'navigate' });
      if (guardada) return guardada;
      if (pedido.mode === 'navigate') {
        const casca = await caches.match('index.html');
        if (casca) return casca;
      }
      throw falha;
    }
  })());
});
