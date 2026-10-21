package com.dytech.exilados

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Depois que a atualização pedida no próprio app termina, o Android avisa a versão nova (MY_PACKAGE_REPLACED). Ele não
 * deixa o app se abrir sozinho em segundo plano, então o Exilados avisa por notificação: "toque para abrir".
 */
class AtualizadoReceiver : BroadcastReceiver() {
    override fun onReceive(contexto: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        // Só quando a atualização foi pedida no app há pouco (não, por exemplo, instalada à mão).
        val prefs = contexto.getSharedPreferences("exilados", Context.MODE_PRIVATE)
        val pedida = prefs.getLong(PEDIDA_EM, 0L)
        prefs.edit().remove(PEDIDA_EM).apply()
        if (System.currentTimeMillis() - pedida > 10 * 60 * 1000L) return
        avisar(contexto)
    }

    companion object {
        const val PEDIDA_EM = "atualizacaoPedidaEm"
        private const val CANAL = "atualizacao"
        private const val NOTIFICACAO = 2

        fun notificacoesLiberadas(contexto: Context): Boolean =
            contexto.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

        fun avisar(contexto: Context) {
            val gerente = contexto.getSystemService(NotificationManager::class.java)
            gerente.createNotificationChannel(NotificationChannel(CANAL, "Atualizações do Exilados", NotificationManager.IMPORTANCE_HIGH))
            val abrir = Intent(contexto, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            val aviso = Notification.Builder(contexto, CANAL)
                .setSmallIcon(R.drawable.ic_notificacao)
                .setContentTitle("Exilados atualizado")
                .setContentText("Versão ${BuildConfig.VERSION_NAME} instalada. Toque para abrir.")
                .setContentIntent(PendingIntent.getActivity(contexto, 0, abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .setTimeoutAfter(30 * 60 * 1000L)
                .build()
            if (gerente.areNotificationsEnabled()) gerente.notify(NOTIFICACAO, aviso)
        }
    }
}
