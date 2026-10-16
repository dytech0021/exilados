// Fala com o site dentro do programa pelo protocolo de depuração do WebView2 (só no teste da atualização, com o
// programa aberto com WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<porta>).
// Uso: node cdp.mjs <porta> <começo do endereço> avaliar "<expressão>"   → escreve o resultado em JSON
//      node cdp.mjs <porta> <começo do endereço> foto arquivo.png
// Sai com 2 se não achar a página.
import { writeFile } from 'node:fs/promises';

const [porta, comeco, acao, argumento] = process.argv.slice(2);
setTimeout(() => process.exit(3), 15000);

let alvos;
try {
  alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
} catch {
  process.exit(2);
}
const pagina = alvos.find((a) => a.type === 'page' && a.url.startsWith(comeco));
if (!pagina) process.exit(2);

const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((pronto, falha) => {
  ws.onopen = pronto;
  ws.onerror = falha;
});
let ultimo = 0;
const pendentes = new Map();
ws.onmessage = (evento) => {
  const mensagem = JSON.parse(evento.data);
  pendentes.get(mensagem.id)?.(mensagem);
};
const chamar = (method, params) => new Promise((pronto) => {
  pendentes.set(++ultimo, pronto);
  ws.send(JSON.stringify({ id: ultimo, method, params }));
});

if (acao === 'avaliar') {
  const r = await chamar('Runtime.evaluate', { expression: argumento, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.result?.value ?? null));
} else if (acao === 'foto') {
  const r = await chamar('Page.captureScreenshot', { format: 'png' });
  await writeFile(argumento, Buffer.from(r.result.data, 'base64'));
}
ws.close();
process.exit(0);
