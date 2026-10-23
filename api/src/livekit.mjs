// API de salas do LiveKit (Twirp com JSON), só em 127.0.0.1.
import { tokenDeServico } from './jwt.mjs';

export class LiveKit {
  constructor({ api, chave, segredo, fetch = globalThis.fetch }) {
    this.api = api.replace(/\/$/, '');
    this.chave = chave;
    this.segredo = segredo;
    this.fetch = fetch;
  }

  async #chamar(metodo, corpo, sala) {
    const resposta = await this.fetch(`${this.api}/twirp/livekit.RoomService/${metodo}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokenDeServico({ chave: this.chave, segredo: this.segredo, sala })}`,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(5000),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = new Error(dados?.msg || `LiveKit respondeu ${resposta.status}`);
      erro.codigo = dados?.code;
      throw erro;
    }
    return dados;
  }

  async listarSalas() {
    const dados = await this.#chamar('ListRooms', {});
    return (dados.rooms || []).map((sala) => sala.name).filter(Boolean);
  }

  /** Quem está conectado em `sala` (identidades), pelo próprio LiveKit. */
  async participantes(sala) {
    try {
      const dados = await this.#chamar('ListParticipants', { room: sala }, sala);
      return (dados.participants || []).map((p) => p.identity).filter(Boolean);
    } catch (erro) {
      if (erro.codigo === 'not_found') return [];
      throw erro;
    }
  }

  async removerParticipante(sala, identidade) {
    try {
      await this.#chamar('RemoveParticipant', { room: sala, identity: identidade }, sala);
      return true;
    } catch (erro) {
      if (erro.codigo === 'not_found') return false;
      throw erro;
    }
  }

  /** Fecha `sala`: todos caem dela (usado ao publicar com -Forcar). */
  async fecharSala(sala) {
    await this.#chamar('DeleteRoom', { room: sala }, sala);
  }

  /** Tira `identidade` de todas as salas de voz; devolve quantas. */
  async tirarDeTodas(identidade) {
    let removido = 0;
    for (const sala of await this.listarSalas()) {
      if (await this.removerParticipante(sala, identidade)) removido += 1;
    }
    return removido;
  }
}
