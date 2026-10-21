package com.dytech.exilados

import java.security.MessageDigest

/**
 * Uma versão nova do app anunciada pelo servidor (android.json ao lado do Exilados.apk). Isto só serve para o
 * transporte (tamanho e resumo do download); quem garante que o arquivo é mesmo o Exilados é a assinatura do APK,
 * conferida no Android antes de instalar (PacoteAtualizacao).
 */
data class Atualizacao(val versionCode: Int, val versionName: String, val size: Long, val sha256: String) {
    fun confere(bytes: ByteArray) = bytes.size.toLong() == size && resumo(bytes).equals(sha256, ignoreCase = true)

    companion object {
        const val TAMANHO_MAXIMO = 64L * 1024 * 1024

        /** A atualização anunciada em `texto`, ou null se não for mais nova que a `instalada`. Aviso malformado: erro. */
        fun ler(texto: String, instalada: Int): Atualizacao? {
            fun numero(nome: String) = Regex("\"$nome\"\\s*:\\s*(\\d{1,12})").find(texto)?.groupValues?.get(1)?.toLong()
                ?: throw IllegalArgumentException("Aviso de atualização sem $nome.")
            fun textoDe(nome: String) = Regex("\"$nome\"\\s*:\\s*\"([^\"]*)\"").find(texto)?.groupValues?.get(1)
                ?: throw IllegalArgumentException("Aviso de atualização sem $nome.")
            val codigo = numero("versionCode")
            val tamanho = numero("size")
            val nome = textoDe("versionName")
            val hash = textoDe("sha256")
            require(codigo in 1..Int.MAX_VALUE.toLong() && tamanho in 1..TAMANHO_MAXIMO) { "Aviso de atualização inválido." }
            require(nome.matches(Regex("\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}"))) { "Aviso de atualização inválido." }
            require(hash.matches(Regex("[a-fA-F0-9]{64}"))) { "Aviso de atualização inválido." }
            return if (codigo > instalada) Atualizacao(codigo.toInt(), nome, tamanho, hash) else null
        }

        fun resumo(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
