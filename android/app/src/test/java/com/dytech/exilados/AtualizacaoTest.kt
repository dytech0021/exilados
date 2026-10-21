package com.dytech.exilados

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

class AtualizacaoTest {
    private val hash = "a".repeat(64)

    @Test
    fun versaoMaisNovaNoServidorViraAtualizacao() {
        val texto = """{"versionCode":3,"versionName":"1.0.9","size":665000,"sha256":"$hash"}"""
        assertEquals(Atualizacao(3, "1.0.9", 665000, hash), Atualizacao.ler(texto, instalada = 2))
    }

    @Test
    fun mesmaVersaoOuMaisVelhaNaoAtualiza() {
        val texto = """{"versionCode":2,"versionName":"1.0.8","size":665000,"sha256":"$hash"}"""
        assertNull(Atualizacao.ler(texto, instalada = 2))
        assertNull(Atualizacao.ler(texto, instalada = 5))
    }

    @Test(expected = IllegalArgumentException::class)
    fun avisoSemOResumoDoArquivoEhRecusado() {
        Atualizacao.ler("""{"versionCode":3,"versionName":"1.0.9","size":665000}""", instalada = 2)
    }

    @Test(expected = IllegalArgumentException::class)
    fun arquivoGrandeDemaisEhRecusado() {
        Atualizacao.ler("""{"versionCode":3,"versionName":"1.0.9","size":999999999,"sha256":"$hash"}""", instalada = 2)
    }

    @Test
    fun oArquivoBaixadoTemQueBaterComTamanhoEResumo() {
        val bytes = "apk de mentira".toByteArray()
        val resumo = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        assertTrue(Atualizacao(3, "1.0.9", bytes.size.toLong(), resumo).confere(bytes))
        assertFalse(Atualizacao(3, "1.0.9", bytes.size.toLong(), hash).confere(bytes))
        assertFalse(Atualizacao(3, "1.0.9", bytes.size + 1L, resumo).confere(bytes))
    }
}
