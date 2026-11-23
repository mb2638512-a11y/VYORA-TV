plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vyora.tv"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.vyora.tv"
        minSdk = 21
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.1"
    }

    flavorDimensions += "device"
    productFlavors {
        create("tv") { dimension = "device" }
        create("phone") {
            dimension = "device"
            applicationIdSuffix = ".phone"
        }
    }

    sourceSets {
        getByName("main") {
            manifest.srcFile("AndroidManifest.common.xml")
            java.setSrcDirs(listOf("java"))
            res.setSrcDirs(listOf("res"))
            assets.setSrcDirs(listOf("assets"))
            jniLibs.setSrcDirs(listOf("jniLibs"))
        }
        getByName("tv") {
            manifest.srcFile("AndroidManifest.xml")
        }
        getByName("phone") {
            manifest.srcFile("AndroidManifest.phone.xml")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    buildFeatures { buildConfig = true }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/*.version",
                "META-INF/*.kotlin_module",
                "DebugProbesKt.bin",
                "kotlin-tooling-metadata.json"
            )
        }
    }
}

dependencies {
    // Media3 AARs are bundled locally, so their Guava runtime dependency must be declared explicitly.
    implementation("com.google.guava:guava:33.3.1-android")
    implementation(fileTree(rootProject.file("libs")) {
        include("*.jar", "*.aar")
        // AndroidX annotation is supplied transitively by the modern
        // AndroidX dependencies below; exclude the stale bundled copy.
        exclude("annotation-1.3.0.jar")
    })
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    // DASH sources need the Media3 DASH media-source module at runtime.
    implementation("androidx.media3:media3-exoplayer-dash:1.4.1") { isTransitive = false }
    implementation("com.google.android.material:material:1.13.0")
}
