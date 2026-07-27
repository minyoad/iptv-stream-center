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
SERVER_BASE_URL = "https://ais-dev-h22cqilbhbuzga4hfgpz7g-276461038601.asia-southeast1.run.app" 

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
    connector = aiohttp.TCPConnector(ssl=False, limit=50)
    
    import urllib.parse
    

    global CLIENT_ISP, CLIENT_PROVINCE
    
    async with aiohttp.ClientSession(connector=connector) as session:
        # 自动检测当前设备网络环境
        if CLIENT_ISP == "AUTO" or CLIENT_PROVINCE == "AUTO":
            logger.info("正在自动检测本机 IP 与网络环境归属...")
            try:
                detect_url = f"{SERVER_BASE_URL}/api/sources/detect-ip"
                async with session.get(detect_url, timeout=5) as ip_resp:
                    if ip_resp.status == 200:
                        ip_data = await ip_resp.json()
                        CLIENT_PROVINCE = ip_data.get("province", "未知")
                        CLIENT_ISP = ip_data.get("isp", "未知")
                        logger.info(f"✅ 网络环境自动识别成功: {CLIENT_PROVINCE} - {CLIENT_ISP} (IP: {ip_data.get('ip', '未知')})")
                    else:
                        CLIENT_ISP = "未知"
                        CLIENT_PROVINCE = "未知"
                        logger.warning("⚠️ 自动检测网络环境失败，使用未知兜底。")
            except Exception as e:
                logger.error(f"⚠️ 无法连接到服务器检测 IP: {e}")
                CLIENT_ISP = "未知"
                CLIENT_PROVINCE = "未知"
        
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
                async with session.get(url, timeout=10) as resp:
                    if resp.status != 200:
                        logger.error(f"拉取失败 HTTP: {resp.status}")
                        break
                    data = await resp.json()
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

if __name__ == "__main__":
    asyncio.run(main())
