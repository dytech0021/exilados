// exilados-api: permissões de voz e de live do Exilados, prévias de links e GIFs, e autorização do MediaMTX.
// Escuta só em 127.0.0.1: a porta pública (7415) passa pelo nginx; a do MediaMTX (7416) é só local.
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { lerConfig } from './config.mjs';
import { Gifs } from './gifs.mjs';
import { LiveKit } from './livekit.mjs';
import { Lives } from './lives.mjs';
import { Narracao } from './narracao.mjs';
import { MediaMTX, autorizar, repassarPara } from './mediamtx.mjs';
import { criarAutorizacaoHttp, criarRotas } from './rotas.mjs';
import { Supabase } from './supabase.mjs';

const config = lerConfig();
const supabase = new Supabase({ url: config.supabaseUrl, chave: config.supabaseChave });
const livekit = new LiveKit({ api: config.livekitApi, chave: config.livekitChave, segredo: config.livekitSegredo });
const lives = new Lives({ segredo: config.livesSegredo });
const mediamtx = new MediaMTX({ api: config.mediamtxApi });
const repassar = repassarPara(config.relayAuth);
const gifs = new Gifs({ chave: config.giphyChave });
const narracao = new Narracao();
// Assina os endereços das imagens de fora (prévias de links); sai do segredo das lives, sem configuração nova.
const segredoMidia = createHmac('sha256', config.livesSegredo).update('exilados-midia').digest('hex');

function escutar(servidor, porta, nome) {
  servidor.headersTimeout = 10000;
  servidor.requestTimeout = 15000;
  servidor.keepAliveTimeout = 5000;
  servidor.on('error', (erro) => {
    console.error(`Não foi possível escutar ${nome} em 127.0.0.1:${porta}: ${erro.message}`);
    process.exit(1);
  });
  servidor.listen(porta, '127.0.0.1', () => console.log(`Exilados: ${nome} em 127.0.0.1:${porta}`));
}

escutar(http.createServer(criarRotas({ supabase, livekit, lives, mediamtx, config, gifs, narracao, segredoMidia })), config.porta, 'api');
escutar(http.createServer(criarAutorizacaoHttp((pedido) => autorizar(pedido, { lives, repassar }))), config.portaMediamtx, 'autorização do MediaMTX');
