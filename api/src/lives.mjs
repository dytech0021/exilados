// Lives em andamento: caminho no MediaMTX, senha de envio e permissões de assistir.
//
// A senha de envio e a permissão de assistir são resumos (HMAC) com o segredo do serviço, para continuarem valendo
// depois de o serviço reiniciar no meio de uma live. A memória guarda só o que muda: quem está ao vivo, o último
// sinal de vida e os caminhos encerrados (para a senha de uma live parada não servir mais).
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const SEM_SINAL_MS = 20000;
export const CAMINHO = /^ex\/[A-Za-z0-9]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_ENCERRADOS = 2000;

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export class Lives {
  constructor({ segredo, agora = () => Date.now(), leituraMs = 120000 }) {
    if (!segredo || String(segredo).length < 32) throw new Error('O segredo das lives precisa ter ao menos 32 caracteres.');
    this.segredo = String(segredo);
    this.agora = agora;
    this.leituraMs = leituraMs;
    this.porUsuario = new Map();
    this.porCaminho = new Map();
    this.encerrados = new Set();
  }

  #resumo(texto) {
    return createHmac('sha256', this.segredo).update(texto).digest('hex');
  }

  #guardar(id, caminho) {
    const entrada = { id, caminho, ultimo: this.agora() };
    this.porUsuario.set(id, entrada);
    this.porCaminho.set(caminho, entrada);
    return entrada;
  }

  /** Nova live de `id`: encerra a anterior (se houver) e devolve caminho, usuário e senha de envio. */
  comecar(id) {
    this.parar(id);
    let caminho;
    do {
      caminho = 'ex/' + Array.from({ length: 24 }, () => LETRAS[randomInt(LETRAS.length)]).join('');
    } while (this.porCaminho.has(caminho) || this.encerrados.has(caminho));
    this.#guardar(id, caminho);
    return { caminho, usuario: id, senha: this.#resumo(`envio\n${caminho}\n${id}`) };
  }

  /** Sinal de vida da live `caminho` de `id` (o caminho vem do banco). Falso se ela já foi encerrada ou trocada. */
  sinal(id, caminho) {
    if (!CAMINHO.test(String(caminho)) || this.encerrados.has(caminho)) return false;
    const atual = this.porUsuario.get(id);
    if (atual && atual.caminho !== caminho) return false;
    if (atual) atual.ultimo = this.agora();
    else this.#guardar(id, caminho);
    return true;
  }

  /** Encerra a live de `id`; devolve o caminho que ela usava (ou null). */
  parar(id) {
    const atual = this.porUsuario.get(id);
    if (!atual) return null;
    this.porUsuario.delete(id);
    this.porCaminho.delete(atual.caminho);
    this.encerrados.add(atual.caminho);
    if (this.encerrados.size > MAX_ENCERRADOS) this.encerrados.delete(this.encerrados.values().next().value);
    return atual.caminho;
  }

  donoDe(caminho) {
    return this.porCaminho.get(caminho)?.id ?? null;
  }

  encerrada(caminho) {
    if (this.encerrados.has(caminho)) return true;
    const entrada = this.porCaminho.get(caminho);
    return Boolean(entrada) && this.agora() - entrada.ultimo > SEM_SINAL_MS;
  }

  /** O MediaMTX pergunta se `usuario` com `senha` pode enviar para `caminho`. */
  podeEnviar(caminho, usuario, senha) {
    if (!CAMINHO.test(String(caminho)) || !UUID.test(String(usuario))) return false;
    if (!igual(senha, this.#resumo(`envio\n${caminho}\n${usuario}`))) return false;
    if (this.encerrados.has(caminho)) return false;
    const atual = this.porUsuario.get(usuario);
    if (atual && atual.caminho !== caminho) return false;
    // Depois de o serviço reiniciar, a live que reconecta volta a ser conhecida.
    if (!atual) this.#guardar(usuario, caminho);
    return true;
  }

  /** Permissão de assistir `caminho` por alguns minutos (o site já conferiu que a pessoa é do grupo). */
  leitura(caminho) {
    const ate = this.agora() + this.leituraMs;
    return `${ate.toString(36)}.${this.#resumo(`leitura\n${caminho}\n${ate}`)}`;
  }

  podeLer(caminho, token) {
    if (!CAMINHO.test(String(caminho)) || this.encerrada(caminho)) return false;
    const [ateTexto, resumo] = String(token || '').split('.');
    const ate = parseInt(ateTexto, 36);
    if (!Number.isFinite(ate) || ate < this.agora() || !resumo) return false;
    return igual(resumo, this.#resumo(`leitura\n${caminho}\n${ate}`));
  }
}
