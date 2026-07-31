#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import time
import logging
import shutil
import urllib.parse
import socket
import ssl
import aiohttp

# ==================== [用户自定义参数配置区] ====================
# [1] 直播源系统的远端中枢服务器 URL (不要以 "/" 结尾)
SERVER_BASE_URL = "https://iptvs.mybacc.com" 

# [2] 本设备的真实物理宽带网络环境属性
CLIENT_ISP = "AUTO"         
CLIENT_PROVINCE = "AUTO"       

# [3] 测速性能参数
CONCURRENCY_LIMIT = 10        # 第 1 阶段轻量并发测试管通道限制数
PHASE_I_TIMEOUT = 2.5         # 第 1 阶段极速网络超时限制（秒）
PHASE_II_DECODE_SEC = 5       # 第 2 阶段 ffplay/ffmpeg 实际解码读流帧限制（秒）
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

    # 根据用户反馈，优先使用 ffprobe 以降低误报率，它速度更快且容忍度更高
    if ffprobe_path:
        logger.info(f"🟢 匹配到流媒体属性提取器 (快速首选): ffprobe -> {ffprobe_path}")
        return {"type": "ffprobe", "cmd": ffprobe_path}
    elif ffplay_path:
        logger.info(f"🟢 成功匹配到硬件播放引擎: ffplay -> {ffplay_path}")
        return {"type": "ffplay", "cmd": ffplay_path}
    elif ffmpeg_path:
        logger.info(f"🟢 匹配到后台解编码核心 (高精度): ffmpeg -> {ffmpeg_path}")
        return {"type": "ffmpeg", "cmd": ffmpeg_path}
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
    # allow_redirects=False：只验证源 URL 可达，不跟随重定向。
    # 重定向目标可能是 RTSP/非标准 HTTP 服务器，aiohttp 跟随会报 Bad status line。
    # 实际流内容校验由 Phase 2 的 ffprobe/ffmpeg 负责。
    else:
        try:
            ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
            async with session.get(url, timeout=PHASE_I_TIMEOUT, allow_redirects=False, headers={"User-Agent": ua}) as response:
                # 2xx 成功 / 3xx 重定向 均视为源 URL 可达
                if response.status >= 200 and response.status < 400:
                    latency = int((time.time() - start_time) * 1000)
                    return True, latency
        except asyncio.TimeoutError:
            logger.warning(f"⏱ Phase 1 超时 ({PHASE_I_TIMEOUT}s): {url[:60]}")
        except aiohttp.ClientConnectorError as e:
            logger.warning(f"🔌 Phase 1 连接失败: {url[:60]} -> {e}")
        except Exception as e:
            logger.warning(f"❓ Phase 1 未知异常: {url[:60]} -> {type(e).__name__}: {e}")

        return False, 9999

async def phase_2_decode_check(ff_engine: dict, url: str) -> tuple:
    """第二阶段二段式检测：驱动 FFmpeg 工件，进行 2 秒实际拉流与解码验证，杜绝一切“假在线”流
    """
    start_time = time.time()
    cmd = []
    
    if ff_engine["type"] == "ffplay":
        # -nodisp (不弹出 GUI 窗口画面) -autoexit (播放结束后自动结束) -t 限制视频拉流秒数
                cmd = [
            ff_engine["cmd"], "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36", "-nodisp", "-autoexit", "-loglevel", "error", 
            "-t", str(PHASE_II_DECODE_SEC), url
        ]
    elif ff_engine["type"] == "ffmpeg":
        # ffmpeg 校验最严密，-f null - 代表空画面输出，专门用于吞吐评估流健康度
                cmd = [
            ff_engine["cmd"], "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36", "-y", "-loglevel", "error", "-t", str(PHASE_II_DECODE_SEC),
            "-i", url, "-f", "null", "-"
        ]
    elif ff_engine["type"] == "ffprobe":
                cmd = [
            ff_engine["cmd"], "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36", "-v", "error", "-show_entries", "format=duration",
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


async def process_test_pipeline(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, ff_engine: dict, source_id: str, channel_id: str, url: str, channel_name: str) -> dict:
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
                "channelName": channel_name,
                "url": url,
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
                    "channelName": channel_name,
                    "url": url,
                    "status": "active",
                    "latency": p2_latency
                }
            else:
                logger.warning(f"  ❌ [质检失败] {url[:45]}... 能连接端口但无法提取播放帧，归类为不可用")
                return {
                    "sourceId": source_id,
                    "channelId": channel_id,
                    "channelName": channel_name,
                    "url": url,
                    "status": "inactive",
                    "latency": 9999
                }
        else:
            # 如果本地无 FF 家族解码器，测速结果直接信任基于第一阶段轻量握手的延迟数据
            return {
                "sourceId": source_id,
                "channelId": channel_id,
                "channelName": channel_name,
                "url": url,
                "status": "active",
                "latency": p1_latency
            }


async def main():
    logger.info("=============================================================")
    logger.info(" IPTV-TwoPhase-Probe / 联动机顶盒 FFplay 硬件编解码二段测速器 ")
    logger.info("=============================================================")

    # 首要物理扫描底层依赖
    ff_engine = detect_ff_player()
    # 创建 SSL 上下文：支持 HTTPS 但跳过证书校验（测试/内网域名证书通常无效）
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connector = aiohttp.TCPConnector(ssl=ssl_context, limit=50)
    
    import urllib.parse
    

    global CLIENT_ISP, CLIENT_PROVINCE
    
    async with aiohttp.ClientSession(connector=connector) as session:
        req_headers = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVProbe/2.0"
        }

        # 自动检测当前设备网络环境
        if CLIENT_ISP == "AUTO" or CLIENT_PROVINCE == "AUTO":
            logger.info("正在自动检测本机 IP 与网络环境归属...")
            try:
                detect_url = f"{SERVER_BASE_URL}/api/sources/detect-ip"
                async with session.get(detect_url, timeout=5, headers=req_headers) as ip_resp:
                    if ip_resp.status == 200:
                        try:
                            ip_data = await ip_resp.json()
                            CLIENT_PROVINCE = ip_data.get("province", "未知")
                            CLIENT_ISP = ip_data.get("isp", "未知")
                            logger.info(f"✅ 网络环境自动识别成功: {CLIENT_PROVINCE} - {CLIENT_ISP} (IP: {ip_data.get('ip', '未知')})")
                        except Exception as json_err:
                            logger.warning(f"⚠️ 服务器响应解析 JSON 失败: {json_err}，使用未知兜底。")
                            CLIENT_ISP = "未知"
                            CLIENT_PROVINCE = "未知"
                    else:
                        CLIENT_ISP = "未知"
                        CLIENT_PROVINCE = "未知"
                        logger.warning(f"⚠️ 自动检测网络环境失败 (HTTP status: {ip_resp.status})，使用未知兜底。")
            except Exception as e:
                logger.error(f"⚠️ 无法连接到服务器检测 IP: {e}")
                CLIENT_ISP = "未知"
                CLIENT_PROVINCE = "未知"
        

        # --- 新增: 获取总数并等待确认 ---
        encoded_isp = urllib.parse.quote(CLIENT_ISP)
        encoded_prov = urllib.parse.quote(CLIENT_PROVINCE)
        url_initial = f"{SERVER_BASE_URL}/api/sources/client-test-list?page=1&limit=1&isp={encoded_isp}&province={encoded_prov}"
        
        total_sources = 0
        try:
            async with session.get(url_initial, timeout=10, headers=req_headers) as resp:
                if resp.status == 200:
                    data_initial = await resp.json()
                    total_sources = data_initial.get("total", 0)
        except Exception as e:
            logger.error(f"无法拉取配置以获取总数: {e}")
            return
            
        if total_sources == 0:
            logger.warning(f"当前 [{CLIENT_ISP}] 环境下没有需要测试的线路。")
            return
            
        print(f"\n=======================================================")
        print(f" ✅ 探针网络环境鉴定: {CLIENT_PROVINCE} / {CLIENT_ISP}")
        print(f" 📡 匹配待测线路总数: {total_sources} 条")
        print(f"=======================================================\n")
        
        import asyncio
        loop = asyncio.get_running_loop()
        confirm = await loop.run_in_executor(None, input, "按 [Enter] 键开始启动测速，或输入 'q' 退出: ")
        if confirm.strip().lower() in ['q', 'quit', 'exit']:
            logger.info("用户已取消。")
            return
        # --------------------------------
        
        page = 1
        limit = 50
        
        all_sources_before = []
        all_sources_after = []
        
        while True:
            # 拉取在中枢配置的所有线路 (分批)
            encoded_isp = urllib.parse.quote(CLIENT_ISP)
            encoded_prov = urllib.parse.quote(CLIENT_PROVINCE)
            url = f"{SERVER_BASE_URL}/api/sources/client-test-list?page={page}&limit={limit}&isp={encoded_isp}&province={encoded_prov}"
            logger.info(f"正在从云端拉取测速列表 (第 {page} 页): {url}")
            
            try:
                async with session.get(url, timeout=10, headers=req_headers) as resp:
                    if resp.status != 200:
                        logger.error(f"拉取失败 HTTP: {resp.status}")
                        break
                    try:
                        data = await resp.json()
                    except Exception as json_err:
                        logger.error(f"解析测速列表 JSON 失败: {json_err}")
                        break
            except Exception as e:
                logger.error(f"无法拉取配置: {e}")
                break
                
            sources = data.get("sources", [])
            if not sources:
                if page == 1:
                    logger.warning("中枢系统上尚无可测试物理流线路。")
                else:
                    logger.warning(f"第 {page} 页无可测试物理流线路，测速结束。")
                break
                
            sources_to_test = []
            for src in sources:
                c_name = src.get("channelName", "Unknown")
                c_url = src.get("url", "")
                all_sources_before.append(f"{c_name},{c_url}")
                sources_to_test.append((src.get("id"), src.get("channelId"), c_url, c_name))
                
            if not sources_to_test:
                break
                
            logger.info(f"成功导入第 {page} 页的 {len(sources_to_test)} 条线路。下发多通道多协程测速中...")

            # 启动一二段管道模型
            semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
            tasks = [
                process_test_pipeline(session, semaphore, ff_engine, src_id, ch_id, test_url, c_name)
                for src_id, ch_id, test_url, c_name in sources_to_test
            ]
            
            # 搜集整体反馈
            final_reports = await asyncio.gather(*tasks)

            # 打包回传给主服务器，数据库将根据上报数据进行持久化和前端更新
            active_count = 0
            for r in final_reports:
                if r["status"] == "active":
                    active_count += 1
                    all_sources_after.append(f"{r.get('channelName', 'Unknown')},{r.get('url', '')}")
            
            logger.info(f"=== 第 {page} 页 测速测写完毕 ===")
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
                        logger.info(f"🚀 【数据完全落地】第 {page} 页回传在云端服务器重洗成功！热生效数量: {res_body.get('count', 0)} 条")
                    else:
                        logger.error(f"第 {page} 页上报被拒绝，HTTP: {post_resp.status}")
            except Exception as ex:
                logger.error(f"第 {page} 页回传网络中断: {ex}")
                
            # 分页逻辑
            total = data.get("total", 0)
            if page * limit >= total:
                logger.info("所有页面测速完毕。")
                break
            page += 1
            
        # 测速结束，保存TVBox格式的对比文件
        with open("sources_before.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(all_sources_before))
        with open("sources_after.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(all_sources_after))
        logger.info(f"已保存测试前文件: sources_before.txt (共 {len(all_sources_before)} 条)")
        logger.info(f"已保存测试后文件: sources_after.txt (共 {len(all_sources_after)} 条)")

def parse_tvbox_file(filepath: str) -> list:
    """解析 TVBox 格式的频道列表文件。
    支持分组标记（如 央视频道,#genre#），保留分组信息。
    返回 [(channel_name, url, group), ...] 列表，group 为所属分组名（无分组则为 None）
    """
    channels = []
    current_group = None
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # 分组标记:  xxx,#genre# 或  xxx, #genre#
                parts = line.split(",", 1)
                if len(parts) == 2:
                    name, second = parts[0].strip(), parts[1].strip()
                    # 分组行: second 部分为 #genre#（不区分大小写）
                    if second.lower() == "#genre#":
                        current_group = name
                        continue
                    # 普通频道行: name,url
                    if name and second and not second.lower().startswith("#genre"):
                        channels.append((name, second, current_group))
                    else:
                        logger.warning(f"第 {line_num} 行格式异常，已跳过: {line[:50]}")
                else:
                    logger.warning(f"第 {line_num} 行无法解析为 '名称,URL' 格式，已跳过: {line[:50]}")
    except FileNotFoundError:
        logger.error(f"文件不存在: {filepath}")
        return []
    except Exception as e:
        logger.error(f"读取文件失败: {e}")
        return []
    return channels


async def test_tvbox_file(filepath: str, output_file: str = None):
    """读取 TVBox 格式频道列表，逐一测速，仅保存可播放列表（保留分组信息）"""
    logger.info("=" * 60)
    logger.info(" 📺 TVBox 频道列表二段测速模式")
    logger.info(f" 📂 输入文件: {filepath}")
    logger.info("=" * 60)

    channels = parse_tvbox_file(filepath)
    if not channels:
        logger.error("未能从文件中解析到任何频道，退出。")
        return

    # 统计分组信息
    groups = set(g for _, _, g in channels if g)
    if groups:
        logger.info(f"成功解析 {len(channels)} 条频道记录，{len(groups)} 个分组，开始测速...\n")
    else:
        logger.info(f"成功解析 {len(channels)} 条频道记录（无分组），开始测速...\n")

    ff_engine = detect_ff_player()
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connector = aiohttp.TCPConnector(ssl=ssl_context, limit=CONCURRENCY_LIMIT * 2)

    async with aiohttp.ClientSession(connector=connector) as session:
        semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
        tasks = []
        for idx, (name, url, group) in enumerate(channels):
            tasks.append(
                process_test_pipeline(session, semaphore, ff_engine, f"tvbox_{idx}", f"ch_{idx}", url, name)
            )

        results = await asyncio.gather(*tasks)

    # 统计 & 筛选（保留分组归属）
    active_map = {}  # idx -> (name, url, group)
    inactive_count = 0
    for idx, r in enumerate(results):
        if r["status"] == "active":
            _, _, group = channels[idx]
            active_map[idx] = (r["channelName"], r["url"], group)
        else:
            inactive_count += 1

    logger.info("\n" + "=" * 60)
    logger.info(f" 📊 测速完成: ✅ {len(active_map)} 条可用 | ❌ {inactive_count} 条不可用")
    logger.info("=" * 60)

    # 保存可播放列表，保留分组结构
    if output_file is None:
        base, ext = (filepath.rsplit(".", 1) + ["txt"])[:2]
        output_file = f"{base}_valid.{ext}"

    with open(output_file, "w", encoding="utf-8") as f:
        last_group = None
        written = 0
        for idx, (name, url, group) in enumerate(channels):
            if idx not in active_map:
                continue
            # 分组标题行
            if group and group != last_group:
                # 组间加空行（非首组）
                if last_group is not None:
                    f.write("\n")
                f.write(f"{group},#genre#\n")
            last_group = group
            # 频道行
            f.write(f"{name},{url}\n")
            written += 1

    logger.info(f"💾 可播放列表已保存至: {output_file} (共 {written} 条)")
    logger.info("=" * 60)


async def test_single_url(url: str):
    """测试单个 URL 的连通性和解码状况（独立于主流程）"""
    logger.info("=" * 60)
    logger.info(f"🔬 单URL测试模式")
    logger.info(f"📡 目标: {url}")
    logger.info(f"⏱  Phase 1 超时: {PHASE_I_TIMEOUT}s | Phase 2 解码: {PHASE_II_DECODE_SEC}s")
    logger.info("=" * 60)

    ff_engine = detect_ff_player()
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connector = aiohttp.TCPConnector(ssl=ssl_context, limit=1)

    async with aiohttp.ClientSession(connector=connector) as session:
        # Phase 1
        logger.info(f"\n📍 [Phase 1] 网络连通性检查...")
        p1_ok, p1_latency = await phase_1_network_check(session, url)
        if not p1_ok:
            logger.error(f"❌ [Phase 1] 网络不通！延迟: {p1_latency}ms")
            return
        logger.info(f"✅ [Phase 1] 网络可达，延迟: {p1_latency}ms")

        if not ff_engine:
            logger.warning("⚠️  未找到 FFmpeg 工具，无法进行 Phase 2 解码验证")
            logger.info(f"📊 最终结果: active (仅 Phase 1 通过)")
            return

        # Phase 2
        logger.info(f"\n📍 [Phase 2] 流媒体解码验证 ({ff_engine['type']})...")
        p2_ok, p2_latency = await phase_2_decode_check(ff_engine, url)
        if p2_ok:#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import time
import logging
import shutil
import urllib.parse
import socket
import ssl
import aiohttp

# ==================== [用户自定义参数配置区] ====================
# [1] 直播源系统的远端中枢服务器 URL (不要以 "/" 结尾)
SERVER_BASE_URL = "https://iptvs.mybacc.com" 

# [2] 本设备的真实物理宽带网络环境属性
CLIENT_ISP = "AUTO"         
CLIENT_PROVINCE = "AUTO"       

# [3] 测速性能参数
CONCURRENCY_LIMIT = 10        # 第 1 阶段轻量并发测试管通道限制数
PHASE_I_TIMEOUT = 2.5         # 第 1 阶段极速网络超时限制（秒）
PHASE_II_DECODE_SEC = 5       # 第 2 阶段 ffplay/ffmpeg 实际解码读流帧限制（秒）
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

    # 根据用户反馈，优先使用 ffprobe 以降低误报率，它速度更快且容忍度更高
    if ffprobe_path:
        logger.info(f"🟢 匹配到流媒体属性提取器 (快速首选): ffprobe -> {ffprobe_path}")
        return {"type": "ffprobe", "cmd": ffprobe_path}
    elif ffplay_path:
        logger.info(f"🟢 成功匹配到硬件播放引擎: ffplay -> {ffplay_path}")
        return {"type": "ffplay", "cmd": ffplay_path}
    elif ffmpeg_path:
        logger.info(f"🟢 匹配到后台解编码核心 (高精度): ffmpeg -> {ffmpeg_path}")
        return {"type": "ffmpeg", "cmd": ffmpeg_path}
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
    # allow_redirects=False：只验证源 URL 可达，不跟随重定向。
    # 重定向目标可能是 RTSP/非标准 HTTP 服务器，aiohttp 跟随会报 Bad status line。
    # 实际流内容校验由 Phase 2 的 ffprobe/ffmpeg 负责。
    else:
        try:
            ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
            async with session.get(url, timeout=PHASE_I_TIMEOUT, allow_redirects=False, headers={"User-Agent": ua}) as response:
                # 2xx 成功 / 3xx 重定向 均视为源 URL 可达
                if response.status >= 200 and response.status < 400:
                    latency = int((time.time() - start_time) * 1000)
                    return True, latency
        except asyncio.TimeoutError:
            logger.warning(f"⏱ Phase 1 超时 ({PHASE_I_TIMEOUT}s): {url[:60]}")
        except aiohttp.ClientConnectorError as e:
            logger.warning(f"🔌 Phase 1 连接失败: {url[:60]} -> {e}")
        except Exception as e:
            logger.warning(f"❓ Phase 1 未知异常: {url[:60]} -> {type(e).__name__}: {e}")

        return False, 9999

async def phase_2_decode_check(ff_engine: dict, url: str) -> tuple:
    """第二阶段二段式检测：驱动 FFmpeg 工件，进行 2 秒实际拉流与解码验证，杜绝一切“假在线”流
    """
    start_time = time.time()
    cmd = []
    
    if ff_engine["type"] == "ffplay":
        # -nodisp (不弹出 GUI 窗口画面) -autoexit (播放结束后自动结束) -t 限制视频拉流秒数
                cmd = [
            ff_engine["cmd"], "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36", "-nodisp", "-autoexit", "-loglevel", "error", 
            "-t", str(PHASE_II_DECODE_SEC), url
        ]
    elif ff_engine["type"] == "ffmpeg":
        # ffmpeg 校验最严密，-f null - 代表空画面输出，专门用于吞吐评估流健康度
                cmd = [
            ff_engine["cmd"], "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36", "-y", "-loglevel", "error", "-t", str(PHASE_II_DECODE_SEC),
            "-i", url, "-f", "null", "-"
        ]
    elif ff_engine["type"] == "ffprobe":
                cmd = [
            ff_engine["cmd"], "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36", "-v", "error", "-show_entries", "format=duration",
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


async def process_test_pipeline(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, ff_engine: dict, source_id: str, channel_id: str, url: str, channel_name: str) -> dict:
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
                "channelName": channel_name,
                "url": url,
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
                    "channelName": channel_name,
                    "url": url,
                    "status": "active",
                    "latency": p2_latency
                }
            else:
                logger.warning(f"  ❌ [质检失败] {url[:45]}... 能连接端口但无法提取播放帧，归类为不可用")
                return {
                    "sourceId": source_id,
                    "channelId": channel_id,
                    "channelName": channel_name,
                    "url": url,
                    "status": "inactive",
                    "latency": 9999
                }
        else:
            # 如果本地无 FF 家族解码器，测速结果直接信任基于第一阶段轻量握手的延迟数据
            return {
                "sourceId": source_id,
                "channelId": channel_id,
                "channelName": channel_name,
                "url": url,
                "status": "active",
                "latency": p1_latency
            }


async def main():
    logger.info("=============================================================")
    logger.info(" IPTV-TwoPhase-Probe / 联动机顶盒 FFplay 硬件编解码二段测速器 ")
    logger.info("=============================================================")

    # 首要物理扫描底层依赖
    ff_engine = detect_ff_player()
    # 创建 SSL 上下文：支持 HTTPS 但跳过证书校验（测试/内网域名证书通常无效）
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connector = aiohttp.TCPConnector(ssl=ssl_context, limit=50)
    
    import urllib.parse
    

    global CLIENT_ISP, CLIENT_PROVINCE
    
    async with aiohttp.ClientSession(connector=connector) as session:
        req_headers = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVProbe/2.0"
        }

        # 自动检测当前设备网络环境
        if CLIENT_ISP == "AUTO" or CLIENT_PROVINCE == "AUTO":
            logger.info("正在自动检测本机 IP 与网络环境归属...")
            try:
                detect_url = f"{SERVER_BASE_URL}/api/sources/detect-ip"
                async with session.get(detect_url, timeout=5, headers=req_headers) as ip_resp:
                    if ip_resp.status == 200:
                        try:
                            ip_data = await ip_resp.json()
                            CLIENT_PROVINCE = ip_data.get("province", "未知")
                            CLIENT_ISP = ip_data.get("isp", "未知")
                            logger.info(f"✅ 网络环境自动识别成功: {CLIENT_PROVINCE} - {CLIENT_ISP} (IP: {ip_data.get('ip', '未知')})")
                        except Exception as json_err:
                            logger.warning(f"⚠️ 服务器响应解析 JSON 失败: {json_err}，使用未知兜底。")
                            CLIENT_ISP = "未知"
                            CLIENT_PROVINCE = "未知"
                    else:
                        CLIENT_ISP = "未知"
                        CLIENT_PROVINCE = "未知"
                        logger.warning(f"⚠️ 自动检测网络环境失败 (HTTP status: {ip_resp.status})，使用未知兜底。")
            except Exception as e:
                logger.error(f"⚠️ 无法连接到服务器检测 IP: {e}")
                CLIENT_ISP = "未知"
                CLIENT_PROVINCE = "未知"
        

        # --- 新增: 获取总数并等待确认 ---
        encoded_isp = urllib.parse.quote(CLIENT_ISP)
        encoded_prov = urllib.parse.quote(CLIENT_PROVINCE)
        url_initial = f"{SERVER_BASE_URL}/api/sources/client-test-list?page=1&limit=1&isp={encoded_isp}&province={encoded_prov}"
        
        total_sources = 0
        try:
            async with session.get(url_initial, timeout=10, headers=req_headers) as resp:
                if resp.status == 200:
                    data_initial = await resp.json()
                    total_sources = data_initial.get("total", 0)
        except Exception as e:
            logger.error(f"无法拉取配置以获取总数: {e}")
            return
            
        if total_sources == 0:
            logger.warning(f"当前 [{CLIENT_ISP}] 环境下没有需要测试的线路。")
            return
            
        print(f"\n=======================================================")
        print(f" ✅ 探针网络环境鉴定: {CLIENT_PROVINCE} / {CLIENT_ISP}")
        print(f" 📡 匹配待测线路总数: {total_sources} 条")
        print(f"=======================================================\n")
        
        import asyncio
        loop = asyncio.get_running_loop()
        confirm = await loop.run_in_executor(None, input, "按 [Enter] 键开始启动测速，或输入 'q' 退出: ")
        if confirm.strip().lower() in ['q', 'quit', 'exit']:
            logger.info("用户已取消。")
            return
        # --------------------------------
        
        page = 1
        limit = 50
        
        all_sources_before = []
        all_sources_after = []
        
        while True:
            # 拉取在中枢配置的所有线路 (分批)
            encoded_isp = urllib.parse.quote(CLIENT_ISP)
            encoded_prov = urllib.parse.quote(CLIENT_PROVINCE)
            url = f"{SERVER_BASE_URL}/api/sources/client-test-list?page={page}&limit={limit}&isp={encoded_isp}&province={encoded_prov}"
            logger.info(f"正在从云端拉取测速列表 (第 {page} 页): {url}")
            
            try:
                async with session.get(url, timeout=10, headers=req_headers) as resp:
                    if resp.status != 200:
                        logger.error(f"拉取失败 HTTP: {resp.status}")
                        break
                    try:
                        data = await resp.json()
                    except Exception as json_err:
                        logger.error(f"解析测速列表 JSON 失败: {json_err}")
                        break
            except Exception as e:
                logger.error(f"无法拉取配置: {e}")
                break
                
            sources = data.get("sources", [])
            if not sources:
                if page == 1:
                    logger.warning("中枢系统上尚无可测试物理流线路。")
                else:
                    logger.warning(f"第 {page} 页无可测试物理流线路，测速结束。")
                break
                
            sources_to_test = []
            for src in sources:
                c_name = src.get("channelName", "Unknown")
                c_url = src.get("url", "")
                all_sources_before.append(f"{c_name},{c_url}")
                sources_to_test.append((src.get("id"), src.get("channelId"), c_url, c_name))
                
            if not sources_to_test:
                break
                
            logger.info(f"成功导入第 {page} 页的 {len(sources_to_test)} 条线路。下发多通道多协程测速中...")

            # 启动一二段管道模型
            semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
            tasks = [
                process_test_pipeline(session, semaphore, ff_engine, src_id, ch_id, test_url, c_name)
                for src_id, ch_id, test_url, c_name in sources_to_test
            ]
            
            # 搜集整体反馈
            final_reports = await asyncio.gather(*tasks)

            # 打包回传给主服务器，数据库将根据上报数据进行持久化和前端更新
            active_count = 0
            for r in final_reports:
                if r["status"] == "active":
                    active_count += 1
                    all_sources_after.append(f"{r.get('channelName', 'Unknown')},{r.get('url', '')}")
            
            logger.info(f"=== 第 {page} 页 测速测写完毕 ===")
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
                        logger.info(f"🚀 【数据完全落地】第 {page} 页回传在云端服务器重洗成功！热生效数量: {res_body.get('count', 0)} 条")
                    else:
                        logger.error(f"第 {page} 页上报被拒绝，HTTP: {post_resp.status}")
            except Exception as ex:
                logger.error(f"第 {page} 页回传网络中断: {ex}")
                
            # 分页逻辑
            total = data.get("total", 0)
            if page * limit >= total:
                logger.info("所有页面测速完毕。")
                break
            page += 1
            
        # 测速结束，保存TVBox格式的对比文件
        with open("sources_before.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(all_sources_before))
        with open("sources_after.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(all_sources_after))
        logger.info(f"已保存测试前文件: sources_before.txt (共 {len(all_sources_before)} 条)")
        logger.info(f"已保存测试后文件: sources_after.txt (共 {len(all_sources_after)} 条)")

def parse_tvbox_file(filepath: str) -> list:
    """解析 TVBox 格式的频道列表文件。
    支持分组标记（如 央视频道,#genre#），保留分组信息。
    返回 [(channel_name, url, group), ...] 列表，group 为所属分组名（无分组则为 None）
    """
    channels = []
    current_group = None
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # 分组标记:  xxx,#genre# 或  xxx, #genre#
                parts = line.split(",", 1)
                if len(parts) == 2:
                    name, second = parts[0].strip(), parts[1].strip()
                    # 分组行: second 部分为 #genre#（不区分大小写）
                    if second.lower() == "#genre#":
                        current_group = name
                        continue
                    # 普通频道行: name,url
                    if name and second and not second.lower().startswith("#genre"):
                        channels.append((name, second, current_group))
                    else:
                        logger.warning(f"第 {line_num} 行格式异常，已跳过: {line[:50]}")
                else:
                    logger.warning(f"第 {line_num} 行无法解析为 '名称,URL' 格式，已跳过: {line[:50]}")
    except FileNotFoundError:
        logger.error(f"文件不存在: {filepath}")
        return []
    except Exception as e:
        logger.error(f"读取文件失败: {e}")
        return []
    return channels


async def test_tvbox_file(filepath: str, output_file: str = None):
    """读取 TVBox 格式频道列表，逐一测速，仅保存可播放列表（保留分组信息）"""
    logger.info("=" * 60)
    logger.info(" 📺 TVBox 频道列表二段测速模式")
    logger.info(f" 📂 输入文件: {filepath}")
    logger.info("=" * 60)

    channels = parse_tvbox_file(filepath)
    if not channels:
        logger.error("未能从文件中解析到任何频道，退出。")
        return

    # 统计分组信息
    groups = set(g for _, _, g in channels if g)
    if groups:
        logger.info(f"成功解析 {len(channels)} 条频道记录，{len(groups)} 个分组，开始测速...\n")
    else:
        logger.info(f"成功解析 {len(channels)} 条频道记录（无分组），开始测速...\n")

    ff_engine = detect_ff_player()
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connector = aiohttp.TCPConnector(ssl=ssl_context, limit=CONCURRENCY_LIMIT * 2)

    async with aiohttp.ClientSession(connector=connector) as session:
        semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
        tasks = []
        for idx, (name, url, group) in enumerate(channels):
            tasks.append(
                process_test_pipeline(session, semaphore, ff_engine, f"tvbox_{idx}", f"ch_{idx}", url, name)
            )

        results = await asyncio.gather(*tasks)

    # 统计 & 筛选（保留分组归属）
    active_map = {}  # idx -> (name, url, group)
    inactive_count = 0
    for idx, r in enumerate(results):
        if r["status"] == "active":
            _, _, group = channels[idx]
            active_map[idx] = (r["channelName"], r["url"], group)
        else:
            inactive_count += 1

    logger.info("\n" + "=" * 60)
    logger.info(f" 📊 测速完成: ✅ {len(active_map)} 条可用 | ❌ {inactive_count} 条不可用")
    logger.info("=" * 60)

    # 保存可播放列表，保留分组结构
    if output_file is None:
        base, ext = (filepath.rsplit(".", 1) + ["txt"])[:2]
        output_file = f"{base}_valid.{ext}"

    with open(output_file, "w", encoding="utf-8") as f:
        last_group = None
        written = 0
        for idx, (name, url, group) in enumerate(channels):
            if idx not in active_map:
                continue
            # 分组标题行
            if group and group != last_group:
                # 组间加空行（非首组）
                if last_group is not None:
                    f.write("\n")
                f.write(f"{group},#genre#\n")
            last_group = group
            # 频道行
            f.write(f"{name},{url}\n")
            written += 1

    logger.info(f"💾 可播放列表已保存至: {output_file} (共 {written} 条)")
    logger.info("=" * 60)


async def test_single_url(url: str):
    """测试单个 URL 的连通性和解码状况（独立于主流程）"""
    logger.info("=" * 60)
    logger.info(f"🔬 单URL测试模式")
    logger.info(f"📡 目标: {url}")
    logger.info(f"⏱  Phase 1 超时: {PHASE_I_TIMEOUT}s | Phase 2 解码: {PHASE_II_DECODE_SEC}s")
    logger.info("=" * 60)

    ff_engine = detect_ff_player()
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connector = aiohttp.TCPConnector(ssl=ssl_context, limit=1)

    async with aiohttp.ClientSession(connector=connector) as session:
        # Phase 1
        logger.info(f"\n📍 [Phase 1] 网络连通性检查...")
        p1_ok, p1_latency = await phase_1_network_check(session, url)
        if not p1_ok:
            logger.error(f"❌ [Phase 1] 网络不通！延迟: {p1_latency}ms")
            return
        logger.info(f"✅ [Phase 1] 网络可达，延迟: {p1_latency}ms")

        if not ff_engine:
            logger.warning("⚠️  未找到 FFmpeg 工具，无法进行 Phase 2 解码验证")
            logger.info(f"📊 最终结果: active (仅 Phase 1 通过)")
            return

        # Phase 2
        logger.info(f"\n📍 [Phase 2] 流媒体解码验证 ({ff_engine['type']})...")
        p2_ok, p2_latency = await phase_2_decode_check(ff_engine, url)
        if p2_ok:
            logger.info(f"🎉 [Phase 2] 解码通过！延迟: {p2_latency}ms")
            logger.info(f"📊 最终结果: ✅ active（二段验证全部通过）")
        else:
            logger.warning(f"❌ [Phase 2] 解码失败！能连接但无法提取播放帧")
            logger.info(f"📊 最终结果: ❌ inactive（网络通但解码失败）")


if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3 and sys.argv[1] == "-f":
        # TVBox 文件测速模式: python iptv_probe2.py -f channels.txt [output.txt]
        output = sys.argv[3] if len(sys.argv) >= 4 else None
        asyncio.run(test_tvbox_file(sys.argv[2], output))
    elif len(sys.argv) >= 2 and sys.argv[1] == "-f":
        logger.error("请指定 TVBox 频道文件路径，用法: python iptv_probe2.py -f channels.txt")
    elif len(sys.argv) > 1:
        # 单URL测试模式: python iptv_probe2.py "https://..."
        asyncio.run(test_single_url(sys.argv[1]))
    else:
        asyncio.run(main())

            logger.info(f"🎉 [Phase 2] 解码通过！延迟: {p2_latency}ms")
            logger.info(f"📊 最终结果: ✅ active（二段验证全部通过）")
        else:
            logger.warning(f"❌ [Phase 2] 解码失败！能连接但无法提取播放帧")
            logger.info(f"📊 最终结果: ❌ inactive（网络通但解码失败）")


if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3 and sys.argv[1] == "-f":
        # TVBox 文件测速模式: python iptv_probe2.py -f channels.txt [output.txt]
        output = sys.argv[3] if len(sys.argv) >= 4 else None
        asyncio.run(test_tvbox_file(sys.argv[2], output))
    elif len(sys.argv) >= 2 and sys.argv[1] == "-f":
        logger.error("请指定 TVBox 频道文件路径，用法: python iptv_probe2.py -f channels.txt")
    elif len(sys.argv) > 1:
        # 单URL测试模式: python iptv_probe2.py "https://..."
        asyncio.run(test_single_url(sys.argv[1]))
    else:
        asyncio.run(main())
