plugins {
    id("com.android.application")
}

android {
    namespace = "com.zhenshu.client"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.zhenshu.client"
        minSdk = 26
        targetSdk = 35
        versionCode = 9
        versionName = "0.2.5"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK installs directly; a real
            // release key can replace it later (see clients/android/README.md).
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
