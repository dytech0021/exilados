package com.dytech.exilados

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Bundle
import android.widget.Toast

/**
 * A resposta do Android à instalação da atualização (sem tela própria): se ele pedir a confirmação, mostra a tela dele;
 * instalada a versão nova, abre o Exilados de novo; deu errado, avisa.
 */
class AtualizacaoActivity : Activity() {
    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        tratar(intent)
        finish()
    }

    private fun tratar(intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirmar = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (confirmar == null) return falhou("O Android não mostrou a confirmação da instalação.")
                try { startActivity(confirmar) } catch (e: RuntimeException) { falhou("O Android não mostrou a confirmação da instalação.") }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                AtualizacaoApp.arquivo(this).delete()
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
            }
            PackageInstaller.STATUS_FAILURE_ABORTED -> falhou(null)
            else -> falhou(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }

    private fun falhou(mensagem: String?) {
        Toast.makeText(this, if (mensagem == null) "Atualização cancelada." else "A atualização não foi instalada: $mensagem", Toast.LENGTH_LONG).show()
    }
}
