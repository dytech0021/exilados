package com.dytech.exilados

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build

/**
 * Confere um APK baixado antes de instalar: o pacote tem de ser o do Exilados, a versão tem de ser mais nova e o
 * certificado que o assina tem de ser o do app instalado (o aviso do servidor não prova nada sozinho).
 */
object PacoteAtualizacao {
    @Suppress("DEPRECATION")
    val FLAGS: Int =
        if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
        else PackageManager.GET_SIGNATURES

    fun compativel(instalado: PackageInfo, novo: PackageInfo): Boolean {
        if (novo.packageName != instalado.packageName) return false
        if (codigo(novo) <= codigo(instalado)) return false
        val meus = assinaturas(instalado) ?: return false
        val deles = assinaturas(novo) ?: return false
        return meus == deles
    }

    @Suppress("DEPRECATION")
    fun codigo(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun assinaturas(info: PackageInfo): Set<Signature>? {
        if (Build.VERSION.SDK_INT >= 28) {
            info.signingInfo?.let { assinatura ->
                val lista = if (assinatura.hasMultipleSigners()) assinatura.apkContentsSigners else assinatura.signingCertificateHistory
                if (!lista.isNullOrEmpty()) return lista.toSet()
            }
        }
        return info.signatures?.takeIf { it.isNotEmpty() }?.toSet()
    }
}
