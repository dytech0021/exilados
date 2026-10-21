package com.dytech.exilados

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Atualização do app pelo servidor do Exilados (android.json e Exilados.apk em /exilados/atualizacao/). A versão nova é
 * procurada e baixada sem atrapalhar (ao abrir e a cada 30 minutos com o app aberto); pronta, aparece um aviso no alto
 * ("Atualizar" / "Depois"). Tocando, o app se instala (do Android 12 em diante sem a tela do instalador, depois da
 * primeira vez) e fecha; a versão nova avisa por notificação, porque o Android não deixa um app se abrir sozinho.
 */
class AtualizacaoApp(private val atividade: MainActivity) {
    private val principal = Handler(Looper.getMainLooper())
    private val aviso = Aviso()
    private var naFrente = false
    private var esperandoLicenca = false
    private var procurando = false
    private var pronta: Atualizacao? = null
    private var dispensada = 0
    private var instalando = false
    private val periodica = object : Runnable {
        override fun run() {
            if (!naFrente) return
            procurar()
            principal.postDelayed(this, INTERVALO_MS)
        }
    }

    fun aoVoltar() {
        naFrente = true
        if (esperandoLicenca && podeInstalar()) {
            esperandoLicenca = false
            instalar()
        }
        principal.removeCallbacks(periodica)
        principal.post(periodica)
        mostrarAviso()
    }

    fun aoSair() {
        naFrente = false
        principal.removeCallbacks(periodica)
    }

    /** A resposta ao pedido de notificação (para avisar "atualizado"): a instalação segue com ou sem ela. */
    fun aoResponderLicenca(codigo: Int): Boolean {
        if (codigo != PEDIDO_NOTIFICACAO) return false
        instalar()
        return true
    }

    private fun procurar() {
        if (procurando || instalando) return
        val agora = System.currentTimeMillis()
        val prefs = atividade.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (pronta == null && agora - prefs.getLong(ULTIMA_PROCURA, 0) < INTERVALO_MS) return
        prefs.edit().putLong(ULTIMA_PROCURA, agora).apply()
        procurando = true
        val contexto = atividade.applicationContext
        thread(name = "exilados-atualizacao") {
            val resultado = runCatching {
                val nova = Atualizacao.ler(baixarTexto("${BASE}android.json"), BuildConfig.VERSION_CODE) ?: return@runCatching null
                val apk = arquivo(contexto)
                if (!(apk.isFile && nova.confere(apk.readBytes()))) {
                    apk.parentFile?.mkdirs()
                    baixarArquivo("${BASE}Exilados.apk", apk, nova)
                }
                conferirPacote(contexto, apk, nova)?.let { throw IllegalStateException(it) }
                nova
            }
            principal.post {
                procurando = false
                resultado.getOrNull()?.let {
                    pronta = it
                    mostrarAviso()
                }
            }
        }
    }

    private fun mostrarAviso() {
        val nova = pronta
        when {
            nova == null || atividade.isFinishing -> aviso.esconder()
            instalando -> aviso.mostrar("Instalando a versão ${nova.versionName}... O Exilados vai fechar e avisar quando terminar.", acao = false)
            dispensada == nova.versionCode -> aviso.esconder()
            else -> aviso.mostrar("Nova versão do Exilados: ${nova.versionName}", acao = true)
        }
    }

    private fun podeInstalar() = atividade.packageManager.canRequestPackageInstalls()

    private fun perguntar() {
        val nova = pronta ?: return
        if (!VozServico.ativo) return instalar()
        AlertDialog.Builder(atividade)
            .setTitle("Atualizar o Exilados")
            .setMessage("O app fecha para instalar a versão ${nova.versionName}, e você sai da sala de voz. Depois é só abrir pelo aviso e entrar de novo.")
            .setPositiveButton("Atualizar") { _, _ -> instalar() }
            .setNegativeButton("Depois", null)
            .show()
    }

    // A marca de "atualização pedida aqui" é gravada na hora (commit): o Android encerra o app logo em seguida.
    @SuppressLint("ApplySharedPref")
    private fun instalar() {
        val nova = pronta ?: return
        if (instalando) return
        if (!podeInstalar()) {
            AlertDialog.Builder(atividade)
                .setTitle("Permitir a atualização")
                .setMessage("Para se atualizar, o Exilados precisa da permissão para instalar apps. Na tela que vai abrir, ligue \"Permitir desta fonte\" e volte ao Exilados.")
                .setPositiveButton("Abrir") { _, _ ->
                    esperandoLicenca = true
                    atividade.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${atividade.packageName}")))
                }
                .setNegativeButton("Cancelar", null)
                .show()
            return
        }
        // O aviso "atualizado, toque para abrir" precisa de licença do Android 13 em diante: pedida uma vez.
        val prefs = atividade.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= 33 && !AtualizadoReceiver.notificacoesLiberadas(atividade) && !prefs.getBoolean(PEDIU_NOTIFICACAO, false)) {
            prefs.edit().putBoolean(PEDIU_NOTIFICACAO, true).apply()
            atividade.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), PEDIDO_NOTIFICACAO)
            return
        }
        instalando = true
        mostrarAviso()
        val contexto = atividade.applicationContext
        thread(name = "exilados-instalacao") {
            val problema = try {
                val apk = arquivo(contexto)
                conferirPacote(contexto, apk, nova) ?: run {
                    prefs.edit().putLong(AtualizadoReceiver.PEDIDA_EM, System.currentTimeMillis()).commit()
                    entregarAoInstalador(contexto, apk)
                    null
                }
            } catch (e: Exception) {
                "A instalação não começou: ${e.message ?: e.javaClass.simpleName}."
            }
            if (problema != null) principal.post {
                instalando = false
                mostrarAviso()
                if (atividade.isDestroyed) return@post
                AlertDialog.Builder(atividade)
                    .setMessage("$problema Você pode baixar o app de novo pelo navegador.")
                    .setPositiveButton("Baixar") { _, _ -> atividade.abrirFora(Uri.parse("${BASE}Exilados.apk")) }
                    .setNegativeButton("Fechar", null)
                    .show()
            }
        }
    }

    /** O aviso no alto da tela: "Atualizar" instala; "Depois" esconde até a próxima versão. */
    private inner class Aviso {
        private var cartao: LinearLayout? = null
        private var texto: TextView? = null
        private var botoes: List<View> = emptyList()

        private fun dp(valor: Int) = (valor * atividade.resources.displayMetrics.density).toInt()

        private fun criar(): LinearLayout {
            val rotulo = TextView(atividade).apply {
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            }
            val depois = TextView(atividade).apply {
                text = "Depois"
                setTextColor(0xCCFFFFFF.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                gravity = Gravity.CENTER
                minHeight = dp(40)
                setPadding(dp(12), 0, dp(12), 0)
                setOnClickListener {
                    pronta?.let { dispensada = it.versionCode }
                    mostrarAviso()
                }
            }
            val atualizar = Button(atividade).apply {
                text = "Atualizar"
                isAllCaps = false
                setTextColor(Color.WHITE)
                background = GradientDrawable().apply {
                    setColor(0xFF23A55A.toInt())
                    cornerRadius = dp(8).toFloat()
                }
                minHeight = dp(40)
                setPadding(dp(16), 0, dp(16), 0)
                setOnClickListener { perguntar() }
            }
            val caixa = LinearLayout(atividade).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16), dp(8), dp(8), dp(8))
                background = GradientDrawable().apply {
                    setColor(0xF22B2D31.toInt())
                    cornerRadius = dp(12).toFloat()
                }
                elevation = dp(6).toFloat()
                addView(rotulo, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(depois, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                addView(atualizar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            }
            val posicao = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP).apply {
                leftMargin = dp(12)
                rightMargin = dp(12)
                topMargin = dp(8)
            }
            atividade.findViewById<FrameLayout>(android.R.id.content).addView(caixa, posicao)
            cartao = caixa
            texto = rotulo
            botoes = listOf(depois, atualizar)
            return caixa
        }

        fun mostrar(mensagem: String, acao: Boolean) {
            val caixa = cartao ?: criar()
            texto?.text = mensagem
            botoes.forEach { it.visibility = if (acao) View.VISIBLE else View.GONE }
            caixa.visibility = View.VISIBLE
            caixa.bringToFront()
        }

        fun esconder() {
            cartao?.visibility = View.GONE
        }
    }

    companion object {
        private const val BASE = "https://filabox3d.com.br/exilados/atualizacao/"
        private const val INTERVALO_MS = 30 * 60 * 1000L
        private const val PREFS = "exilados"
        private const val ULTIMA_PROCURA = "ultimaProcuraAtualizacao"
        private const val PEDIU_NOTIFICACAO = "pediuNotificacaoAtualizacao"
        const val PEDIDO_NOTIFICACAO = 41

        fun arquivo(contexto: Context) = File(contexto.cacheDir, "atualizacao/Exilados.apk")

        private fun abrir(endereco: String): HttpURLConnection =
            (URL(endereco).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                useCaches = false
                setRequestProperty("Cache-Control", "no-cache")
            }

        private fun baixarTexto(endereco: String): String {
            val conexao = abrir(endereco)
            try {
                require(conexao.responseCode == 200) { "O servidor respondeu ${conexao.responseCode}." }
                return conexao.inputStream.use { it.readBytes() }.also { require(it.size <= 8192) }.toString(Charsets.UTF_8)
            } finally {
                conexao.disconnect()
            }
        }

        private fun baixarArquivo(endereco: String, destino: File, nova: Atualizacao) {
            val conexao = abrir(endereco)
            try {
                require(conexao.responseCode == 200) { "O servidor respondeu ${conexao.responseCode}." }
                val bytes = conexao.inputStream.use { entrada ->
                    val saida = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(16384)
                    while (true) {
                        val lidos = entrada.read(buffer)
                        if (lidos < 0) break
                        saida.write(buffer, 0, lidos)
                        require(saida.size() <= nova.size) { "O download veio maior que o anunciado." }
                    }
                    saida.toByteArray()
                }
                require(nova.confere(bytes)) { "O download não confere com o anunciado." }
                destino.writeBytes(bytes)
            } catch (e: Exception) {
                destino.delete()
                throw e
            } finally {
                conexao.disconnect()
            }
        }

        // O arquivo tem de ser o Exilados, na versão anunciada, assinado com o mesmo certificado do instalado.
        private fun conferirPacote(contexto: Context, apk: File, nova: Atualizacao): String? {
            val gerente = contexto.packageManager
            val candidato = gerente.getPackageArchiveInfo(apk.path, PacoteAtualizacao.FLAGS)
            val instalado = gerente.getPackageInfo(contexto.packageName, PacoteAtualizacao.FLAGS)
            if (candidato == null || PacoteAtualizacao.codigo(candidato) != nova.versionCode.toLong() || !PacoteAtualizacao.compativel(instalado, candidato)) {
                apk.delete()
                return "O arquivo recebido não é uma versão mais nova do Exilados assinada com a mesma chave, e foi descartado."
            }
            return null
        }

        /**
         * Entrega o APK ao Android numa sessão de instalação. Do Android 12 em diante, um app que se atualiza (e declara
         * UPDATE_PACKAGES_WITHOUT_USER_ACTION) dispensa a confirmação; senão, a resposta traz a tela de confirmação,
         * que AtualizacaoActivity abre.
         */
        private fun entregarAoInstalador(contexto: Context, apk: File) {
            val instalador = contexto.packageManager.packageInstaller
            val parametros = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(contexto.packageName)
                setSize(apk.length())
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            val id = instalador.createSession(parametros)
            try {
                instalador.openSession(id).use { sessao ->
                    apk.inputStream().use { entrada ->
                        sessao.openWrite("Exilados.apk", 0, apk.length()).use { saida ->
                            entrada.copyTo(saida)
                            sessao.fsync(saida)
                        }
                    }
                    val resposta = PendingIntent.getActivity(
                        contexto, id, Intent(contexto, AtualizacaoActivity::class.java),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                    )
                    sessao.commit(resposta.intentSender)
                }
            } catch (e: Exception) {
                instalador.abandonSession(id)
                throw e
            }
        }
    }
}
