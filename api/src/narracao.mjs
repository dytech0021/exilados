// Narração da sala de voz com voz sintética do demo oficial do Qwen3-TTS (Hugging Face), sem conta nem chave. O demo
// não atende o servidor (IP de datacenter fica sem cota de GPU), então quem gera é o aparelho de quem está na sala:
// ele pede aqui a frase e a descrição da voz, gera no demo e manda o endereço do áudio; o servidor baixa (só do demo),
// confere que é WAV e guarda em disco para todo o grupo. Sem áudio guardado, o site fala com a voz do aparelho.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ORIGEM = 'https://qwen-qwen3-tts.hf.space';
const VERSAO = 'carioca-1';
const MAX_AUDIO = 1024 * 1024;
const DESCRICAO = 'An adult Brazilian woman with a warm, feminine, slightly husky, sensual and playful voice. '
  + 'Speak native Brazilian Portuguese with an unmistakable Rio de Janeiro carioca accent, including soft chiado in syllable-final S. '
  + 'Intimate, charming, confident and teasing delivery, with natural expressive inflection. '
  + 'A brisk conversational pace, short pauses, clear names. Do not speak slowly, monotonously or robotically. No music or sound effects.';
const FRASES = {
  entrou: (nome) => `${nome} chegou, hein!`,
  saiu: (nome) => `${nome} meteu o pé!`,
  live: (nome) => `${nome} abriu uma live!`,
};

async function lerLimitado(resposta, limite) {
  if (!resposta.ok) throw Error('Áudio indisponível.');
  const partes = [];
  let tamanho = 0;
  for await (const parte of resposta.body) {
    tamanho += parte.length;
    if (tamanho > limite) { await resposta.body.cancel?.().catch(() => {}); throw Error('Áudio grande demais.'); }
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

function conferirWav(audio) {
  if (audio.length < 44 || audio.length > MAX_AUDIO || audio.toString('ascii', 0, 4) !== 'RIFF'
    || audio.toString('ascii', 8, 12) !== 'WAVE') throw Error('Não é áudio WAV.');
  return audio;
}

const limparNome = (nome) => String(nome || '').trim().replace(/\s+/g, ' ').slice(0, 80);

export class Narracao {
  constructor({ pasta = join(process.env.STATE_DIRECTORY || tmpdir(), 'exilados-narracao'), baixar = globalThis.fetch } = {}) {
    this.pasta = pasta;
    this.baixar = baixar;
  }

  #arquivo(nome, evento) {
    const chave = createHash('sha256').update(`${VERSAO}\0${limparNome(nome)}\0${evento}`).digest('hex');
    return join(this.pasta, `${chave}.wav`);
  }

  /** O que o aparelho manda gerar no demo: frase fixa, idioma e descrição da voz (ou null, evento inválido). */
  pedido(nome, evento) {
    nome = limparNome(nome);
    if (!FRASES[evento] || !nome) return null;
    return { origem: ORIGEM, texto: FRASES[evento](nome), idioma: 'Portuguese', descricao: DESCRICAO };
  }

  /** O áudio já guardado (base64), ou null. */
  async guardado(nome, evento) {
    if (!this.pedido(nome, evento)) return null;
    try { return conferirWav(await readFile(this.#arquivo(nome, evento))).toString('base64'); } catch { return null; }
  }

  /** Baixa do demo o áudio que o aparelho gerou e guarda; devolve o base64, ou null se não for um WAV de lá. */
  async guardar(nome, evento, endereco) {
    if (!this.pedido(nome, evento)) return null;
    let url;
    try { url = new URL(String(endereco || '')); } catch { return null; }
    if (url.origin !== ORIGEM || !url.pathname.startsWith('/gradio_api/file=')) return null;
    try {
      const audio = conferirWav(await lerLimitado(await this.baixar(url.href, {
        redirect: 'error', signal: AbortSignal.timeout(15000),
      }), MAX_AUDIO));
      await mkdir(this.pasta, { recursive: true });
      const arquivos = (await readdir(this.pasta)).filter((f) => /^[a-f0-9]{64}\.wav$/.test(f));
      if (arquivos.length >= 256) await unlink(join(this.pasta, arquivos[0])).catch(() => {});
      const arquivo = this.#arquivo(nome, evento);
      await writeFile(`${arquivo}.novo`, audio);
      await rename(`${arquivo}.novo`, arquivo);
      return audio.toString('base64');
    } catch {
      return null;
    }
  }
}
