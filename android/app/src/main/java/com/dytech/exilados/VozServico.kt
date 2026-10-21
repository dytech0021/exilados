package com.dytech.exilados

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Enquanto a pessoa está numa sala de voz: notificação "Na sala de voz" (como o Discord) e o Android não para o app
 * com a tela apagada. Também segura o processador e o Wi-Fi acordados, senão a voz picota.
 */
class VozServico : Service() {
    private var processador: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ativo = true
        val sala = intent?.getStringExtra(EXTRA_SALA).orEmpty()
        val comMicrofone = intent?.getBooleanExtra(EXTRA_MICROFONE, false) ?: false
        val gerente = getSystemService(NotificationManager::class.java)
        gerente.createNotificationChannel(NotificationChannel(CANAL, "Sala de voz", NotificationManager.IMPORTANCE_LOW))
        val abrir = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val aviso = Notification.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle("Na sala de voz")
            .setContentText(if (sala.isEmpty()) "Exilados" else "$sala · Exilados")
            .setContentIntent(abrir)
            .setOngoing(true)
            .build()
        // O microfone só entra no tipo do serviço com a licença dada (quem entrou só ouvindo fica com "mídia"); o tipo
        // microfone existe do Android 11 em diante.
        when {
            Build.VERSION.SDK_INT >= 30 -> startForeground(
                NOTIFICACAO, aviso,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK or (if (comMicrofone) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0),
            )
            Build.VERSION.SDK_INT >= 29 -> startForeground(NOTIFICACAO, aviso, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            else -> startForeground(NOTIFICACAO, aviso)
        }

        if (processador == null) {
            processador = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "exilados:voz").apply { acquire(6 * 60 * 60 * 1000L) }
        }
        if (wifi == null) {
            @Suppress("DEPRECATION")
            wifi = applicationContext.getSystemService(WifiManager::class.java)
                .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "exilados:voz").apply { acquire() }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        ativo = false
        processador?.let { if (it.isHeld) it.release() }
        wifi?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    companion object {
        /** A pessoa está numa sala de voz (a atualização pergunta antes de fechar o app). */
        @Volatile var ativo = false
            private set
        private const val CANAL = "voz"
        private const val NOTIFICACAO = 1
        private const val EXTRA_SALA = "sala"
        private const val EXTRA_MICROFONE = "microfone"

        fun iniciar(contexto: Context, sala: String, comMicrofone: Boolean) {
            val intent = Intent(contexto, VozServico::class.java).putExtra(EXTRA_SALA, sala).putExtra(EXTRA_MICROFONE, comMicrofone)
            runCatching { contexto.startForegroundService(intent) }
        }

        fun parar(contexto: Context) {
            contexto.stopService(Intent(contexto, VozServico::class.java))
        }
    }
}
