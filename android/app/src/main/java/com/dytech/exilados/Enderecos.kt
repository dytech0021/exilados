package com.dytech.exilados

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Os endereços do app: o site do Exilados fica dentro dele; o resto abre no navegador. O login com Google (que não
 * aceita entrar dentro de apps) vai pelo navegador do celular e volta para uma porta do próprio celular, o mesmo
 * endereço que o programa do Windows usa (já autorizado no Supabase).
 */
object Enderecos {
    const val SITE = "https://filabox3d.com.br/exilados/"
    private const val SUPABASE = "https://kobtvgqnitdeviddvymm.supabase.co"
    const val PORTA_GOOGLE = 53682
    private const val RETORNO_GOOGLE = "http://127.0.0.1:$PORTA_GOOGLE/exilados"

    data class Login(val autorizar: String, val volta: String)
    data class Retorno(val codigo: String?, val erro: String?)

    /** O endereço é do site do Exilados (fica dentro do app). */
    fun doSite(url: String): Boolean {
        val u = try { URI(url) } catch (e: Exception) { return false }
        val caminho = u.rawPath ?: return false
        return u.scheme.equals("https", true) && u.host.equals("filabox3d.com.br", true) &&
            (caminho == "/exilados" || caminho.startsWith("/exilados/"))
    }

    /** O site pediu o login do Google: o mesmo pedido, voltando para a porta do celular, e para onde o site queria voltar. */
    fun loginGoogle(url: String): Login? {
        if (!url.startsWith("$SUPABASE/auth/v1/authorize?")) return null
        val (inicio, consulta) = url.split('?', limit = 2)
        val partes = consulta.split('&').filter { it.isNotEmpty() }
        val pedido = partes.firstOrNull { it.startsWith("redirect_to=") }?.substringAfter('=')?.let { decodificar(it) }
        val volta = if (pedido != null && doSite(pedido)) pedido else SITE
        val resto = partes.filterNot { it.startsWith("redirect_to=") } + "redirect_to=${codificar(RETORNO_GOOGLE)}"
        return Login("$inicio?${resto.joinToString("&")}", volta)
    }

    /** A primeira linha do pedido que o navegador fez à porta do celular: o código do login, o erro, ou null (outra coisa). */
    fun retorno(linhaPedido: String): Retorno? {
        val alvo = Regex("^GET (\\S+) HTTP/").find(linhaPedido)?.groupValues?.get(1) ?: return null
        val caminho = alvo.substringBefore('?')
        if (caminho != "/exilados" && caminho != "/exilados/") return null
        val valores = alvo.substringAfter('?', "").split('&').filter { '=' in it }
            .associate { it.substringBefore('=') to decodificar(it.substringAfter('=')) }
        valores["code"]?.takeIf { it.isNotEmpty() }?.let { return Retorno(it, null) }
        return (valores["error_description"] ?: valores["error"])?.let { Retorno(null, it) }
    }

    /** O endereço de volta com o código do login (o site troca o código pela sessão), sem perder o "#" (convites). */
    fun voltaComCodigo(volta: String, codigo: String): String {
        val base = volta.substringBefore('#')
        val fragmento = volta.substringAfter('#', "")
        val separador = if ('?' in base) "&" else "?"
        return "$base${separador}code=${codificar(codigo)}" + if (fragmento.isEmpty()) "" else "#$fragmento"
    }

    private fun decodificar(texto: String) = URLDecoder.decode(texto, "UTF-8")
    private fun codificar(texto: String) = URLEncoder.encode(texto, "UTF-8")
}
