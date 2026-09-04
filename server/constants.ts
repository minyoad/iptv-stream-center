import path from "path";
import fs from "fs";
import { Group, Channel, SyncConfig, IpGeoApi } from "./types";

export const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
export const DATA_FILE = path.join(DATA_DIR, "iptv_data.json");
export const SQLITE_DB_PATH = path.join(DATA_DIR, "iptv_sqlite.db");
export const EPG_CACHE_DIR = path.join(DATA_DIR, "epg_cache_sources");
export const EPG_EXPORT_XML_PATH = path.join(DATA_DIR, "epg_export.xml");
export const EPG_EXPORT_GZ_PATH = path.join(DATA_DIR, "epg_export.xml.gz");
export const PLAYLIST_CACHE_DIR = path.join(DATA_DIR, "playlist_cache");
export const READABLE_PLAYLIST_DIR = path.join(DATA_DIR, "playlists_export");

// Ensure required directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EPG_CACHE_DIR)) fs.mkdirSync(EPG_CACHE_DIR, { recursive: true });
if (!fs.existsSync(PLAYLIST_CACHE_DIR)) fs.mkdirSync(PLAYLIST_CACHE_DIR, { recursive: true });
if (!fs.existsSync(READABLE_PLAYLIST_DIR)) fs.mkdirSync(READABLE_PLAYLIST_DIR, { recursive: true });

export const DEFAULT_GROUPS: Group[] = [
  { id: "g_yangshi", name: "央视频道" },
  { id: "g_weishi", name: "卫视频道" },
  { id: "g_gangaotai", name: "港澳台" },
  { id: "g_local", name: "地方频道" },
  { id: "g_other", name: "其它频道" }
];

export const DEFAULT_CHANNELS: Channel[] = [
  {
    id: "cctv1",
    name: "CCTV-1 综合",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627514936398.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV1", "CCTV-1 综合HD", "中央一套"],
    epgId: "cctv1",
    sources: [
      {
        id: "cctv1-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv1hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      },
      {
        id: "cctv1-s2",
        url: "http://39.134.115.163:8080/plsts/1/index.m3u8",
        province: "山东",
        isp: "移动",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv3",
    name: "CCTV-3 综艺",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515090124.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV3", "CCTV-3", "中央三套"],
    epgId: "cctv3",
    sources: [
      {
        id: "cctv3-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv3hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv5",
    name: "CCTV-5 体育",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515090333.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV5", "CCTV-5", "中央五套", "CCTV5 体育"],
    epgId: "cctv5",
    sources: [
      {
        id: "cctv5-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv5hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv6",
    name: "CCTV-6 电影",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515090444.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV6", "CCTV-6", "中央六套", "CCTV-6 电影"],
    epgId: "cctv6",
    sources: [
      {
        id: "cctv6-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv6hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv13",
    name: "CCTV-13 新闻",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515091212.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV13", "CCTV-13", "中央十三套", "CCTV-13 新闻"],
    epgId: "cctv13",
    sources: [
      {
        id: "cctv13-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv13.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "hunantv",
    name: "湖南卫视",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515092123.jpg",
    groupIds: ["g_weishi"],
    alias: ["湖南卫视", "湖南台", "Hunan TV"],
    epgId: "hunantv",
    sources: [
      {
        id: "hunantv-s1",
        url: "http://ivi.bupt.edu.cn/hls/hunantv.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "zhejiangtv",
    name: "浙江卫视",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515591321.jpg",
    groupIds: ["g_weishi"],
    alias: ["浙江卫视", "浙江台", "Zhejiang TV"],
    epgId: "zhejiangtv",
    sources: [
      {
        id: "zhejiangtv-s1",
        url: "http://ivi.bupt.edu.cn/hls/zjhd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "ftv",
    name: "民视",
    logo: "https://epg.112114.xyz/logo/民视.png",
    groupIds: ["g_gangaotai"],
    alias: ["民视", "FTV", "民视无线台", "民视综合"],
    epgId: "ftv",
    sources: [
      {
        id: "ftv-s1",
        url: "rtmp://f13h.mine.nu/sat/tv051",
        province: "台湾",
        isp: "多线",
        status: "unknown"
      }
    ]
  },
  {
    id: "ttv",
    name: "台视",
    logo: "https://live.fanmingming.com/tv/台视.png",
    groupIds: ["g_gangaotai"],
    alias: ["台视", "TTV", "台视主频", "台湾电视"],
    epgId: "ttv",
    sources: [
      {
        id: "ttv-s1",
        url: "rtmp://f13h.mine.nu/sat/tv071",
        province: "台湾",
        isp: "多线",
        status: "unknown"
      }
    ]
  },
  {
    id: "ctv",
    name: "中视",
    logo: "https://live.fanmingming.com/tv/中视.png",
    groupIds: ["g_gangaotai"],
    alias: ["中视", "CTV", "中视主频", "中国电视"],
    epgId: "ctv",
    sources: [
      {
        id: "ctv-s1",
        url: "rtmp://f13h.mine.nu/sat/tv091",
        province: "台湾",
        isp: "多线",
        status: "unknown"
      }
    ]
  },
  {
    id: "cts",
    name: "华视",
    logo: "https://live.fanmingming.com/tv/华视.png",
    groupIds: ["g_gangaotai"],
    alias: ["华视", "CTS", "华视主频", "中华电视"],
    epgId: "cts",
    sources: [
      {
        id: "cts-s1",
        url: "rtmp://f13h.mine.nu/sat/tv111",
        province: "台湾",
        isp: "多线",
        status: "unknown"
      }
    ]
  },
  {
    id: "cts-minnan",
    name: "华视闽南语频道",
    logo: "https://live.fanmingming.com/tv/华视.png",
    groupIds: ["g_gangaotai"],
    alias: ["华视闽南", "华视闽南频道", "华视台语台", "华视闽南语"],
    epgId: "cts-minnan",
    sources: [
      {
        id: "cts-minnan-s1",
        url: "rtmp://f13h.mine.nu/sat/tv111",
        province: "台湾",
        isp: "多线",
        status: "unknown"
      }
    ]
  }
];

export const DEFAULT_SYNC_CONFIGS: SyncConfig[] = [
  {
    id: "sc-1",
    name: "範例 IPTV GitHub 源",
    url: "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",
    type: "m3u",
    status: "never",
  }
];

export const PRESET_KNOWN_RULES = [
  // YY 直播
  { platform: 'yy', keyword: '/yy/' },
  { platform: 'yy', keyword: 'yy.php' },
  { platform: 'yy', keyword: '/yy.php' },
  { platform: 'yy', keyword: 'yy.flv' },

  // 斗鱼直播
  { platform: 'douyu', keyword: '/douyu/' },
  { platform: 'douyu', keyword: 'douyu.php' },
  { platform: 'douyu', keyword: 'dy.php' },
  { platform: 'douyu', keyword: '/dy/' },

  // 虎牙直播
  { platform: 'huya', keyword: '/huya/' },
  { platform: 'huya', keyword: 'huya.php' },
  { platform: 'huya', keyword: '/huya.php' },
  { platform: 'huya', keyword: 'hy.php' },

  // B站 (Bilibili)
  { platform: 'bilibili', keyword: '/bilibili/' },
  { platform: 'bilibili', keyword: 'bilibili.php' },
  { platform: 'bilibili', keyword: '/bili/' },
  { platform: 'bilibili', keyword: 'bili.php' },

  // 快手直播
  { platform: 'kuaishou', keyword: '/kuaishou/' },
  { platform: 'kuaishou', keyword: 'kuaishou.php' },
  { platform: 'kuaishou', keyword: 'ks.php' },

  // 抖音直播
  { platform: 'douyin', keyword: '/douyin/' },
  { platform: 'douyin', keyword: 'douyin.php' },
  { platform: 'douyin', keyword: 'dyin.php' },

  // 咪咕
  { platform: 'migu', keyword: '/migu/' },
  { platform: 'migu', keyword: '/migu?' },
  { platform: 'migu', keyword: 'migu.php' },
  { platform: 'migu', keyword: '/migu_live/' },
  { platform: 'migu', keyword: '/mg/' },
  { platform: 'migu', keyword: 'mg.php' },
  { platform: 'migu', keyword: 'regex:[?&]platform=migu' },
  { platform: 'migu', keyword: 'regex::\\d+/(?:migu|mg)/\\d+' },
  { platform: 'migu', keyword: 'regex::\\d+/[1-9]\\d{7,9}(?!\\d)(?:/|\\?|\\.|#|$)' }
];

export const PRESET_DISABLED_RULES = [
  {
    pattern: "miguvideo",
    type: "contains",
    platform: "",
    description: "忽略咪咕官方直链与CDN流 (miguvideo.com)",
    enabled: 1
  },
  {
    pattern: "hw-mbl-live.miguvideo.com",
    type: "domain",
    platform: "migu",
    description: "忽略咪咕华为移动直播CDN域名",
    enabled: 1
  },
  {
    pattern: "play.miguvideo.com",
    type: "domain",
    platform: "migu",
    description: "忽略咪咕播放CDN域名",
    enabled: 1
  },
  {
    pattern: "aliyuncs.com",
    type: "contains",
    platform: "",
    description: "忽略阿里云官方点播/直链流",
    enabled: 0
  },
  {
    pattern: "douyucdn.cn",
    type: "domain",
    platform: "douyu",
    description: "忽略斗鱼官方CDN临时直链",
    enabled: 0
  }
];

export const DEFAULT_CAROUSEL_PRESETS: Record<string, { name: string; id: string }[]> = {
  "yy": [{"name":"开心麻花","id":"54880976"},{"name":"YY 官方","id":"12345"},{"name":"YY 舞蹈","id":"76"}],
  "douyu": [{"name":"开心麻花经典小品","id":"10153463"},{"name":"贾玲经典小品","id":"10419541"},{"name":"龙视开心麻花街","id":"9374862"},{"name":"英雄联盟","id":"9999"},{"name":"Dota2","id":"1126960"}],
  "huya": [{"name":"虎牙放映厅","id":"11602077"},{"name":"战争电影放映厅","id":"21059618"},{"name":"悬疑放映厅","id":"26355797"},{"name":"LPL赛事","id":"lpl"},{"name":"楚河","id":"116361"}],
  "bilibili": [{"name":"逍遥散人","id":"1129"},{"name":"官方赛事","id":"6"}],
  "kuaishou": [{"name":"王者荣耀","id":"kpl"},{"name":"快手精选","id":"3x876g5g6f7"}],
  "douyin": [{"name":"抖音直播精选","id":"123456"}],
  "cntv": [{"name":"CCTV-1 综合","id":"cctv1"},{"name":"CCTV-5 体育","id":"cctv5"}],
  "migu": [{"name":"咪咕赛事","id":"608807420"}],
  "iptv": [{"name":"IPTV 直播","id":"live"}]
};

export const DEFAULT_IP_GEO_APIS: IpGeoApi[] = [
  { id: "ip-api", name: "ip-api.com", url: "http://ip-api.com/json/{{ip}}?lang=zh-CN", enabled: true, failCount: 0 },
  { id: "pconline", name: "太平洋电脑网", url: "https://whois.pconline.com.cn/ipJson.jsp?ip={{ip}}&json=true", enabled: true, failCount: 0 },
  { id: "ipwhois", name: "ipwho.is", url: "https://ipwho.is/{{ip}}?lang=zh-CN", enabled: true, failCount: 0 }
];
