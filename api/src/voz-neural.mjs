// A voz neural é gerada uma vez por frase e guardada em WAV para todos os aparelhos.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const executar = promisify(execFile);
export async function gerarVozNeural(texto) {
  const pasta = await mkdtemp(join(tmpdir(), 'exilados-voz-'));
  try {
    const mp3 = join(pasta, 'fala.mp3');
    const wav = join(pasta, 'fala.wav');
    await executar('/opt/exilados-voz/bin/edge-tts', [
      '--voice', 'pt-BR-FranciscaNeural', '--rate=+12%', '--text', texto, '--write-media', mp3,
    ], { timeout: 12000, maxBuffer: 65536 });
    await executar('/usr/bin/ffmpeg', ['-nostdin', '-v', 'error', '-i', mp3,
      '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wav], { timeout: 5000, maxBuffer: 65536 });
    return await readFile(wav);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
