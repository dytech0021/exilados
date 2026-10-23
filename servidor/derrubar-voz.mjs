// Roda no servidor, depois de instalar com servidor/publicar.ps1 -Forcar: fecha todas as salas de voz (e chamadas),
// para todos voltarem já na versão nova do site. Lê a chave do LiveKit de /etc/exilados/api.env (nada é mostrado).
import { readFileSync } from 'node:fs';
import { LiveKit } from '/opt/exilados/api/src/livekit.mjs';

const env = {};
for (const linha of readFileSync('/etc/exilados/api.env', 'utf8').split('\n')) {
  const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const livekit = new LiveKit({ api: env.LIVEKIT_API || 'http://127.0.0.1:7880', chave: env.LIVEKIT_CHAVE, segredo: env.LIVEKIT_SEGREDO });
const salas = await livekit.listarSalas();
for (const sala of salas) await livekit.fecharSala(sala);
console.log(`Salas de voz fechadas: ${salas.length}.`);
