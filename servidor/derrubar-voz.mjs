// Roda no servidor, depois de instalar com servidor/publicar.ps1 -Forcar: tira todo mundo das salas de voz (e das
// chamadas), para todos voltarem já na versão nova do site. Lê a chave do LiveKit de /etc/exilados/api.env (nada é
// mostrado). Tira pessoa por pessoa: fechar a sala pediria uma permissão a mais para a chave de serviço.
import { readFileSync } from 'node:fs';
import { LiveKit } from '/opt/exilados/api/src/livekit.mjs';

const env = {};
for (const linha of readFileSync('/etc/exilados/api.env', 'utf8').split('\n')) {
  const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const livekit = new LiveKit({ api: env.LIVEKIT_API || 'http://127.0.0.1:7880', chave: env.LIVEKIT_CHAVE, segredo: env.LIVEKIT_SEGREDO });
let pessoas = 0;
for (const sala of await livekit.listarSalas()) {
  for (const identidade of await livekit.participantes(sala)) {
    if (await livekit.removerParticipante(sala, identidade)) pessoas += 1;
  }
}
console.log(`Tiradas da voz: ${pessoas} pessoa(s).`);
