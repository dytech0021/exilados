package com.dytech.exilados

import android.net.Uri
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * Login com Google: o Google não aceita entrar dentro de apps, então o pedido do site abre no navegador do celular e
 * volta para http://127.0.0.1:53682/exilados, uma porta aberta aqui pelo app enquanto espera (o mesmo endereço do
 * programa do Windows, autorizado no Supabase). Com o código, o site dentro do app troca o código pela sessão (ele
 * guardou a outra metade do PKCE) e a página no navegador mostra um botão para voltar ao app.
 */
class LoginGoogle(private val atividade: MainActivity) {
    @Volatile private var escuta: ServerSocket? = null

    fun comecar(login: Enderecos.Login) {
        cancelar()
        val porta = try {
            ServerSocket(Enderecos.PORTA_GOOGLE, 4, InetAddress.getByName("127.0.0.1"))
        } catch (e: IOException) {
            atividade.avisar("Não deu para começar o login com Google agora. Tente de novo.")
            return
        }
        escuta = porta
        thread(isDaemon = true, name = "login-google") { esperar(porta, login.volta) }
        atividade.abrirFora(Uri.parse(login.autorizar))
    }

    fun cancelar() {
        escuta?.let { runCatching { it.close() } }
        escuta = null
    }

    private fun esperar(porta: ServerSocket, volta: String) {
        try {
            porta.soTimeout = 10 * 60 * 1000
            while (true) {
                val retorno = porta.accept().use { cliente -> atender(cliente) } ?: continue
                if (retorno.codigo != null) atividade.voltarDoLogin(Enderecos.voltaComCodigo(volta, retorno.codigo))
                else atividade.avisar("O Google não concluiu o login: ${retorno.erro}")
                return
            }
        } catch (e: IOException) {
            // Cancelado, ou ninguém voltou em 10 minutos.
        } finally {
            runCatching { porta.close() }
            if (escuta === porta) escuta = null
        }
    }

    private fun atender(cliente: Socket): Enderecos.Retorno? {
        cliente.soTimeout = 10_000
        val linha = cliente.getInputStream().bufferedReader(Charsets.US_ASCII).readLine() ?: return null
        val retorno = Enderecos.retorno(linha)
        val corpo = if (retorno == null) "" else pagina(retorno.codigo != null)
        val status = if (retorno == null) "404 Not Found" else "200 OK"
        val bytes = corpo.toByteArray(Charsets.UTF_8)
        cliente.getOutputStream().apply {
            write("HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n".toByteArray(Charsets.US_ASCII))
            write(bytes)
            flush()
        }
        return retorno
    }

    private fun pagina(deuCerto: Boolean): String {
        val titulo = if (deuCerto) "Pronto!" else "O login não foi concluído"
        val texto = if (deuCerto) "Você entrou com o Google. Volte para o app do Exilados." else "Volte para o app do Exilados e tente de novo."
        val voltar = "intent://abrir#Intent;scheme=exilados;package=${BuildConfig.APPLICATION_ID};end"
        return """<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            |<title>Exilados</title><body style="margin:0;font-family:sans-serif;background:#1e1f22;color:#f2f3f5;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">
            |<div style="padding:24px"><h1 style="font-size:24px">$titulo</h1><p style="color:#b5bac1">$texto</p>
            |<a href="$voltar" style="display:inline-block;margin-top:16px;padding:14px 24px;border-radius:8px;background:#5865f2;color:#fff;text-decoration:none;font-weight:600">Voltar ao Exilados</a></div>
            |<script>setTimeout(function(){location.href="$voltar"},300)</script></body></html>""".trimMargin()
    }
}
