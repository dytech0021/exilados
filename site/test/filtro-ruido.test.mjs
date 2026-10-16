import test from 'node:test';
import assert from 'node:assert/strict';
import { conectarFiltroRuido } from '../js/filtro-ruido.js';

class No {
  destinos = [];
  eventos = new Map();
  connect(destino) { this.destinos.push(destino); }
  disconnect(destino) { this.destinos = this.destinos.filter((atual) => atual !== destino); }
  addEventListener(nome, fn) { this.eventos.set(nome, fn); }
  removeEventListener(nome, fn) { if (this.eventos.get(nome) === fn) this.eventos.delete(nome); }
  disparar(nome) { this.eventos.get(nome)?.(); }
}

test('quando o processador falha, a voz passa direto sem ficar muda', () => {
  const fonte = new No();
  const filtro = new No();
  const ganho = new No();
  const desligar = conectarFiltroRuido(fonte, filtro, ganho);
  assert.deepEqual(fonte.destinos, [filtro]);
  assert.deepEqual(filtro.destinos, [ganho]);
  filtro.disparar('processorerror');
  assert.deepEqual(fonte.destinos, [ganho]);
  assert.deepEqual(filtro.destinos, []);
  desligar();
  assert.equal(filtro.eventos.has('processorerror'), false);
});

test('sem filtro, a voz passa direto', () => {
  const fonte = new No();
  const ganho = new No();
  const desligar = conectarFiltroRuido(fonte, null, ganho);
  assert.deepEqual(fonte.destinos, [ganho]);
  desligar();
});
