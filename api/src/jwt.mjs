// Tokens JWT (HS256) do LiveKit, sem pacotes externos.
import { createHmac, timingSafeEqual } from 'node:crypto';

const base64 = (valor) => Buffer.from(typeof valor === 'string' ? valor : JSON.stringify(valor)).toString('base64url');

export function assinarJwt(payload, segredo) {
  const corpo = `${base64({ alg: 'HS256', typ: 'JWT' })}.${base64(payload)}`;
  return `${corpo}.${createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}

/** Devolve o conteúdo de um token assinado com `segredo`, ou null (assinatura errada ou formato inválido). */
export function lerJwt(token, segredo) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const esperado = createHmac('sha256', segredo).update(`${partes[0]}.${partes[1]}`).digest();
  const recebido = Buffer.from(partes[2], 'base64url');
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Permissão de entrar numa sala de voz: só publicar o microfone e ouvir os outros. */
export function tokenDoLiveKit({ chave, segredo, identidade, nome, sala, segundos = 600, agora = Date.now() }) {
  const s = Math.floor(agora / 1000);
  return assinarJwt({
    iss: chave,
    sub: identidade,
    name: nome,
    nbf: s - 10,
    exp: s + segundos,
    video: {
      room: sala,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: ['microphone'],
    },
  }, segredo);
}

/** Token do próprio exilados-api para a API de salas do LiveKit (listar e remover participantes). */
export function tokenDeServico({ chave, segredo, sala, agora = Date.now() }) {
  const s = Math.floor(agora / 1000);
  const video = { roomList: true, roomAdmin: true };
  if (sala) video.room = sala;
  return assinarJwt({ iss: chave, nbf: s - 10, exp: s + 60, video }, segredo);
}
