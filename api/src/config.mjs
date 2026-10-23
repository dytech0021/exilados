// Configuração do exilados-api, lida das variáveis de ambiente (arquivo /etc/exilados/api.env no servidor).

export function lerConfig(env = process.env) {
  const exigir = (nome, minimo = 1) => {
    const valor = String(env[nome] || '').trim();
    if (valor.length < minimo) throw new Error(`Falta ${nome} na configuração${minimo > 1 ? ` (mínimo de ${minimo} caracteres)` : ''}.`);
    return valor;
  };
  return {
    porta: Number(env.EXILADOS_PORTA || 7415),
    portaMediamtx: Number(env.EXILADOS_PORTA_MEDIAMTX || 7416),
    supabaseUrl: exigir('SUPABASE_URL'),
    supabaseChave: exigir('SUPABASE_CHAVE'),
    livekitApi: env.LIVEKIT_API || 'http://127.0.0.1:7880',
    livekitChave: exigir('LIVEKIT_CHAVE'),
    livekitSegredo: exigir('LIVEKIT_SEGREDO', 32),
    urlVoz: env.EXILADOS_URL_VOZ || 'wss://filabox3d.com.br/exilados',
    rtsps: (env.EXILADOS_RTSPS || 'rtsps://filabox3d.com.br:8322').replace(/\/$/, ''),
    mediamtxApi: env.MEDIAMTX_API || 'http://127.0.0.1:9997',
    // Autorização do relay do Ponte para os caminhos que não são do Exilados; vazio deixa de repassar.
    relayAuth: env.RELAY_AUTH || '',
    livesSegredo: exigir('LIVES_SEGREDO', 32),
    // Chave do Giphy para a busca de GIFs; vazia, o botão de GIF não aparece no site.
    giphyChave: String(env.GIPHY_CHAVE || '').trim(),
    // versao.json do site publicado (versão e versão mínima para entrar na voz).
    versaoSite: env.EXILADOS_VERSAO_SITE || '/var/www/exilados/www/exilados/versao.json',
  };
}
