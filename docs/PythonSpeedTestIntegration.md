# Python 异步并发探针测速客户端 (Python Asyncio & HTTP Client)

本指南针对**方案二（本地局域网或边缘硬件探针接口）**，提供了一个使用纯 Python 编写的、高并发、异步的 IPTV 线路检测代测脚本。

您可以将本脚本放至家中的软路由、群晖/威联通 NAS、树莓派等硬件中，配合 `cron`/`Task Scheduler` 实现在地化 24 小时全天候无中断测速性能上报。

---

## 1. 所需依赖配置

脚本使用 Python 现代异步高并发库 `aiohttp`，能够在极短时间内不占用过多系统内存资源，并发探查成百上千条直播源。

安装所需的运行库包：
```bash
pip install aiohttp
```

---

## 2. 基础款：异步探针完整脚本代码 (`iptv_probe.py`)

您可以将下方代码另存为 `iptv_probe.py` 并修改头部的 `SERVER_BASE_URL` 环境变量配置：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import time
import logging
import aiohttp

# ==================== [用户自定义参数配置区] ====================
# [1] 直播源系统的远端中枢服务器 URL (不要以 "/" 结尾)
SERVER_BASE_URL = "https://your-iptv-server.com" 

# [2] 本设备的真实物理宽带网络环境属性 (用于上报使之分类合并对齐)
CLIENT_ISP = "中国联通"         # 例如：中国电信, 中国联通, 中国移动, 中国广电
CLIENT_PROVINCE = "北京"       # 例如：浙江, 上海, 广东, 四川

# [3] 测速性能参数
CONCURRENCY_LIMIT = 15        # 限制并发测试管道（最大同时向直播源发包的大小的协程数）
PROBE_TIMEOUT = 2.5           # 每条线路握手超时（秒），保持探针高速
# =============================================================

# 日志输出配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("IPTV_Probe")


async def fetch_channels(session: aiohttp.ClientSession) -> list:
    """从主管理系统云拉取当前所有的电视频道及全部待测试（有效+未测试）播放源线路
    """
    url = f"{SERVER_BASE_URL}/api/channels?status=testable"
    logger.info(f"正在从云端拉取配置列表: {url}")
    try:
        async with session.get(url, timeout=10) as response:
            if response.status != 200:
                logger.error(f"拉取配置失败！HTTP 状态码: {response.status}")
                return []
            return await response.json()
    except Exception as e:
        logger.error(f"网络连接失败，无法拉取电视频道: {e}")
        return []


async def test_single_source(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, source_id: str, channel_id: str, url: str) -> dict:
    """测试单个视频流链路连通性与实际握手时耗
    """
    async with semaphore:
        start_time = time.time()
        status = "inactive"
        latency = 9999

        # 支持 HTTP / HTTPS 各种格式的多线程探测
        try:
            # 使用 GET 快速向源头拉起 302 重定向或握手
            async with session.get(url, timeout=PROBE_TIMEOUT, allow_redirects=True) as response:
                # 无论是 200 还是播放器的 3xx / 4xx 状态码（比如防盗链拦截但服务器有回传），只要其建立了物理 TCP 连接即可判定在线
                if response.status:
                    status = "active"
                    latency = int((time.time() - start_time) * 1000)
        except asyncio.TimeoutError:
            # 超时直接作为失效线路
            status = "inactive"
        except Exception:
            # 其他底层 SSL 或 TCP 握手错误
            status = "inactive"

        return {
            "sourceId": source_id,
            "channelId": channel_id,
            "status": status,
            "latency": latency
        }


async def submit_results(session: aiohttp.ClientSession, results: list) -> int:
    """打包本地探针采集的测试结果并同步上报给主服务器
    """
    url = f"{SERVER_BASE_URL}/api/sources/client-test-results"
    payload = {
        "clientIsp": CLIENT_ISP,
        "clientProvince": CLIENT_PROVINCE,
        "results": results
    }
    
    logger.info(f"正在打包上报 {len(results)} 条底层探测指标到远端网关...")
    try:
        async with session.post(url, json=payload, timeout=15) as response:
            if response.status == 200:
                res_data = await response.json()
                return res_data.get("count", 0)
            else:
                logger.error(f"性能数据回传遭服务器拒绝，HTTP 状态: {response.status}")
                return 0
    except Exception as e:
        logger.error(f"上报数据失败！请检查互联网连接: {e}")
        return 0


async def main():
    logger.info("==============================================")
    logger.info(" IPTV-Probe-Client / Python 本地高并发极星探针 ")
    logger.info("==============================================")

    # 创建全局 TCP 链接器 and Aiohttp Session 会话
    connector = aiohttp.TCPConnector(ssl=False, limit=100)
    async with aiohttp.ClientSession(connector=connector) as session:
        # [步骤一] 拉取当前云端所有的频道线路
        channels = await fetch_channels(session)
        if not channels:
            logger.warning("未能拉取到有效的 IPTV 线路，程序正在退出...")
            return

        # 整理出所有待代测的扁平线路，每个元素存有：(线路唯一ID, 所属频道ID, 串流流媒体URL)
        sources_to_test = []
        for channel in channels:
            channel_id = channel.get("id")
            sources = channel.get("sources", [])
            for src in sources:
                sources_to_test.append((src.get("id"), channel_id, src.get("url")))

        if not sources_to_test:
            logger.warning("频道列表中尚无任何可测试的线路，请先去后台添加播放线路")
            return

        logger.info(f"成功提取共计 {len(sources_to_test)} 条物理流。已开启最大 {CONCURRENCY_LIMIT} 线程深度协程探测中...")

        # [步骤二] 开启并发协程组任务，并执行测速
        semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
        tasks = [
            test_single_source(session, semaphore, src_id, ch_id, url)
            for src_id, ch_id, url in sources_to_test
        ]
        
        # 搜集运行并发组
        probe_results = await asyncio.gather(*tasks)

        # 统计得出本地活跃状态占比
        active_count = sum(1 for r in probe_results if r["status"] == "active")
        logger.info(f"并发深度侧写完成。其中物理可用线路为: {active_count} 条，不可到达故障线路: {len(probe_results) - active_count} 条")

        # [步骤三] 一键将结果反馈包上报
        updated_count = await submit_results(session, probe_results)
        logger.info(f"【完工】全域测速闭环结束！服务器数据库中已同步合并热修正并生效了 {updated_count} 条线路状态")


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 3. 进阶版：联动 FFplay/FFmpeg 的“二段式”深度探针测速脚本 (`iptv_probe_v2.py`)

单纯通过 HTTP 请求或 TCP 连接发起测试有时会产生“假在线”信号。例如对端地址虽然开着端口（TCP 通畅），但其实视频源早已切断，或者属于需要底层解码库验证的特殊流媒体（如 **RTSP / RTMP / TS 多播流**）。

本脚本实现了**二段式深度验证**（Two-Phase Stream Verification）：
- **第一阶段（快速过滤）**：通过异步轻量级 TCP 端口（适用于 RTSP）或 HTTP 头部/状态检测（适用于 HTTP 播放源），秒级快速过滤掉无法接通的离线死链。
- **第二阶段（黄金解码测试）**：脚本会自动扫描本地系统环境。如果发现了 `ffplay`、`ffmpeg` 或是 `ffprobe` 工具，将使用它对第一阶段留存的优质线路发起 **2 秒的真机帧拉流拉去与解码验证**。只有解码成功、真实含有音视频轨的链路才算真正“活跃 (Active)”，并记录精准的首帧建立耗时！

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import time
import logging
import shutil
import urllib.parse
import socket
import aiohttp

# ==================== [用户自定义参数配置区] ====================
# [1] 直播源系统的远端中枢服务器 URL (不要以 "/" 结尾)
SERVER_BASE_URL = "https://your-iptv-server.com" 

# [2] 本设备的真实物理宽带网络环境属性
CLIENT_ISP = "中国联通"         
CLIENT_PROVINCE = "北京"       

# [3] 测速性能参数
CONCURRENCY_LIMIT = 10        # 第 1 阶段轻量并发测试管通道限制数
PHASE_I_TIMEOUT = 2.5         # 第 1 阶段极速网络超时限制（秒）
PHASE_II_DECODE_SEC = 2       # 第 2 阶段 ffplay/ffmpeg 实际解码读流帧限制（秒）
# =============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("TwoPhaseProbe")


def detect_ff_player():
    """检测系统 PATH 环境变量中是否存在 ffplay、ffmpeg 或 ffprobe 工件
    """
    ffplay_path = shutil.which("ffplay")
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")

    if ffplay_path:
        logger.info(f"🟢 成功匹配到硬件播放引擎: ffplay -> {ffplay_path}")
        return {"type": "ffplay", "cmd": ffplay_path}
    elif ffmpeg_path:
        logger.info(f"🟢 匹配到后台解编码核心: ffmpeg -> {ffmpeg_path}")
        return {"type": "ffmpeg", "cmd": ffmpeg_path}
    elif ffprobe_path:
        logger.info(f"🟢 匹配到流媒体属性提取器: ffprobe -> {ffprobe_path}")
        return {"type": "ffprobe", "cmd": ffprobe_path}
    else:
        logger.warning("🟡 系统中未发现 ffplay/ffmpeg/ffprobe 依赖。探测将退化为纯 TCP / HTTP 握手嗅探模式。")
        return None


async def phase_1_network_check(session: aiohttp.ClientSession, url: str) -> tuple:
    """第一阶段二段式检测：执行极速连接测试（区分 HTTP 和 RTSP 协议）
    """
    start_time = time.time()
    
    # 针对 RTSP 协议直播源线路，使用底层 TCP Socket 发起快速端口连通性验证
    if url.lower().startswith("rtsp://"):
        try:
            parsed = urllib.parse.urlparse(url)
            host = parsed.hostname
            port = parsed.port or 554
            if not host:
                return False, 9999
            
            # 使用 asyncio 异步开启底层 socket 物理通道
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port),
                timeout=PHASE_I_TIMEOUT
            )
            writer.close()
            await writer.wait_closed()
            
            latency = int((time.time() - start_time) * 1000)
            return True, latency
        except Exception:
            return False, 9999
            
    # 针对普通 HTTP / HTTPS 或 HLS / M3U8 直播源，使用轻量请求
    else:
        try:
            async with session.get(url, timeout=PHASE_I_TIMEOUT, allow_redirects=True) as response:
                # 凡是能正常握手响应建立 Socket 通道的均代表第一段通过
                if response.status:
                    latency = int((time.time() - start_time) * 1050)
                    return True, latency
        except Exception:
            pass
        return False, 9999


async def phase_2_decode_check(ff_engine: dict, url: str) -> tuple:
    """第二阶段二段式检测：驱动 FFmpeg 工件，进行 2 秒实际拉流与解码验证，杜绝一切“假在线”流
    """
    start_time = time.time()
    cmd = []
    
    if ff_engine["type"] == "ffplay":
        # -nodisp (不弹出 GUI 窗口画面) -autoexit (播放结束后自动结束) -t 限制视频拉流秒数
        cmd = [
            ff_engine["cmd"], "-nodisp", "-autoexit", "-loglevel", "error", 
            "-t", str(PHASE_II_DECODE_SEC), url
        ]
    elif ff_engine["type"] == "ffmpeg":
        # ffmpeg 校验最严密，-f null - 代表空画面输出，专门用于吞吐评估流健康度
        cmd = [
            ff_engine["cmd"], "-y", "-loglevel", "error", "-t", str(PHASE_II_DECODE_SEC),
            "-i", url, "-f", "null", "-"
        ]
    elif ff_engine["type"] == "ffprobe":
        cmd = [
            ff_engine["cmd"], "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1", url
        ]

    try:
        # 异步启动子进程，避免阻塞主测速线程事件循环
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        # 给解码器宽限额外的拉流超时时长
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), 
                timeout=PHASE_II_DECODE_SEC + 3.0
            )
            # 子进程正常退出且退出码为 0 代表媒体解析完全通过，流极度纯净健康!
            if process.returncode == 0:
                latency = int((time.time() - start_time) * 1000)
                return True, latency
        except asyncio.TimeoutError:
            try:
                process.kill()
            except Exception:
                pass
            
    except Exception as e:
        logger.debug(f"解码进程调度异常: {e}")
        
    return False, 9999


async def process_test_pipeline(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, ff_engine: dict, source_id: str, channel_id: str, url: str) -> dict:
    """一条线路完整的二段式调度管道
    """
    async with semaphore:
        # [阶段 1] 快速网关探针
        p1_ok, p1_latency = await phase_1_network_check(session, url)
        
        # 如果第一段就彻底无法连通，不用浪费系统进程去跑二段解码
        if not p1_ok:
            return {
                "sourceId": source_id,
                "channelId": channel_id,
                "status": "inactive",
                "latency": 9999
            }
            
        # [阶段 2] 精深多媒体解码校验 (仅在本地存在 FFmpeg 工具时执行)
        if ff_engine:
            logger.info(f" 🔍 [Phase 1 通行] 对链路 {url[:45]}... 触发 Phase 2 视频帧解码质检...")
            p2_ok, p2_latency = await phase_2_decode_check(ff_engine, url)
            if p2_ok:
                logger.info(f"  🎉 [质检通过] 解码顺畅，首帧延迟(建立耗时) - {p2_latency}ms")
                return {
                    "sourceId": source_id,
                    "channelId": channel_id,
                    "status": "active",
                    "latency": p2_latency
                }
            else:
                logger.warning(f"  ❌ [质检失败] {url[:45]}... 能连接端口但无法提取播放帧，归类为不可用")
                return {
                    "sourceId": source_id,
                    "channelId": channel_id,
                    "status": "inactive",
                    "latency": 9999
                }
        else:
            # 如果本地无 FF 家族解码器，测速结果直接信任基于第一阶段轻量握手的延迟数据
            return {
                "sourceId": source_id,
                "channelId": channel_id,
                "status": "active",
                "latency": p1_latency
            }


async def main():
    logger.info("=============================================================")
    logger.info(" IPTV-TwoPhase-Probe / 联动机顶盒 FFplay 硬件编解码二段测速器 ")
    logger.info("=============================================================")

    # 首要物理扫描底层依赖
    ff_engine = detect_ff_player()

    connector = aiohttp.TCPConnector(ssl=False, limit=50)
    async with aiohttp.ClientSession(connector=connector) as session:
        # 拉取在中枢配置的所有待测线路（有效+未测试，过滤掉已知失效死链）
        url = f"{SERVER_BASE_URL}/api/channels?status=testable"
        logger.info(f"正在从云端拉取配置列表: {url}")
        try:
            async with session.get(url, timeout=10) as resp:
                if resp.status != 200:
                    logger.error(f"拉取失败 HTTP: {resp.status}")
                    return
                channels = await resp.json()
        except Exception as e:
            logger.error(f"无法拉取配置: {e}")
            return

        sources_to_test = []
        for channel in channels:
            ch_id = channel.get("id")
            for src in channel.get("sources", []):
                sources_to_test.append((src.get("id"), ch_id, src.get("url")))

        if not sources_to_test:
            logger.warning("中枢系统上尚无可测试物理流线路。")
            return

        logger.info(f"成功导入 {len(sources_to_test)} 条线路。下发多通道多协程测速中...")

        # 启动一二段管道模型
        semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
        tasks = [
            process_test_pipeline(session, semaphore, ff_engine, src_id, ch_id, url)
            for src_id, ch_id, url in sources_to_test
        ]
        
        # 搜集整体反馈
        final_reports = await asyncio.gather(*tasks)

        # 打包回传给主服务器，数据库将根据上报数据进行持久化和前端更新
        active_count = sum(1 for r in final_reports if r["status"] == "active")
        logger.info(f"=== 百川归海 · 测速测写完毕 ===")
        logger.info(f"通过多维度校验之完美源: {active_count} 条 | 弃用黑库源: {len(final_reports) - active_count} 条")

        # 提交上报
        report_url = f"{SERVER_BASE_URL}/api/sources/client-test-results"
        payload = {
            "clientIsp": CLIENT_ISP,
            "clientProvince": CLIENT_PROVINCE,
            "results": final_reports
        }
        try:
            async with session.post(report_url, json=payload, timeout=20) as post_resp:
                if post_resp.status == 200:
                    res_body = await post_resp.json()
                    logger.info(f"🚀 【数据完全落地】回传在云端服务器重洗成功！热生效数量: {res_body.get('count', 0)} 条")
                else:
                    logger.error(f"上报被拒绝，HTTP: {post_resp.status}")
        except Exception as ex:
            logger.error(f"回传网络中断: {ex}")


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 4. 部署与定时更新策略

### 安装 FFmpeg/FFplay
- **Ubuntu/Debian 软路由**：
  ```bash
  sudo apt update
  sudo apt install ffmpeg -y
  ```
- **macOS (通过 Homebrew)**：
  ```bash
  brew install ffmpeg
  ```
- **Windows (通过 Scoop 或手动官网下载解压配置 PATH 环境变量)**：
  ```powershell
  scoop install ffmpeg
  ```

配置完毕后，只需一行命令即可定时运行：
```bash
python3 iptv_probe_v2.py
```
本二段式脚本在提供极速探测的同时，通过本地宿主的解码流程最大化保障了电视直播流源的连通质量！
