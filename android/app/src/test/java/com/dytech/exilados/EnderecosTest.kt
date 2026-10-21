package com.dytech.exilados

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EnderecosTest {
    @Test
    fun soOSiteDoExiladosFicaDentroDoApp() {
        assertTrue(Enderecos.doSite("https://filabox3d.com.br/exilados/"))
        assertTrue(Enderecos.doSite("https://filabox3d.com.br/exilados"))
        assertTrue(Enderecos.doSite("https://filabox3d.com.br/exilados/?code=abc#convite=123"))
        assertFalse(Enderecos.doSite("https://filabox3d.com.br/"))
        assertFalse(Enderecos.doSite("https://filabox3d.com.br/exiladosx/"))
        assertFalse(Enderecos.doSite("http://filabox3d.com.br/exilados/"))
        assertFalse(Enderecos.doSite("https://www.youtube.com/watch?v=1"))
    }

    @Test
    fun loginDoGoogleVaiPeloNavegadorVoltandoParaAPortaDoCelular() {
        val pedido = "https://kobtvgqnitdeviddvymm.supabase.co/auth/v1/authorize?provider=google" +
            "&redirect_to=https%3A%2F%2Ffilabox3d.com.br%2Fexilados%2F%3Fx%3D1&code_challenge=abc123&code_challenge_method=s256"
        val login = Enderecos.loginGoogle(pedido)!!
        assertEquals(
            "https://kobtvgqnitdeviddvymm.supabase.co/auth/v1/authorize?provider=google&code_challenge=abc123" +
                "&code_challenge_method=s256&redirect_to=http%3A%2F%2F127.0.0.1%3A53682%2Fexilados",
            login.autorizar,
        )
        assertEquals("https://filabox3d.com.br/exilados/?x=1", login.volta)
    }

    @Test
    fun loginQuePedeVoltaForaDoSiteVoltaParaOComeco() {
        val login = Enderecos.loginGoogle(
            "https://kobtvgqnitdeviddvymm.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fexemplo.com%2F",
        )!!
        assertEquals("https://filabox3d.com.br/exilados/", login.volta)
    }

    @Test
    fun outrosEnderecosNaoSaoLogin() {
        assertNull(Enderecos.loginGoogle("https://kobtvgqnitdeviddvymm.supabase.co/rest/v1/exilados_salas"))
        assertNull(Enderecos.loginGoogle("https://filabox3d.com.br/exilados/"))
    }

    @Test
    fun aVoltaDoNavegadorTrazOCodigoOuOErro() {
        assertEquals(Enderecos.Retorno("c0d1g0", null), Enderecos.retorno("GET /exilados?code=c0d1g0 HTTP/1.1"))
        assertEquals(
            Enderecos.Retorno(null, "Acesso negado"),
            Enderecos.retorno("GET /exilados?error=access_denied&error_description=Acesso+negado HTTP/1.1"),
        )
        assertNull(Enderecos.retorno("GET /favicon.ico HTTP/1.1"))
        assertNull(Enderecos.retorno("lixo"))
    }

    @Test
    fun oCodigoEntraNoEnderecoDeVoltaSemPerderOConvite() {
        assertEquals("https://filabox3d.com.br/exilados/?code=abc", Enderecos.voltaComCodigo("https://filabox3d.com.br/exilados/", "abc"))
        assertEquals("https://filabox3d.com.br/exilados/?x=1&code=abc", Enderecos.voltaComCodigo("https://filabox3d.com.br/exilados/?x=1", "abc"))
        assertEquals(
            "https://filabox3d.com.br/exilados/?code=abc#convite=9",
            Enderecos.voltaComCodigo("https://filabox3d.com.br/exilados/#convite=9", "abc"),
        )
    }
}
