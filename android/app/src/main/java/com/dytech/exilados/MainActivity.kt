package com.dytech.exilados

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.PictureInPictureParams
import android.content.ActivityNotFoundException
import android.content.res.Configuration
import android.util.Rational
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast

/**
 * O Exilados no celular: o site inteiro dentro do app, como o programa do Windows. O microfone fica liberado para o
 * site, fotos do chat vêm da galeria ou da câmera, vídeos e lives abrem em tela cheia, e links de fora abrem no
 * navegador. Na sala de voz, um serviço com notificação mantém a voz com a tela apagada.
 */
class MainActivity : Activity() {
    private lateinit var raiz: FrameLayout
    private lateinit var web: WebView
    private var telaCheia: View? = null
    private var aoSairDaTelaCheia: WebChromeClient.CustomViewCallback? = null
    private var escolhaDeArquivo: ValueCallback<Array<Uri>>? = null
    private var pedidoDoMicrofone: PermissionRequest? = null
    /** A sala de voz em que a pessoa está (o site avisa), ou null fora da voz. */
    private var salaDaVoz: String? = null
    /** Há live ou tela compartilhada na tela (o site avisa): ao sair do app, ele vira janela flutuante. */
    private var comVideo = false
    /** O app está na frente: os avisos de mensagem e chamada ficam só dentro do site. */
    @Volatile private var naFrente = false
    private val login by lazy { LoginGoogle(this) }
    private val atualizacao by lazy { AtualizacaoApp(this) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        raiz = FrameLayout(this)
        web = WebView(this)
        raiz.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(raiz)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString ExiladosAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        // Fora da tela (tela apagada, outro app na frente), a página continua com prioridade: a voz não pode parar.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        web.addJavascriptInterface(Ponte(), "ExiladosAndroid")
        web.webViewClient = Navegacao()
        web.webChromeClient = Janelas()

        if (estado == null || web.restoreState(estado) == null) web.loadUrl(enderecoInicial(intent))
    }

    private fun enderecoInicial(intent: Intent?) =
        intent?.dataString?.takeIf { Enderecos.doSite(it) } ?: Enderecos.SITE

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Tocou num aviso de mensagem ou chamada: abre a conversa no site (sem recarregar: a voz continua).
        intent.getStringExtra(Avisos.EXTRA_ALVO)?.takeIf { Regex("^[0-9a-f-]{36}$").matches(it) }?.let { alvo ->
            Avisos.limpar(this, alvo)
            web.evaluateJavascript("window.exiladosAbrir && window.exiladosAbrir('$alvo')", null)
            return
        }
        // Um link do Exilados (convite) aberto com o app já aberto; "exilados://abrir" só traz o app para a frente.
        intent.dataString?.takeIf { Enderecos.doSite(it) }?.let { web.loadUrl(it) }
    }

    override fun onSaveInstanceState(estado: Bundle) {
        super.onSaveInstanceState(estado)
        web.saveState(estado)
    }

    // A página não é pausada ao sair da tela (sem web.onPause): a voz e as lives seguem com a tela apagada.
    override fun onResume() {
        super.onResume()
        naFrente = true
        atualizacao.aoVoltar()
    }

    override fun onPause() {
        naFrente = false
        atualizacao.aoSair()
        super.onPause()
    }

    // ---------- janela flutuante (live ou tela compartilhada enquanto se usa outros apps) ----------

    private fun parametrosDaJanela(): PictureInPictureParams {
        val construtor = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        // Do Android 12 em diante, o próprio sistema leva para a janela ao sair do app (com animação).
        if (Build.VERSION.SDK_INT >= 31) construtor.setAutoEnterEnabled(comVideo).setSeamlessResizeEnabled(false)
        return construtor.build()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (comVideo && Build.VERSION.SDK_INT < 31) {
            runCatching { enterPictureInPictureMode(parametrosDaJanela()) }
        }
    }

    override fun onPictureInPictureModeChanged(naJanela: Boolean, configuracao: Configuration) {
        super.onPictureInPictureModeChanged(naJanela, configuracao)
        // Na janela, o site mostra só o vídeo; fora dela, a tela inteira de novo.
        web.evaluateJavascript("window.exiladosJanelaFlutuante && window.exiladosJanelaFlutuante($naJanela)", null)
        atualizacao.emJanelaFlutuante(naJanela)
    }

    @Deprecated("O botão voltar ainda chega aqui com o voltar preditivo desligado.")
    override fun onBackPressed() {
        when {
            telaCheia != null -> sairDaTelaCheia()
            web.canGoBack() -> web.goBack()
            else -> moveTaskToBack(true) // não fecha: quem está na voz continua nela
        }
    }

    override fun onDestroy() {
        if (isFinishing) VozServico.parar(this)
        login.cancelar()
        web.destroy()
        super.onDestroy()
    }

    // ---------- chamado pelo login com Google ----------

    fun voltarDoLogin(endereco: String) = runOnUiThread { web.loadUrl(endereco) }

    fun avisar(texto: String) = runOnUiThread { Toast.makeText(this, texto, Toast.LENGTH_LONG).show() }

    fun abrirFora(endereco: Uri) {
        val esquema = endereco.scheme?.lowercase()
        if (esquema != "https" && esquema != "http" && esquema != "mailto" && esquema != "intent") return
        try {
            startActivity(
                if (esquema == "intent") Intent.parseUri(endereco.toString(), Intent.URI_INTENT_SCHEME).addCategory(Intent.CATEGORY_BROWSABLE).setComponent(null)
                else Intent(Intent.ACTION_VIEW, endereco).addCategory(Intent.CATEGORY_BROWSABLE),
            )
        } catch (e: ActivityNotFoundException) {
            avisar("Nenhum app abre este link.")
        } catch (e: java.net.URISyntaxException) {
            avisar("Link inválido.")
        }
    }

    // ---------- permissões ----------

    private fun temMicrofone() = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun pedirMicrofone(pedido: PermissionRequest) {
        pedidoDoMicrofone?.deny()
        pedidoDoMicrofone = pedido
        val pedir = mutableListOf(Manifest.permission.RECORD_AUDIO)
        // O fone Bluetooth aparece na lista de aparelhos da voz; a notificação "Na sala de voz" precisa de licença.
        if (Build.VERSION.SDK_INT >= 31) pedir += Manifest.permission.BLUETOOTH_CONNECT
        if (Build.VERSION.SDK_INT >= 33) pedir += Manifest.permission.POST_NOTIFICATIONS
        requestPermissions(pedir.toTypedArray(), PEDIDO_MICROFONE)
    }

    override fun onRequestPermissionsResult(codigo: Int, permissoes: Array<out String>, resultados: IntArray) {
        super.onRequestPermissionsResult(codigo, permissoes, resultados)
        if (atualizacao.aoResponderLicenca(codigo)) return
        if (codigo != PEDIDO_MICROFONE) return
        val pedido = pedidoDoMicrofone ?: return
        pedidoDoMicrofone = null
        if (temMicrofone()) {
            pedido.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            // O site avisa "na voz" antes de o microfone ser liberado: o serviço subiu sem ele e, com a tela apagada, o
            // Android mandaria silêncio. Sobe de novo, agora com o microfone.
            salaDaVoz?.let { VozServico.iniciar(this, it, comMicrofone = true) }
        } else {
            pedido.deny()
        }
    }

    @Deprecated("Escolha de arquivo pelo resultado da atividade (sem a biblioteca de compatibilidade).")
    override fun onActivityResult(codigo: Int, resultado: Int, dados: Intent?) {
        super.onActivityResult(codigo, resultado, dados)
        if (codigo != PEDIDO_ARQUIVO) return
        escolhaDeArquivo?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, dados))
        escolhaDeArquivo = null
    }

    // ---------- tela cheia (vídeos, lives e telas compartilhadas) ----------

    private fun sairDaTelaCheia() {
        telaCheia?.let { raiz.removeView(it) }
        telaCheia = null
        barrasDoSistema(visiveis = true)
        aoSairDaTelaCheia?.onCustomViewHidden()
        aoSairDaTelaCheia = null
    }

    @Suppress("DEPRECATION")
    private fun barrasDoSistema(visiveis: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let { if (visiveis) it.show(WindowInsets.Type.systemBars()) else it.hide(WindowInsets.Type.systemBars()) }
        } else {
            window.decorView.systemUiVisibility = if (visiveis) View.SYSTEM_UI_FLAG_VISIBLE
            else View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    private inner class Navegacao : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, pedido: WebResourceRequest): Boolean {
            val endereco = pedido.url.toString()
            Enderecos.loginGoogle(endereco)?.let {
                login.comecar(it)
                return true
            }
            if (Enderecos.doSite(endereco)) return false
            abrirFora(pedido.url)
            return true
        }

        override fun onRenderProcessGone(view: WebView, detalhe: RenderProcessGoneDetail): Boolean {
            // A página caiu (falta de memória): recria a tela em vez de fechar o app.
            recreate()
            return true
        }
    }

    private inner class Janelas : WebChromeClient() {
        override fun onPermissionRequest(pedido: PermissionRequest) = runOnUiThread {
            val audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE
            // pedido.origin é só a origem (https://filabox3d.com.br/), sem o caminho do site.
            if (!Enderecos.origemDoSite(pedido.origin.toString()) || audio !in pedido.resources) {
                pedido.deny()
            } else if (temMicrofone()) {
                pedido.grant(arrayOf(audio))
            } else {
                pedirMicrofone(pedido)
            }
        }

        override fun onShowFileChooser(view: WebView, retorno: ValueCallback<Array<Uri>>, parametros: FileChooserParams): Boolean {
            escolhaDeArquivo?.onReceiveValue(null)
            escolhaDeArquivo = retorno
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(parametros.createIntent(), PEDIDO_ARQUIVO)
                true
            } catch (e: ActivityNotFoundException) {
                escolhaDeArquivo = null
                false
            }
        }

        override fun onShowCustomView(view: View, aoSair: CustomViewCallback) {
            if (telaCheia != null) {
                aoSair.onCustomViewHidden()
                return
            }
            telaCheia = view
            aoSairDaTelaCheia = aoSair
            raiz.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            barrasDoSistema(visiveis = false)
        }

        override fun onHideCustomView() = sairDaTelaCheia()
    }

    /** O que o site chama (window.ExiladosAndroid): sala de voz, vídeo na tela e avisos de mensagem e chamada. */
    private inner class Ponte {
        @JavascriptInterface
        fun voz(ligada: Boolean, sala: String) = runOnUiThread {
            salaDaVoz = if (ligada) sala else null
            if (ligada) VozServico.iniciar(this@MainActivity, sala, temMicrofone()) else VozServico.parar(this@MainActivity)
        }

        /** Aviso de mensagem ("mensagem") ou chamada ("chamada"); com o app na frente, o site já mostrou. */
        @JavascriptInterface
        fun notificar(titulo: String, texto: String, tipo: String, alvo: String) {
            if (naFrente) return
            Avisos.mostrar(this@MainActivity, titulo, texto, tipo == "chamada", alvo)
        }

        @JavascriptInterface
        fun pararChamada() = Avisos.pararChamada(this@MainActivity)

        @JavascriptInterface
        fun video(sim: Boolean) = runOnUiThread {
            comVideo = sim
            runCatching { setPictureInPictureParams(parametrosDaJanela()) }
        }
    }

    private companion object {
        const val PEDIDO_MICROFONE = 1
        const val PEDIDO_ARQUIVO = 2
    }
}
