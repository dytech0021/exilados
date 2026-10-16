// RNNoise (Jitsi, Apache-2.0) roda fora da thread principal para reduzir ruído do microfone.
// O modelo opera em blocos de 480 amostras a 48 kHz; o AudioWorklet entrega 128 por vez.
import { createRNNWasmModuleSync } from '@jitsi/rnnoise-wasm';

const BLOCO = 480;
const CAPACIDADE = 2048;
const ESCALA = 32768;

class CancelamentoRuido extends AudioWorkletProcessor {
  constructor(opcoes) {
    super();
    this.wasm = createRNNWasmModuleSync();
    this.entrada = this.wasm._malloc(BLOCO * 4);
    this.estado = this.wasm._rnnoise_create();
    if (!this.entrada || !this.estado) throw new Error('RNNoise não iniciou.');
    this.entradaFifo = new Float32Array(CAPACIDADE);
    this.saidaFifo = new Float32Array(CAPACIDADE);
    this.escritaEntrada = 0;
    this.leituraEntrada = 0;
    this.totalEntrada = 0;
    this.escritaSaida = 0;
    this.leituraSaida = 0;
    this.totalSaida = 0;
    this.iniciado = false;
    const limiar = Number(opcoes?.processorOptions?.limiarVoz || 0);
    this.limiarVoz = Number.isFinite(limiar) ? Math.max(0, Math.min(0.05, limiar)) : 0;
    this.ganhoPorta = this.limiarVoz ? 0 : 1;
    this.tempoAberta = 0;
    this.port.onmessage = (evento) => {
      if (evento.data !== 'parar') return;
      this.wasm._rnnoise_destroy(this.estado);
      this.wasm._free(this.entrada);
      this.parado = true;
    };
  }

  process(entradas, saidas) {
    if (this.parado) return false;
    const entrada = entradas[0]?.[0];
    const saida = saidas[0]?.[0];
    if (!saida || !entrada) return true;
    for (const amostra of entrada) {
      this.entradaFifo[this.escritaEntrada] = amostra;
      this.escritaEntrada = (this.escritaEntrada + 1) % CAPACIDADE;
      this.totalEntrada++;
    }
    while (this.totalEntrada >= BLOCO) {
      const indice = this.entrada >> 2;
      let energia = 0;
      for (let i = 0; i < BLOCO; i++) {
        const amostra = this.entradaFifo[this.leituraEntrada];
        energia += amostra * amostra;
        this.wasm.HEAPF32[indice + i] = amostra * ESCALA;
        this.leituraEntrada = (this.leituraEntrada + 1) % CAPACIDADE;
      }
      this.totalEntrada -= BLOCO;
      const probabilidadeVoz = this.wasm._rnnoise_process_frame(this.estado, this.entrada, this.entrada);
      if (this.limiarVoz) {
        // RNNoise trata outra pessoa falando como voz. No modo forte, só abre para fala próxima
        // ao microfone; a espera curta preserva sílabas fracas entre partes mais altas da frase.
        if (probabilidadeVoz >= 0.5 && Math.sqrt(energia / BLOCO) >= this.limiarVoz) this.tempoAberta = 25;
        else if (this.tempoAberta) this.tempoAberta--;
      }
      const alvo = !this.limiarVoz || this.tempoAberta ? 1 : 0;
      const passo = (alvo - this.ganhoPorta) / BLOCO;
      for (let i = 0; i < BLOCO; i++) {
        this.ganhoPorta += passo;
        this.saidaFifo[this.escritaSaida] = this.wasm.HEAPF32[indice + i] / ESCALA * this.ganhoPorta;
        this.escritaSaida = (this.escritaSaida + 1) % CAPACIDADE;
      }
      this.ganhoPorta = alvo;
      this.totalSaida += BLOCO;
    }
    // A primeira janela chega no meio de um quantum de 128 amostras. Esperar o próximo evita
    // drenar os 480 quadros cedo demais e inserir pequenos silêncios periódicos na voz.
    if (!this.iniciado && this.totalSaida >= BLOCO) {
      this.iniciado = true;
      return true;
    }
    for (let i = 0; i < saida.length; i++) {
      if (!this.totalSaida) break; // silêncio apenas durante a inicialização
      saida[i] = this.saidaFifo[this.leituraSaida];
      this.leituraSaida = (this.leituraSaida + 1) % CAPACIDADE;
      this.totalSaida--;
    }
    return true;
  }
}

registerProcessor('exilados-cancelamento-ruido', CancelamentoRuido);
