import assert from 'node:assert/strict';
import test from 'node:test';
import { volumeNaFaixa } from '../js/volume.js';

// O mesmo formato da faixa de áudio remota do LiveKit (RemoteAudioTrack): elementos <audio>, contexto e volume.
function faixaFalsa() {
  const elemento = { muted: false, volume: 1 };
  return {
    elemento,
    attachedElements: [elemento],
    contexto: undefined,
    volume: 1,
    setAudioContext(ctx) { this.contexto = ctx; },
    setVolume(v) {
      if (!this.contexto && v > 1) throw new RangeError('volume do <audio> vai só até 1');
      this.volume = v;
    },
  };
}
const contexto = { nome: 'reforço' };

test('até 100% a voz toca direto no <audio>, sem o reforço', () => {
  const faixa = faixaFalsa();
  volumeNaFaixa(faixa, 0.6, () => contexto);
  assert.equal(faixa.contexto, undefined);
  assert.equal(faixa.elemento.muted, false);
  assert.equal(faixa.volume, 0.6);
});

test('acima de 100% a voz passa pelo reforço, e o <audio> fica mudo para não tocar duas vezes', () => {
  const faixa = faixaFalsa();
  volumeNaFaixa(faixa, 1.8, () => contexto);
  assert.equal(faixa.contexto, contexto);
  assert.equal(faixa.elemento.muted, true);
  assert.equal(faixa.volume, 1.8);
});

test('voltando a 100% ou menos, sai do reforço e o <audio> volta a tocar', () => {
  const faixa = faixaFalsa();
  volumeNaFaixa(faixa, 2, () => contexto);
  volumeNaFaixa(faixa, 0.9, () => contexto);
  assert.equal(faixa.contexto, undefined);
  assert.equal(faixa.elemento.muted, false);
  assert.equal(faixa.volume, 0.9);
});
