// Desconsidera pausas curtas e o tempo em que o navegador suspende uma aba oculta.
export function vigiarVideo(anterior, { tempo, agora, ativo }) {
  if (!ativo || !anterior || tempo !== anterior.tempo) {
    return { tempo, paradoDesde: null, reconectar: false };
  }
  const paradoDesde = anterior.paradoDesde ?? agora;
  return { tempo, paradoDesde, reconectar: agora - paradoDesde >= 12000 };
}
