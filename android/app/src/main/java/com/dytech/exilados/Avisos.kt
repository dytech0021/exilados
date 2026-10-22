package com.dytech.exilados

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager

/**
 * Avisos do site com o app em segundo plano: mensagem direta e menção (canal "Mensagens") e chamada nas conversas
 * diretas (canal "Chamadas", com o toque de ligação repetindo até atender, recusar ou 45 s). Tocar abre a conversa.
 */
object Avisos {
    private const val CANAL_MENSAGENS = "mensagens"
    private const val CANAL_CHAMADAS = "chamadas"
    private const val NOTIFICACAO_CHAMADA = 10
    const val EXTRA_ALVO = "alvo"

    private fun canais(contexto: Context): NotificationManager {
        val gerente = contexto.getSystemService(NotificationManager::class.java)
        gerente.createNotificationChannel(
            NotificationChannel(CANAL_MENSAGENS, "Mensagens", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Mensagens diretas e menções"
            },
        )
        gerente.createNotificationChannel(
            NotificationChannel(CANAL_CHAMADAS, "Chamadas", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Chamadas de voz nas conversas diretas"
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                )
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 600, 800, 600, 800)
            },
        )
        return gerente
    }

    private fun abrir(contexto: Context, alvo: String, codigo: Int): PendingIntent {
        val intent = Intent(contexto, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ALVO, alvo)
        return PendingIntent.getActivity(contexto, codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun mostrar(contexto: Context, titulo: String, texto: String, chamada: Boolean, alvo: String) {
        val gerente = canais(contexto)
        if (!gerente.areNotificationsEnabled()) return
        val id = if (chamada) NOTIFICACAO_CHAMADA else 100 + (alvo.hashCode() and 0xffff)
        val aviso = Notification.Builder(contexto, if (chamada) CANAL_CHAMADAS else CANAL_MENSAGENS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle(titulo.take(120))
            .setContentText(texto.take(300))
            .setStyle(Notification.BigTextStyle().bigText(texto.take(1000)))
            .setContentIntent(abrir(contexto, alvo, id))
            .setAutoCancel(true)
            .setCategory(if (chamada) Notification.CATEGORY_CALL else Notification.CATEGORY_MESSAGE)
            .apply { if (chamada) setTimeoutAfter(45_000L).setOngoing(true) }
            .build()
        // Chamada: o toque repete até a notificação sair (atendeu, recusou ou desistiram).
        if (chamada) aviso.flags = aviso.flags or Notification.FLAG_INSISTENT
        gerente.notify(id, aviso)
    }

    fun pararChamada(contexto: Context) {
        contexto.getSystemService(NotificationManager::class.java).cancel(NOTIFICACAO_CHAMADA)
    }

    /** Abriu a conversa no app: as notificações dela saem. */
    fun limpar(contexto: Context, alvo: String) {
        contexto.getSystemService(NotificationManager::class.java).cancel(100 + (alvo.hashCode() and 0xffff))
    }
}
