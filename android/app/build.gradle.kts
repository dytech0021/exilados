plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dytech.exilados"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dytech.exilados"
        minSdk = 26
        targetSdk = 35
        // A cada APK publicado: versionCode sobe de um em um; versionName acompanha a versão do programa do Windows.
        versionCode = 4
        versionName = "1.0.10"
    }

    // A chave que assina o APK fica fora do repositório (ele é público): gerar-apk.ps1 passa o arquivo e a senha
    // pelo ambiente. Sem eles, o release sai sem assinatura e o script recusa.
    signingConfigs {
        val chave = System.getenv("EXILADOS_APK_CHAVE")
        if (!chave.isNullOrEmpty()) {
            create("release") {
                storeFile = file(chave)
                storePassword = System.getenv("EXILADOS_APK_SENHA")
                keyAlias = "exilados"
                keyPassword = System.getenv("EXILADOS_APK_SENHA")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        buildConfig = true
    }
    lint {
        // O aplicativo é só em português e não usa a biblioteca de compatibilidade.
        // ObsoleteSdkInt: o ícone adaptável só é lido na pasta -v26, mesmo com o mínimo já em 26.
        disable += setOf("HardcodedText", "SetTextI18n", "OldTargetApi", "GradleDependency", "AndroidGradlePluginVersion", "ObsoleteSdkInt")
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
