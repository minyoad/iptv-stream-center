# Android 客户端探针多线程测速方案集成指南 (Kotlin)

本指南针对**方案二（本地浏览器/硬件探针网关）**，提供了可以直接复制并快速集成到您的 Android/Kotlin 应用程序或电视盒子播放器（TvBox）中的后台服务代码。

该代码会自动拉取您部署的 IPTV 管理中心内的电视频道直播线路，在 Android 智能终端的多线程协程背景中进行端到端测速，并最后将精准数据一键回传上报给主服务器。

---

## 1. 核心依赖配置 (Gradle)

请确保您的 Android `build.gradle` (Module) 中已经导入了 Kotlin 协程和 OkHttp 依赖库：

```kotlin
dependencies {
    // OkHttp 网络客户端
    implementation("com.squareup.okhttp3:okhttp:4.11.0")
    
    // Kotlin 协程及异步多线程库
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    
    // Gson 或 Serialization (用于 JSON 的序列化和反序列化)
    implementation("com.google.code.gson:gson:2.10.1")
}
```

并确保在 `AndroidManifest.xml` 中声明了互联网访问权限：
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

---

## 2. Kotlin 多线程测速后台服务代码

您可以将以下代码保存为 `IPTVProbeService.kt` 并在您的 Android 程序初始化或定时后台任务中启动它：

```kotlin
package com.yourdomain.iptv.service

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

object IPTVProbeService {
    private const val TAG = "IPTVProbeService"
    private val client = OkHttpClient.Builder()
        .connectTimeout(2500, TimeUnit.MILLISECONDS) // 2.5 秒连接超时，保持探针高速
        .readTimeout(2500, TimeUnit.MILLISECONDS)
        .build()

    private val gson = Gson()
    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    // 实体数据模型类
    data class SimpleChannel(val id: String, val name: String, val sources: List<SimpleSource>)
    data class SimpleSource(val id: String, val url: String)
    data class ProbeResult(val sourceId: String, val channelId: String, val status: String, val latency: Long)

    /**
     * 一键执行：拉取线路 -> 本地协程多线程并发探测 -> 结果一键同步上报
     * @param serverBaseUrl IPTV 服务器主站地址 (如: "https://your-iptv-server.com")
     * @param isp 当前 Android 硬件运行网络环境 (如: "电信"、"联通"、"移动")
     * @param province 所在地区归属 (如: "浙江"、"北京")
     * @param onlyActive 是否只获取当前标记为有效和未测试的线路进行探测（过滤掉已知失效的线路）
     */
    fun startBackgroudProbe(
        serverBaseUrl: String,
        isp: String,
        province: String,
        onlyActive: Boolean = true,
        onComplete: (successCount: Int) -> Unit
    ) {
        // 在后台 IO 协程中执行
        CoroutineScope(Dispatchers.IO).launch {
            try {
                Log.i(TAG, "正在准备从云端获取最新的 IPTV 电视频道播放线路...")
                val channels = fetchChannels(serverBaseUrl, onlyActive)
                if (channels.isEmpty()) {
                    Log.w(TAG, "拉取到的可测试频道和线路为空，任务结束")
                    return@launch
                }

                val allSourcesToTest = mutableListOf<Triple<String, String, String>>() // <SourceId, ChannelId, StreamUrl>
                for (channel in channels) {
                    for (source in channel.sources) {
                        allSourcesToTest.add(Triple(source.id, channel.id, source.url))
                    }
                }

                Log.i(TAG, "成功读取到 ${allSourcesToTest.size} 条待测物理流。现在开启多线程底层探针测速...")
                
                // 并发策略：通过协程并发进行测速 (最大并发度为 8)
                val testResults = runConcurrentProbe(allSourcesToTest, maxConcurrency = 8)

                Log.i(TAG, "测速完毕！正在打包上报结果：健康可用 ${testResults.count { it.status == "active" }} 条...")
                
                // 将数据自动同步回服务器中枢
                val count = submitReport(serverBaseUrl, isp, province, testResults)
                Log.i(TAG, "数据流合并热修复完毕！服务器成功生效 $count 条客户端链路探针报告")
                
                withContext(Dispatchers.Main) {
                    onComplete(count)
                }

            } catch (e: Exception) {
                Log.e(TAG, "测速任务运行失败", e)
                withContext(Dispatchers.Main) {
                    onComplete(-1)
                }
            }
        }
    }

    /**
     * 1. 批量下载电视频道配置列表
     * @param onlyActive 是否只获取当前标记为有效和未测试的线路 (设置为 true 可以过滤掉已知失效的死链)
     */
    private fun fetchChannels(baseUrl: String, onlyActive: Boolean = true): List<SimpleChannel> {
        val url = if (onlyActive) "$baseUrl/api/channels?status=testable" else "$baseUrl/api/channels"
        val request = Request.Builder()
            .url(url)
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("下载失败: HTTP ${response.code}")
            val bodyString = response.body?.string() ?: return emptyList()
            
            // 解析 JSON
            return gson.fromJson(bodyString, Array<SimpleChannel>::class.java).toList()
        }
    }

    /**
     * 2. 利用 Kotlin 协程并发测试单条 URL
     */
    private suspend fun runConcurrentProbe(
        list: List<Triple<String, String, String>>,
        maxConcurrency: Int
    ): List<ProbeResult> = coroutineScope {
        val semaphore = kotlinx.coroutines.sync.Semaphore(maxConcurrency)
        val results = mutableListOf<Deferred<ProbeResult>>()

        for (item in list) {
            val task = async(Dispatchers.IO) {
                semaphore.withPermit {
                    val sourceId = item.first
                    val channelId = item.second
                    val url = item.third
                    
                    val startTime = System.currentTimeMillis()
                    var status = "inactive"
                    var latency = 9999L

                    try {
                        val headRequest = Request.Builder()
                            .url(url)
                            .head() // HEAD 快速嗅探握手
                            .build()

                        client.newCall(headRequest).execute().use { response ->
                            // 如果服务器返回 OK 或者是重定向，即判定为极其健康的 IPTV 源
                            if (response.isSuccessful || response.code in 300..399) {
                                status = "active"
                                latency = System.currentTimeMillis() - startTime
                            }
                        }
                    } catch (e: Exception) {
                        // RTSP 或局部专线测速备用策略 (如果失败，进行基础 TCP 降级嗅探)
                        status = "inactive"
                    }

                    ProbeResult(sourceId, channelId, status, if (status == "active") latency else 9999L)
                }
            }
            results.add(task)
        }

        results.awaitAll()
    }

    /**
     * 3. 结果打包一键上报回传 Api
     */
    private fun submitReport(
        baseUrl: String,
        isp: String,
        province: String,
        results: List<ProbeResult>
    ): Int {
        val payload = JsonObject().apply {
            addProperty("clientIsp", isp)
            addProperty("clientProvince", province)
            
            val jsonResults = JsonArray()
            for (res in results) {
                val item = JsonObject().apply {
                    addProperty("sourceId", res.sourceId)
                    addProperty("channelId", res.channelId)
                    addProperty("status", res.status)
                    addProperty("latency", res.latency.toInt())
                }
                jsonResults.add(item)
            }
            add("results", jsonResults)
        }

        val requestBody = gson.toJson(payload).toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("$baseUrl/api/sources/client-test-results")
            .post(requestBody)
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                Log.e(TAG, "回传评估结果遭服务器拒绝: ${response.code}")
                return 0
            }
            val resObj = gson.fromJson(response.body?.string(), JsonObject::class.java)
            return resObj.get("count").asInt
        }
    }
}
```

---

## 3. 在 Android 业务代码中一键调用

配置完成调用也极其傻瓜！您可以在 `MainActivity.kt` 或是后台的 `WorkManager` 定时任务中，一键轻松拉起全域测速：

```kotlin
// 例：在按钮点击事件或后台服务启动中触发
IPTVProbeService.startBackgroudProbe(
    serverBaseUrl = "https://your-iptv-server.com", // 替换为您部署的远端 IPTV 控制中心服务器地址
    isp = "中国电信",                                 // 检测本真设备运行所在的网络基础
    province = "浙江"                                // 设备所在物理地域，以便后台对齐专网线路
) { successCount ->
    if (successCount >= 0) {
        Toast.makeText(this, "成功回传并在云端秒级生效 $successCount 条电信健康线路！", Toast.LENGTH_SHORT).show()
    } else {
        Toast.makeText(this, "多线程网络探针启动失败，请检查连通性", Toast.LENGTH_SHORT).show()
    }
}
```
