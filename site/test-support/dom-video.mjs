export class Elemento extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.readyState = 0; this.volume = 1; }
  append(...filhos) { for (const filho of filhos) { filho.parentNode?.removeChild(filho); this.children.push(filho); filho.parentNode = this; } }
  replaceChildren(...filhos) { for (const filho of [...this.children]) filho.remove(); this.append(...filhos); }
  removeChild(filho) { this.children.splice(this.children.indexOf(filho), 1); filho.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  contains(filho) { return this === filho || this.children.some((e) => e.contains(filho)); }
  setAttribute(nome, valor) { this.attributes[nome] = valor; }
  setPointerCapture() {}
  closest(seletor) { return seletor === 'button' && this.tagName === 'button' ? this : this.parentNode?.closest(seletor); }
  play() { return Promise.resolve(); }
}
export function instalarDom() {
  const app = new Elemento();
  globalThis.Node = Elemento;
  globalThis.document = Object.assign(new EventTarget(), {
    createElement: (tag) => new Elemento(tag), createElementNS: (_ns, tag) => new Elemento(tag),
    createTextNode: (texto) => Object.assign(new Elemento('text'), { textContent: texto }),
    getElementById: () => app,
  });
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 800,
    supabase: { createClient: () => ({ auth: { getSession: () => new Promise(() => {}) } }) },
  });
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  return app;
}
