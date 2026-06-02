import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import net from "net";

interface LiveSource {
  id: string;
  url: string;
  province: string;
  isp: string;
  status: "active" | "inactive" | "unknown" | "checking";
  latency?: number;
  lastChecked?: string;
}

interface Group {
  id: string;
  name: string;
}

interface Channel {
  id: string;
  name: string;
  logo: string;
  groupIds: string[];
  alias: string[];
  epgId: string;
  sources: LiveSource[];
}

interface SyncConfig {
  id: string;
  name: string;
  url: string;
  type: "m3u" | "txt";
  autoSync: boolean;
  syncInterval: number; // working in hours (e.g. 1, 6, 12, 24)
  lastSynced?: string;
  status: "success" | "failed" | "never";
  message?: string;
}

interface TestStatus {
  status: "idle" | "running";
  total: number;
  checked: number;
  results: {
    id: string;
    channelId: string;
    url: string;
    status: "active" | "inactive";
    latency?: number;
  }[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "iptv_data.json");

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-Memory Database State
let groups: Group[] = [];
let channels: Channel[] = [];
let syncConfigs: SyncConfig[] = [];
const testStatus: TestStatus = {
  status: "idle",
  total: 0,
  checked: 0,
  results: [],
};

// Normalize channel names by making them lower-case and stripping all spaces/whitespace to support smart matching (e.g., "cctv-1 综合" matches "cctv-1综合")
function normalizeChannelName(name: string): string {
  if (!name) return "";
  let clean = name.toLowerCase().replace(/\s+/g, "");
  
  // Custom smart matching for CCTV channels (e.g., CCTV-1, CCTV1, CCTV1HD, CCTV-1综合, CCTV-1 综合HD, cctv 1, CCTV 5+)
  // We match cctv followed by optional separator and a digit, plus optional "+"
  const cctvMatch = clean.match(/^cctv[-_]?(\d+)(\+)?/);
  if (cctvMatch) {
    const num = cctvMatch[1];
    const plus = cctvMatch[2] || "";
    return `cctv${num}${plus}`;
  }
  
  // For other channels, remove hyphens, spaces, and common quality tags to improve match rates
  return clean
    .replace(/[-_.\s]+/g, "")
    .replace(/(hd|ud|4k|8k|高清|超清|标清|sdi|channel|tv)/g, "");
}

// Generate default epgId from channel name. CCTV5 and CCTV5+ are distinguished by keeping '+'. If processed epgId is empty, fallback to channel name.
function generateDefaultEpgId(name: string): string {
  if (!name) return "";
  let processed = name.toLowerCase().replace(/[^a-z0-9+]/g, "");
  return processed || name;
}

interface DefaultAliasGroup {
  template: string;
  aliases: string[];
}

const loadedDefaultAliases: DefaultAliasGroup[] = [];

function loadDefaultAliases() {
  const filePath = path.join(DATA_DIR, "default_aliases.txt");
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      loadedDefaultAliases.length = 0; // reset
      for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        // strip vertical bars or other common garbage
        if (line.startsWith("|")) {
          line = line.substring(1).trim();
        }
        const parts = line.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length > 0) {
          const template = parts[0];
          const aliases = Array.from(new Set([template, ...parts]));
          loadedDefaultAliases.push({ template, aliases });
        }
      }
      console.log(`[Aliases] Loaded ${loadedDefaultAliases.length} default channel alias templates.`);
    } catch (e) {
      console.error("[Aliases] Failed to load default_aliases.txt", e);
    }
  }
}

// Helper to look up if rawName matches any known template/alias and return standard name + list of all known aliases
function findAliasTemplate(rawName: string): { templateName: string; aliases: string[] } | null {
  const normRaw = normalizeChannelName(rawName);
  if (!normRaw) return null;
  for (const group of loadedDefaultAliases) {
    if (group.aliases.some(a => normalizeChannelName(a) === normRaw)) {
      return {
        templateName: group.template,
        aliases: group.aliases,
      };
    }
  }
  return null;
}

// Seed Data
const DEFAULT_GROUPS: Group[] = [
  { id: "g_yangshi", name: "央视频道" },
  { id: "g_weishi", name: "卫视频道" },
  { id: "g_local", name: "地方频道" },
  { id: "g_other", name: "其它频道" }
];

const DEFAULT_CHANNELS: Channel[] = [
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
  }
];

const DEFAULT_SYNC_CONFIGS: SyncConfig[] = [
  {
    id: "sc-1",
    name: "範例 IPTV GitHub 源",
    url: "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",
    type: "m3u",
    autoSync: true,
    syncInterval: 12,
    status: "never",
  }
];

// Load Database from disk
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(content);
      channels = parsed.channels || [];
      syncConfigs = parsed.syncConfigs || [];
      groups = parsed.groups || [];
    } else {
      channels = DEFAULT_CHANNELS;
      syncConfigs = DEFAULT_SYNC_CONFIGS;
      groups = DEFAULT_GROUPS;
      saveData();
    }

    // Run Migration: if groups collection or channel groupIds are missing
    if (groups.length === 0) {
      // Build unique categories from channels
      const uniqueCats = new Set<string>();
      channels.forEach((c: any) => {
        if (c.category) uniqueCats.add(c.category);
      });
      if (uniqueCats.size === 0) {
        groups = [...DEFAULT_GROUPS];
      } else {
        groups = Array.from(uniqueCats).map((catName) => ({
          id: "g_" + Math.random().toString(36).substring(2, 10),
          name: catName,
        }));
      }
    }

    // Ensure all channels have groupIds array and map old category
    channels.forEach((c: any) => {
      if (!c.groupIds) {
        c.groupIds = [];
      }
      if (c.category) {
        let matchingGroup = groups.find((g) => g.name === c.category);
        if (!matchingGroup) {
          matchingGroup = {
            id: "g_" + Math.random().toString(36).substring(2, 10),
            name: c.category,
          };
          groups.push(matchingGroup);
        }
        if (!c.groupIds.includes(matchingGroup.id)) {
          c.groupIds.push(matchingGroup.id);
        }
      }
      // Guarantee at least one group membership
      if (c.groupIds.length === 0) {
        let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
        if (!otherGroup) {
          otherGroup = { id: "g_other", name: "其它频道" };
          groups.push(otherGroup);
        }
        c.groupIds.push(otherGroup.id);
      }
    });

  } catch (error) {
    console.error("Failed to load IPTV data, applying default seed data:", error);
    channels = DEFAULT_CHANNELS;
    syncConfigs = DEFAULT_SYNC_CONFIGS;
    groups = DEFAULT_GROUPS;
  }
}

// Save Database to disk
function saveData() {
  try {
    const backup = {
      groups,
      channels,
      syncConfigs,
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(backup, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save IPTV data to file:", error);
  }
}

// Automated Daily Backup of iptv_data.json to prevent accidental data loss
function checkAndPerformDailyBackup() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      return; // No data to backup yet
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    
    const backupFileName = `iptv_data_backup_${dateStr}.json`;
    const backupFilePath = path.join(DATA_DIR, backupFileName);
    
    if (!fs.existsSync(backupFilePath)) {
      console.log(`[Backup] Generating daily backup: ${backupFileName}`);
      fs.copyFileSync(DATA_FILE, backupFilePath);
      
      // Keep last 30 backups to prevent storage leaks
      cleanOldBackups();
    }
  } catch (err) {
    console.error("[Backup] Daily automated backup failed:", err);
  }
}

function cleanOldBackups() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const backupFiles = files
      .filter((f) => f.startsWith("iptv_data_backup_") && f.endsWith(".json"))
      .sort(); // Sorting list ascends alphabetically (oldest daily date first due to YYYY-MM-DD formatting)
      
    if (backupFiles.length > 30) {
      const extraBackups = backupFiles.slice(0, backupFiles.length - 30);
      for (const fileToDelete of extraBackups) {
        fs.unlinkSync(path.join(DATA_DIR, fileToDelete));
        console.log(`[Backup] Retained last 30 daily backups, deleted old backup: ${fileToDelete}`);
      }
    }
  } catch (err) {
    console.error("[Backup] Error cleaning up old backups:", err);
  }
}

loadDefaultAliases();
loadData();
checkAndPerformDailyBackup();

// Utility function to map URL and parse ISP/Province
function parseIspAndProvince(name: string): { province: string; isp: string } {
  let province = "全国";
  let isp = "BGP";

  const provinces = [
    "北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏",
    "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南",
    "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏",
    "宁夏", "新疆", "香港", "澳门"
  ];
  for (const p of provinces) {
    if (name.includes(p)) {
      province = p;
      break;
    }
  }

  const isps = [
    { key: "电信", label: "电信" },
    { key: "联通", label: "联通" },
    { key: "移动", label: "移动" },
    { key: "广电", label: "广电" },
    { key: "铁通", label: "铁通" },
    { key: "BGP", label: "BGP" }
  ];
  for (const i of isps) {
    if (name.includes(i.key) || name.toLowerCase().includes(i.key.toLowerCase())) {
      isp = i.label;
      break;
    }
  }

  return { province, isp };
}

// URL Testing Engine
async function testSingleUrl(url: string, timeoutMs: number = 3000): Promise<{ status: "active" | "inactive"; latency: number }> {
  const startTime = Date.now();

  // Support RTSP stream checks using standard TCP port check
  if (url.startsWith("rtsp://")) {
    try {
      const withoutProtocol = url.substring(7);
      const slNameIndex = withoutProtocol.indexOf("/");
      const hostPortPart = slNameIndex === -1 ? withoutProtocol : withoutProtocol.substring(0, slNameIndex);
      
      const atIndex = hostPortPart.indexOf("@");
      const endpointPart = atIndex === -1 ? hostPortPart : hostPortPart.substring(atIndex + 1);
      
      let host = "";
      let port = 554; // default RTSP port
      
      if (endpointPart.startsWith("[")) {
        const closingBracket = endpointPart.indexOf("]");
        if (closingBracket !== -1) {
          host = endpointPart.substring(1, closingBracket);
          const remaining = endpointPart.substring(closingBracket + 1);
          if (remaining.startsWith(":")) {
            port = parseInt(remaining.substring(1), 10) || 554;
          }
        } else {
          host = endpointPart;
        }
      } else {
        const colonIndex = endpointPart.lastIndexOf(":");
        if (colonIndex !== -1) {
          host = endpointPart.substring(0, colonIndex);
          port = parseInt(endpointPart.substring(colonIndex + 1), 10) || 554;
        } else {
          host = endpointPart;
          port = 554;
        }
      }

      return new Promise((resolve) => {
        const socket = net.connect({
          host,
          port,
          timeout: timeoutMs
        }, () => {
          const latency = Date.now() - startTime;
          socket.destroy();
          resolve({ status: "active", latency });
        });

        socket.on("error", () => {
          socket.destroy();
          resolve({ status: "inactive", latency: Date.now() - startTime });
        });

        socket.on("timeout", () => {
          socket.destroy();
          resolve({ status: "inactive", latency: Date.now() - startTime });
        });
      });
    } catch (e) {
      return { status: "inactive", latency: Date.now() - startTime };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // We send a HTTP fetch request. Many stream servers support HEAD and GET.
    // To be fast, we use GET with AbortController so we cancel after receiving headers or first chunk.
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    clearTimeout(timeoutId);
    
    // Check if the status code indicates streaming success (200 OK or 206 Partial Content)
    if (response.ok) {
      const latency = Date.now() - startTime;
      
      // Let's cancel the request body streaming immediately to save container bandwidth
      try {
        if (response.body) {
          const reader = response.body.getReader();
          await reader.cancel();
        }
      } catch (err) {
        // Safe stream cancellation ignore
      }

      return { status: "active", latency };
    } else {
      return { status: "inactive", latency: Date.now() - startTime };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    return { status: "inactive", latency: Date.now() - startTime };
  }
}

// Thread-pool model for Concurrent Bulk Tests
async function runConcurrentTest(selectedSources: { id: string; channelId: string; url: string }[], concurrency = 8) {
  testStatus.status = "running";
  testStatus.total = selectedSources.length;
  testStatus.checked = 0;
  testStatus.results = [];

  const queue = [...selectedSources];

  const runWorker = async () => {
    while (queue.length > 0) {
      if (testStatus.status !== "running") break;
      const item = queue.shift();
      if (!item) continue;

      // Update in-flight status
      updateSourceDbStatus(item.channelId, item.id, "checking", undefined);

      const result = await testSingleUrl(item.url);

      updateSourceDbStatus(item.channelId, item.id, result.status, result.latency);

      testStatus.checked++;
      testStatus.results.push({
        id: item.id,
        channelId: item.channelId,
        url: item.url,
        status: result.status,
        latency: result.latency,
      });
    }
  };

  const pool = Array.from({ length: Math.min(concurrency, queue.length) }, runWorker);
  await Promise.all(pool);

  testStatus.status = "idle";
  saveData();
}

function updateSourceDbStatus(channelId: string, sourceId: string, status: "active" | "inactive" | "checking" | "unknown", latency?: number) {
  const channel = channels.find((c) => c.id === channelId);
  if (channel) {
    const source = channel.sources.find((s) => s.id === sourceId);
    if (source) {
      source.status = status;
      if (latency !== undefined) {
        source.latency = latency;
      }
      source.lastChecked = new Date().toISOString();
    }
  }
}

// Synchronizer for M3U and TXT
async function performSync(config: SyncConfig) {
  try {
    // Process Github URL: converts github.com/user/repo/blob/branch/file to raw.githubusercontent.com
    let targetUrl = config.url;
    if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }

    const res = await fetch(targetUrl, {
      headers: { "User-Agent": "IPTV-Manager-Sync-Service" },
    });

    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }

    const content = await res.text();
    let importedChannelsCount = 0;
    let importedSourcesCount = 0;

    if (config.type === "m3u" || content.includes("#EXTM3U")) {
      // Parse M3U
      const lines = content.split(/\r?\n/);
      let currentInfo: {
        name: string;
        logo: string;
        category: string;
        alias: string[];
        epgId: string;
      } | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXTINF:")) {
          // Parse #EXTINF Properties
          // Extended metadata extraction using dynamic regex
          const logoMatch = line.match(/tvg-logo="([^"]+)"/) || line.match(/logo="([^"]+)"/);
          const groupMatch = line.match(/group-title="([^"]+)"/);
          const epgMatch = line.match(/tvg-id="([^"]+)"/) || line.match(/epg-id="([^"]+)"/);
          
          const commaIndex = line.indexOf(",");
          let name = "未知频道";
          if (commaIndex !== -1) {
            name = line.substring(commaIndex + 1).trim();
          }

          currentInfo = {
            name,
            logo: logoMatch ? logoMatch[1] : "",
            category: groupMatch ? groupMatch[1] : "其它频道",
            alias: [name],
            epgId: epgMatch ? epgMatch[1] : generateDefaultEpgId(name),
          };
        } else if (line && !line.startsWith("#") && currentInfo) {
          // Play stream URL matching current channel
          const url = line;
          const { province, isp } = parseIspAndProvince(currentInfo.name + " " + currentInfo.category);

          // Find or create correct Group entities for this category (comma/semicolon split for many-to-many relationship)
          const catNames = currentInfo.category.split(/[,;，；]/).map(s => s.trim()).filter(Boolean);
          if (catNames.length === 0) catNames.push("其它频道");
          
          const matchedGroupIds: string[] = [];
          for (const catName of catNames) {
            let existingGroup = groups.find(g => g.name.toLowerCase() === catName.toLowerCase());
            if (!existingGroup) {
              existingGroup = {
                id: "g_" + Math.random().toString(36).substring(2, 10),
                name: catName,
              };
              groups.push(existingGroup);
            }
            matchedGroupIds.push(existingGroup.id);
          }

          // Find standard template/alias group from default aliases
          const stdInfo = findAliasTemplate(currentInfo!.name);
          const lookupName = stdInfo ? stdInfo.templateName : currentInfo!.name;

          // Find existing channel by name, standard template name, or any associated alias
          let channel = channels.find(
            (c) =>
              normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
              c.alias.some((a) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
              (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))))
          );

          if (!channel) {
            const channelId = "ch_" + Math.random().toString(36).substring(2, 10);
            const cleanName = stdInfo ? stdInfo.templateName : currentInfo!.name;
            const cleanAliases = stdInfo 
              ? Array.from(new Set([cleanName, currentInfo!.name, ...stdInfo.aliases]))
              : currentInfo!.alias;

            channel = {
              id: channelId,
              name: cleanName,
              logo: currentInfo!.logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
              groupIds: matchedGroupIds,
              alias: cleanAliases,
              epgId: currentInfo!.epgId,
              sources: [],
            };
            channels.push(channel);
            importedChannelsCount++;
          } else {
            // Append group IDs if any new ones are imported
            matchedGroupIds.forEach(gId => {
              if (!channel!.groupIds.includes(gId)) {
                channel!.groupIds.push(gId);
              }
            });
            // Auto pre-populate missing aliases from standard configuration
            if (stdInfo) {
              stdInfo.aliases.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
            }
          }

          // Add source if URL not already there
          if (!channel.sources.some((s) => s.url === url)) {
            channel.sources.push({
              id: "src_" + Math.random().toString(36).substring(2, 10),
              url,
              province,
              isp,
              status: "unknown",
            });
            importedSourcesCount++;
          }

          currentInfo = null; // reset
        }
      }
    } else {
      // Parse Custom TVBox TXT format
      // Category,#genre
      // Channel,url1
      // Channel2#电信,url2
      const lines = content.split(/\r?\n/);
      let currentCategory = "其它频道";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.includes(",#genre")) {
          currentCategory = line.split(",")[0].trim();
        } else if (line.includes(",")) {
          const parts = line.split(",");
          const nameWithSpecs = parts[0].trim();
          const url = parts[1].trim();

          const { province, isp } = parseIspAndProvince(nameWithSpecs + " " + currentCategory);
          // Strip ISP and specifications from standard channel title
          const name = nameWithSpecs.split("#")[0].trim();

          // Resolve group
          const catNames = currentCategory.split(/[,;，；]/).map(s => s.trim()).filter(Boolean);
          if (catNames.length === 0) catNames.push("其它频道");

          const matchedGroupIds: string[] = [];
          for (const catName of catNames) {
            let existingGroup = groups.find(g => g.name.toLowerCase() === catName.toLowerCase());
            if (!existingGroup) {
              existingGroup = {
                id: "g_" + Math.random().toString(36).substring(2, 10),
                name: catName,
              };
              groups.push(existingGroup);
            }
            matchedGroupIds.push(existingGroup.id);
          }

          const stdInfo = findAliasTemplate(name);
          const lookupName = stdInfo ? stdInfo.templateName : name;

          let channel = channels.find(
            (c) =>
              normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
              c.alias.some((a) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
              (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))))
          );

          if (!channel) {
            const channelId = "ch_" + Math.random().toString(36).substring(2, 10);
            const cleanName = stdInfo ? stdInfo.templateName : name;
            const cleanAliases = stdInfo 
              ? Array.from(new Set([cleanName, name, ...stdInfo.aliases]))
              : [name];

            channel = {
              id: channelId,
              name: cleanName,
              logo: "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
              groupIds: matchedGroupIds,
              alias: cleanAliases,
              epgId: generateDefaultEpgId(cleanName),
              sources: [],
            };
            channels.push(channel);
            importedChannelsCount++;
          } else {
            // Append group matchings
            matchedGroupIds.forEach(gId => {
              if (!channel!.groupIds.includes(gId)) {
                channel!.groupIds.push(gId);
              }
            });
            if (stdInfo) {
              stdInfo.aliases.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
            }
          }

          if (!channel.sources.some((s) => s.url === url)) {
            channel.sources.push({
              id: "src_" + Math.random().toString(36).substring(2, 10),
              url,
              province,
              isp,
              status: "unknown",
            });
            importedSourcesCount++;
          }
        }
      }
    }

    config.status = "success";
    config.lastSynced = new Date().toISOString();
    config.message = `成功导入 ${importedChannelsCount} 个频道，${importedSourcesCount} 个新直播源`;
    saveData();
    return true;
  } catch (err: any) {
    config.status = "failed";
    config.lastSynced = new Date().toISOString();
    config.message = `同步失败: ${err.message || err}`;
    saveData();
    return false;
  }
}

// Background Cron-like Scheduler to perform Scheduled Sync
setInterval(() => {
  const now = new Date();
  
  // Periodically check and perform daily backups to prevent accidental loss
  checkAndPerformDailyBackup();

  for (const config of syncConfigs) {
    if (config.autoSync) {
      const hoursSinceSync = config.lastSynced
        ? (now.getTime() - new Date(config.lastSynced).getTime()) / (1000 * 3600)
        : Infinity;

      if (hoursSinceSync >= config.syncInterval) {
        console.log(`Starting automated sync for task: ${config.name}`);
        performSync(config);
      }
    }
  }
}, 60 * 1000); // Check tasks every minute

// Express Setup Configuration
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // API Endpoints
  // Group CRUD Endpoints
  app.get("/api/groups", (req, res) => {
    res.json(groups);
  });

  app.post("/api/groups", (req, res) => {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "分组名称不能为空" });
    }
    const newGroup: Group = {
      id: "g_" + Math.random().toString(36).substring(2, 10),
      name,
    };
    groups.push(newGroup);
    saveData();
    res.status(201).json(newGroup);
  });

  app.put("/api/groups/:id", (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    const group = groups.find((g) => g.id === id);
    if (!group) {
      return res.status(404).json({ error: "未找到该分组" });
    }
    if (name) group.name = name;
    saveData();
    res.json(group);
  });

  app.delete("/api/groups/:id", (req, res) => {
    const { id } = req.params;
    groups = groups.filter((g) => g.id !== id);

    // Remove group reference from all channels
    channels.forEach((c) => {
      c.groupIds = c.groupIds.filter((gId) => gId !== id);
      // Ensure it has at least one group
      if (c.groupIds.length === 0) {
        let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
        if (!otherGroup) {
          otherGroup = { id: "g_other", name: "其它频道" };
          groups.push(otherGroup);
        }
        c.groupIds.push(otherGroup.id);
      }
    });

    saveData();
    res.json({ success: true, message: "分组删除成功" });
  });

  app.get("/api/channels", (req, res) => {
    res.json(channels);
  });

  app.post("/api/channels", (req, res) => {
    const { name, groupIds, category, logo, alias, epgId } = req.body;
    if (!name) {
      return res.status(400).json({ error: "频道名称为必填项" });
    }

    let resolvedGroupIds: string[] = [];
    if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
      resolvedGroupIds = groupIds;
    } else if (category) {
      let g = groups.find((g) => g.name === category);
      if (!g) {
        g = { id: "g_" + Math.random().toString(36).substring(2, 10), name: category };
        groups.push(g);
      }
      resolvedGroupIds = [g.id];
    }

    if (resolvedGroupIds.length === 0) {
      let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
      if (!otherGroup) {
        otherGroup = { id: "g_other", name: "其它频道" };
        groups.push(otherGroup);
      }
      resolvedGroupIds = [otherGroup.id];
    }

    const newChannel: Channel = {
      id: "ch_" + Math.random().toString(36).substring(2, 10),
      name,
      groupIds: resolvedGroupIds,
      logo: logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
      alias: alias ? (Array.isArray(alias) ? alias : alias.split(",").map((s: string) => s.trim())) : [name],
      epgId: epgId || generateDefaultEpgId(name),
      sources: []
    };

    channels.push(newChannel);
    saveData();
    res.status(201).json(newChannel);
  });

  app.put("/api/channels/:id", (req, res) => {
    const { id } = req.params;
    const { name, groupIds, category, logo, alias, epgId } = req.body;

    const channel = channels.find((c) => c.id === id);
    if (!channel) {
      return res.status(404).json({ error: "未找到该频道" });
    }

    if (name) channel.name = name;
    
    if (groupIds && Array.isArray(groupIds)) {
      channel.groupIds = groupIds;
    } else if (category) {
      let g = groups.find((g) => g.name === category);
      if (!g) {
        g = { id: "g_" + Math.random().toString(36).substring(2, 10), name: category };
        groups.push(g);
      }
      channel.groupIds = [g.id];
    }

    if (logo !== undefined) channel.logo = logo;
    if (alias !== undefined) {
      channel.alias = Array.isArray(alias) ? alias : alias.split(",").map((s: string) => s.trim());
    }
    if (epgId !== undefined) channel.epgId = epgId;

    saveData();
    res.json(channel);
  });

  app.delete("/api/channels/:id", (req, res) => {
    const { id } = req.params;
    const initialLength = channels.length;
    channels = channels.filter((c) => c.id !== id);

    if (channels.length === initialLength) {
      return res.status(404).json({ error: "未找到该频道" });
    }

    saveData();
    res.json({ success: true, message: "频道删除成功" });
  });

  // Batch delete channels
  app.post("/api/channels/batch-delete", (req, res) => {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供要删除的频道 ID 列表" });
    }

    const initialLength = channels.length;
    channels = channels.filter((c) => !channelIds.includes(c.id));

    saveData();
    res.json({ success: true, count: initialLength - channels.length });
  });

  // Batch update channel groups
  app.post("/api/channels/batch-groups", (req, res) => {
    const { channelIds, groupIds } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供目标频道 ID 列表" });
    }
    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: "请提供合法的分组 ID 列表" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      if (channelIds.includes(c.id)) {
        c.groupIds = groupIds;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Batch remove channel from a single group
  app.post("/api/channels/batch-remove-group", (req, res) => {
    const { channelIds, groupId } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供目标频道 ID 列表" });
    }
    if (!groupId) {
      return res.status(400).json({ error: "请提供目标分组 ID" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      if (channelIds.includes(c.id)) {
        if (Array.isArray(c.groupIds)) {
          const index = c.groupIds.indexOf(groupId);
          if (index > -1) {
            c.groupIds.splice(index, 1);
            updatedCount++;
          }
        }
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Source endpoints
  app.post("/api/channels/:channelId/sources", (req, res) => {
    const { channelId } = req.params;
    const { url, province, isp } = req.body;

    if (!url) {
      return res.status(400).json({ error: "播放链接为必填项" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const newSource: LiveSource = {
      id: "src_" + Math.random().toString(36).substring(2, 10),
      url,
      province: province || "全国",
      isp: isp || "BGP",
      status: "unknown",
    };

    channel.sources.push(newSource);
    saveData();
    res.status(201).json(newSource);
  });

  app.put("/api/channels/:channelId/sources/:sourceId", (req, res) => {
    const { channelId, sourceId } = req.params;
    const { url, province, isp, status } = req.body;

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const source = channel.sources.find((s) => s.id === sourceId);
    if (!source) {
      return res.status(404).json({ error: "未找到直播源" });
    }

    if (url) source.url = url;
    if (province) source.province = province;
    if (isp) source.isp = isp;
    if (status) source.status = status;

    saveData();
    res.json(source);
  });

  app.delete("/api/channels/:channelId/sources/:sourceId", (req, res) => {
    const { channelId, sourceId } = req.params;
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const initialLength = channel.sources.length;
    channel.sources = channel.sources.filter((s) => s.id !== sourceId);

    if (channel.sources.length === initialLength) {
      return res.status(404).json({ error: "未找到直播源" });
    }

    saveData();
    res.json({ success: true, message: "直播源删除成功" });
  });

  // Batch delete live sources of a channel
  app.post("/api/channels/:channelId/sources/batch-delete", (req, res) => {
    const { channelId } = req.params;
    const { sourceIds } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要删除的直播线路 ID 列表" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const initialCount = channel.sources.length;
    channel.sources = channel.sources.filter((s) => !sourceIds.includes(s.id));
    const deletedCount = initialCount - channel.sources.length;

    saveData();
    res.json({ success: true, count: deletedCount });
  });

  // Batch update live sources ISP and Province
  app.post("/api/channels/:channelId/sources/batch-update", (req, res) => {
    const { channelId } = req.params;
    const { sourceIds, isp, province } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要操作的直播线路 ID 列表" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    let updatedCount = 0;
    channel.sources.forEach((s) => {
      if (sourceIds.includes(s.id)) {
        if (isp !== undefined && isp !== null && isp !== "") {
          s.isp = isp;
        }
        if (province !== undefined && province !== null && province !== "") {
          s.province = province;
        }
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Global batch update live sources
  app.post("/api/sources/global-batch-update", (req, res) => {
    const { sourceIds, isp, province, status } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要操作的直播线路 ID 列表" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      c.sources.forEach((s) => {
        if (sourceIds.includes(s.id)) {
          if (isp !== undefined && isp !== null && isp !== "") {
            s.isp = isp;
          }
          if (province !== undefined && province !== null && province !== "") {
            s.province = province;
          }
          if (status !== undefined && status !== null && status !== "") {
            s.status = status;
          }
          updatedCount++;
        }
      });
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Global batch delete live sources
  app.post("/api/sources/global-batch-delete", (req, res) => {
    const { sourceIds } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要删除的直播线路 ID 列表" });
    }

    let deletedCount = 0;
    channels.forEach((c) => {
      const initialCount = c.sources.length;
      c.sources = c.sources.filter((s) => !sourceIds.includes(s.id));
      deletedCount += (initialCount - c.sources.length);
    });

    if (deletedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: deletedCount });
  });

  // Bulk Upload File Handler Endpoint
  app.post("/api/import/file", (req, res) => {
    const { content, type } = req.body;
    if (!content) {
      return res.status(400).json({ error: "文件内容不能为空" });
    }

    try {
      const isM3u = type === "m3u" || content.includes("#EXTM3U");
      let importedChannelsCount = 0;
      let importedSourcesCount = 0;

      if (isM3u) {
        const lines = content.split(/\r?\n/);
        let currentInfo: any = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("#EXTINF:")) {
            const logoMatch = line.match(/tvg-logo="([^"]+)"/) || line.match(/logo="([^"]+)"/);
            const groupMatch = line.match(/group-title="([^"]+)"/);
            const epgMatch = line.match(/tvg-id="([^"]+)"/) || line.match(/epg-id="([^"]+)"/);
            
            const commaIndex = line.indexOf(",");
            let name = "未知频道";
            if (commaIndex !== -1) {
              name = line.substring(commaIndex + 1).trim();
            }

            currentInfo = {
              name,
              logo: logoMatch ? logoMatch[1] : "",
              category: groupMatch ? groupMatch[1] : "手动导入",
              alias: [name],
              epgId: epgMatch ? epgMatch[1] : generateDefaultEpgId(name),
            };
          } else if (line && !line.startsWith("#") && currentInfo) {
            const url = line;
            const { province, isp } = parseIspAndProvince(currentInfo.name + " " + currentInfo.category);

            // Resolve categories
            const catNames = currentInfo.category.split(/[,;，；]/).map((s: string) => s.trim()).filter(Boolean);
            if (catNames.length === 0) catNames.push("手动导入");

            const matchedGroupIds: string[] = [];
            for (const catName of catNames) {
              let existingGroup = groups.find((g) => g.name.toLowerCase() === catName.toLowerCase());
              if (!existingGroup) {
                existingGroup = {
                  id: "g_" + Math.random().toString(36).substring(2, 10),
                  name: catName,
                };
                groups.push(existingGroup);
              }
              matchedGroupIds.push(existingGroup.id);
            }

            const stdInfo = findAliasTemplate(currentInfo.name);
            const lookupName = stdInfo ? stdInfo.templateName : currentInfo.name;

            let channel = channels.find(
              (c) =>
                normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
                c.alias.some((a: string) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
                (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))))
            );

            if (!channel) {
              const cleanName = stdInfo ? stdInfo.templateName : currentInfo.name;
              const cleanAliases = stdInfo
                ? Array.from(new Set([cleanName, currentInfo.name, ...stdInfo.aliases]))
                : currentInfo.alias;

              channel = {
                id: "ch_" + Math.random().toString(36).substring(2, 10),
                name: cleanName,
                logo: currentInfo.logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
                groupIds: matchedGroupIds,
                alias: cleanAliases,
                epgId: currentInfo.epgId,
                sources: [],
              };
              channels.push(channel);
              importedChannelsCount++;
            } else {
              matchedGroupIds.forEach((gId) => {
                if (!channel!.groupIds.includes(gId)) {
                  channel!.groupIds.push(gId);
                }
              });
              if (stdInfo) {
                stdInfo.aliases.forEach(a => {
                  if (!channel!.alias.includes(a)) {
                    channel!.alias.push(a);
                  }
                });
              }
            }

            if (!channel.sources.some((s) => s.url === url)) {
              channel.sources.push({
                id: "src_" + Math.random().toString(36).substring(2, 10),
                url,
                province,
                isp,
                status: "unknown",
              });
              importedSourcesCount++;
            }
            currentInfo = null;
          }
        }
      } else {
        // Parse TVBox TXT
        const lines = content.split(/\r?\n/);
        let currentCategory = "手动导入";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          if (line.includes(",#genre")) {
            currentCategory = line.split(",")[0].trim();
          } else if (line.includes(",")) {
            const parts = line.split(",");
            const nameWithSpecs = parts[0].trim();
            const url = parts[1].trim();

            const { province, isp } = parseIspAndProvince(nameWithSpecs + " " + currentCategory);
            const name = nameWithSpecs.split("#")[0].trim();

            // Resolve categories
            const catNames = currentCategory.split(/[,;，；]/).map((s: string) => s.trim()).filter(Boolean);
            if (catNames.length === 0) catNames.push("手动导入");

            const matchedGroupIds: string[] = [];
            for (const catName of catNames) {
              let existingGroup = groups.find((g) => g.name.toLowerCase() === catName.toLowerCase());
              if (!existingGroup) {
                existingGroup = {
                  id: "g_" + Math.random().toString(36).substring(2, 10),
                  name: catName,
                };
                groups.push(existingGroup);
              }
              matchedGroupIds.push(existingGroup.id);
            }

            const stdInfo = findAliasTemplate(name);
            const lookupName = stdInfo ? stdInfo.templateName : name;

            let channel = channels.find(
              (c) =>
                normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
                c.alias.some((a: string) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
                (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))))
            );

            if (!channel) {
              const cleanName = stdInfo ? stdInfo.templateName : name;
              const cleanAliases = stdInfo
                ? Array.from(new Set([cleanName, name, ...stdInfo.aliases]))
                : [name];

              channel = {
                id: "ch_" + Math.random().toString(36).substring(2, 10),
                name: cleanName,
                logo: "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
                groupIds: matchedGroupIds,
                alias: cleanAliases,
                epgId: generateDefaultEpgId(cleanName),
                sources: [],
              };
              channels.push(channel);
              importedChannelsCount++;
            } else {
              matchedGroupIds.forEach((gId) => {
                if (!channel!.groupIds.includes(gId)) {
                  channel!.groupIds.push(gId);
                }
              });
              if (stdInfo) {
                stdInfo.aliases.forEach(a => {
                  if (!channel!.alias.includes(a)) {
                    channel!.alias.push(a);
                  }
                });
              }
            }

            if (!channel.sources.some((s) => s.url === url)) {
              channel.sources.push({
                id: "src_" + Math.random().toString(36).substring(2, 10),
                url,
                province,
                isp,
                status: "unknown",
              });
              importedSourcesCount++;
            }
          }
        }
      }

      saveData();
      res.json({
        success: true,
        message: `成功导入 ${importedChannelsCount} 个频道，${importedSourcesCount} 个直播播放源`,
      });
    } catch (err: any) {
      res.status(500).json({ error: `解析文件出错: ${err.message || err}` });
    }
  });

  // Auto-Sync Config endpoints
  app.get("/api/sync-configs", (req, res) => {
    res.json(syncConfigs);
  });

  app.post("/api/sync-configs", (req, res) => {
    const { name, url, type, autoSync, syncInterval } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "同步名称和URL为必填项" });
    }

    const newConfig: SyncConfig = {
      id: "sc_" + Math.random().toString(36).substring(2, 10),
      name,
      url,
      type: type || "m3u",
      autoSync: !!autoSync,
      syncInterval: Number(syncInterval) || 12,
      status: "never",
    };

    syncConfigs.push(newConfig);
    saveData();
    res.status(201).json(newConfig);
  });

  app.put("/api/sync-configs/:id", (req, res) => {
    const { id } = req.params;
    const { name, url, type, autoSync, syncInterval } = req.body;

    const config = syncConfigs.find((c) => c.id === id);
    if (!config) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    if (name) config.name = name;
    if (url) config.url = url;
    if (type) config.type = type;
    if (autoSync !== undefined) config.autoSync = autoSync;
    if (syncInterval !== undefined) config.syncInterval = Number(syncInterval);

    saveData();
    res.json(config);
  });

  app.delete("/api/sync-configs/:id", (req, res) => {
    const { id } = req.params;
    const initialLength = syncConfigs.length;
    syncConfigs = syncConfigs.filter((c) => c.id !== id);

    if (syncConfigs.length === initialLength) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    saveData();
    res.json({ success: true, message: "同步配置删除成功" });
  });

  // Manually Run Sync
  app.post("/api/sync-configs/:id/run", async (req, res) => {
    const { id } = req.params;
    const config = syncConfigs.find((c) => c.id === id);
    if (!config) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    config.status = "never";
    config.message = "正在进行后台同步...";
    
    // Run sync asynchronously, but response could wait or return status
    const success = await performSync(config);
    if (success) {
      res.json({ success: true, message: "同步完成", config });
    } else {
      res.status(500).json({ error: "同步失败", config });
    }
  });

  // Link validation & latency speed checking triggered by browser
  app.post("/api/sources/test", (req, res) => {
    const { sourceIds, channelIds, concurrency } = req.body;

    if (testStatus.status === "running") {
      return res.status(400).json({ error: "已有正在运行的批量测速任务" });
    }

    // Capture files to check
    let targetSources: { id: string; channelId: string; url: string }[] = [];

    channels.forEach((channel) => {
      if (channelIds && !channelIds.includes(channel.id)) return;
      channel.sources.forEach((source) => {
        if (sourceIds && !sourceIds.includes(source.id)) return;
        targetSources.push({
          id: source.id,
          channelId: channel.id,
          url: source.url,
        });
      });
    });

    if (targetSources.length === 0) {
      return res.status(400).json({ error: "未选择可用的直播源进行测试" });
    }

    // Run task asynchronously
    const targetConcurrency = Number(concurrency) || 8;
    runConcurrentTest(targetSources, targetConcurrency);

    res.json({
      success: true,
      message: "批量多线程测速任务启动成功",
      task: {
        total: targetSources.length,
        status: "running"
      }
    });
  });

  app.get("/api/sources/test-status", (req, res) => {
    res.json(testStatus);
  });

  // Stop running batch test
  app.post("/api/sources/test-cancel", (req, res) => {
    if (testStatus.status === "running") {
      testStatus.status = "idle";
      res.json({ success: true, message: "测试已中断" });
    } else {
      res.json({ success: true, message: "当前没有正在运行的测试任务" });
    }
  });

  // EPG Generator Timeline Helper
  // Yields simulated EPG guide timelines for Chinese Television stations
  app.get("/api/epg/guide", (req, res) => {
    const { channelId, date } = req.query;
    const targetDate = date ? String(date) : new Date().toISOString().split("T")[0];

    // Build responsive hourly program items based on category/channelId
    // Standard programs corresponding to general tastes
    const programsTemplate = [
      { time: "00:30", title: "深夜剧场：海外精选剧集" },
      { time: "06:00", title: "晨光早报：全球资讯连线" },
      { time: "07:30", title: "朝闻天下：今日头条聚焦" },
      { time: "09:00", title: "生活大百科：健康与膳食" },
      { time: "10:30", title: "纪录片：飞越神州大地" },
      { time: "12:00", title: "午间快报 / 新闻30分" },
      { time: "13:00", title: "午后星光影院 / 电视剧场" },
      { time: "15:30", title: "法治进行时：案例普法讲座" },
      { time: "17:00", title: "少儿卡通欢乐季：动画推荐" },
      { time: "18:00", title: "共同关注：社会热点探索" },
      { time: "19:00", title: "新闻联播 / 每日政经焦点" },
      { time: "19:30", title: "黄金档剧场：家和万事兴" },
      { time: "21:30", title: "今日关注 / 环球军事解析" },
      { time: "22:45", title: "晚间慢新闻 / 财经观察" },
      { time: "23:30", title: "体育集锦：巅峰竞技速览" },
    ];

    // Customize items to look extremely high fidelity based on station keywords
    const getSchedulesForChannel = (chId: string, chName: string) => {
      const lowerName = (chName || "").toLowerCase();
      if (lowerName.includes("体育") || lowerName.includes("cctv5") || lowerName.includes("cctv-5")) {
        return [
          { time: "00:00", title: "体育赛事录像：欧冠1/4决赛" },
          { time: "06:00", title: "健身舞动：早晨活力拉伸" },
          { time: "08:00", title: "体育新闻：晨报速递" },
          { time: "09:30", title: "实况录像：美职篮常规赛精选" },
          { time: "12:00", title: "体坛快讯：午间直击" },
          { time: "13:30", title: "排球经典回眸：女排超级联赛" },
          { time: "15:00", title: "直播：全国游泳大奖赛决赛" },
          { time: "18:00", title: "体育新闻：体育世界" },
          { time: "19:30", title: "直播：中超联赛第15轮焦点大战" },
          { time: "22:00", title: "天下足球：足坛风云人物" },
          { time: "23:30", title: "武林大会：中国传统武术争霸" },
        ];
      }
      if (lowerName.includes("电影") || lowerName.includes("cctv6") || lowerName.includes("cctv-6")) {
        return [
          { time: "00:10", title: "译制经典：《肖申克的救赎》" },
          { time: "06:00", title: "华语动作精选：《一代宗师》" },
          { time: "08:15", title: "中国电影报道：大牌探班" },
          { time: "09:00", title: "温情家庭影院：《寻找朱莉》" },
          { time: "11:50", title: "译制片大汇聚：《盗梦空间》" },
          { time: "14:10", title: "古装史诗大片：《赤壁(上)》" },
          { time: "17:00", title: "科幻高能影院：《流浪地球》" },
          { time: "19:05", title: "中国电影报道：金鸡奖巡礼" },
          { time: "20:15", title: "首播影院：新片独家推荐" },
          { time: "22:30", title: "悬疑佳作：《看不见的客人》" },
        ];
      }
      if (lowerName.includes("新闻") || lowerName.includes("cctv13") || lowerName.includes("cctv-13")) {
        return [
          { time: "00:00", title: "新闻直播间：国际全解析" },
          { time: "06:00", title: "朝闻天下：晨间资讯首发" },
          { time: "09:00", title: "新闻直播间：国内整点聚焦" },
          { time: "12:00", title: "新闻30分：快报直达" },
          { time: "12:30", title: "每周质量报告：消费提示" },
          { time: "13:00", title: "新闻直播间：各地新闻资讯" },
          { time: "18:00", title: "共同关注：温暖民生故事" },
          { time: "19:00", title: "新闻联播：政经要闻" },
          { time: "19:35", title: "焦点访谈：深度舆论监督" },
          { time: "20:00", title: "东方时空：大国重器系列" },
          { time: "21:30", title: "新闻1+1：时事热点微评" },
          { time: "22:00", title: "国际时讯：环球视野" },
          { time: "23:00", title: "24小时：今日核心梳理" },
        ];
      }
      return programsTemplate;
    };

    if (channelId) {
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        return res.json({
          channelId,
          channelName: channel.name,
          date: targetDate,
          epgId: channel.epgId,
          programs: getSchedulesForChannel(channel.id, channel.name),
        });
      }
    }

    // Yield mappings for all matched channels
    const guideMap = channels.map((c) => ({
      channelId: c.id,
      channelName: c.name,
      epgId: c.epgId,
      programs: getSchedulesForChannel(c.id, c.name),
    }));

    res.json({ date: targetDate, guides: guideMap });
  });

  // CUSTOM EXPORTS/PLAYBACK API INTERFACE
  // Third-party players consume this!
  // Example usage: http://localhost:3000/api/export/m3u?isp=电信&status=active
  // Example usage: http://localhost:3000/api/export/txt?province=北京
  app.get("/api/export/m3u", (req, res) => {
    const { category, isp, province, status, limit } = req.query;

    let playlistRows = ["#EXTM3U x-tvg-url=\"http://epg.51zmt.top:12182/xml/chinas.xml.gz\""];

    let count = 0;
    const maxLimit = limit ? Number(limit) : Infinity;

    channels.forEach((channel) => {
      channel.groupIds.forEach((gId) => {
        const group = groups.find((g) => g.id === gId);
        const groupName = group ? group.name : "其它频道";

        // Filter group level if specific category selected
        if (category && groupName !== String(category) && gId !== String(category)) return;

        channel.sources.forEach((source) => {
          if (count >= maxLimit) return;

          // Filter source levels by ISP, province or status
          if (isp && source.isp !== String(isp)) return;
          if (province && source.province !== String(province)) return;
          if (status && source.status !== String(status)) return;

          // Extra details label
          const suffix = (source.province && source.province !== "全国") || source.isp
            ? ` (${source.province || ""}${source.isp ? " " + source.isp : ""})`
            : "";
          const channelDisplayName = `${channel.name}${suffix}`;

          playlistRows.push(
            `#EXTINF:-1 tvg-id="${channel.epgId}" tvg-name="${channel.name}" tvg-logo="${channel.logo}" group-title="${groupName}",${channelDisplayName}`
          );
          playlistRows.push(source.url);
          count++;
        });
      });
    });

    res.setHeader("Content-Type", "application/x-mpegurl");
    res.setHeader("Content-Disposition", "attachment; filename=\"iptv_custom.m3u\"");
    res.send(playlistRows.join("\n"));
  });

  // TXT (TVBox compatible) format
  app.get("/api/export/txt", (req, res) => {
    const { category, isp, province, status, limit } = req.query;

    const exportMap = new Map<string, string[]>();

    let count = 0;
    const maxLimit = limit ? Number(limit) : Infinity;

    channels.forEach((channel) => {
      channel.groupIds.forEach((gId) => {
        const group = groups.find((g) => g.id === gId);
        const groupName = group ? group.name : "其它频道";

        if (category && groupName !== String(category) && gId !== String(category)) return;

        channel.sources.forEach((source) => {
          if (count >= maxLimit) return;
          if (isp && source.isp !== String(isp)) return;
          if (province && source.province !== String(province)) return;
          if (status && source.status !== String(status)) return;

          const catName = groupName;
          if (!exportMap.has(catName)) {
            exportMap.set(catName, []);
          }

          const suffix = (source.province && source.province !== "全国") || source.isp
            ? `#${source.province || ""}${source.isp ? " " + source.isp : ""}`
            : "";
          const channelDisplayStr = `${channel.name}${suffix},${source.url}`;
          
          exportMap.get(catName)!.push(channelDisplayStr);
          count++;
        });
      });
    });

    const fileRows: string[] = [];
    exportMap.forEach((lines, catName) => {
      fileRows.push(`${catName},#genre`);
      fileRows.push(...lines);
      fileRows.push(""); // empty spacing
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"iptv_custom.txt\"");
    res.send(fileRows.join("\n"));
  });

  // Dynamic EPG XML TV interface
  // Returns generic valid XMLTV layout for connected players matching epgIds
  app.get("/api/export/epg.xml", (req, res) => {
    const xmlHeader = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="IPTV Channel Manager" generator-info-url="http://localhost:3000/">`;

    const channelTags = channels.map((c) => {
      return `  <channel id="${c.epgId}">
    <display-name lang="zh">${c.name}</display-name>
    <icon src="${c.logo}" />
  </channel>`;
    }).join("\n");

    // Build timeline XML tags
    const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
    
    const programTemplates = [
      { start: "000000", stop: "060000", title: "深夜温情院线" },
      { start: "060000", stop: "090000", title: "早晨第一线新闻" },
      { start: "090000", stop: "120000", title: "经典文娱纪实节目" },
      { start: "120000", stop: "130000", title: "午间时势观察" },
      { start: "130000", stop: "180000", title: "午后黄金人气戏剧" },
      { start: "180000", stop: "190000", title: "傍晚热门民生探索" },
      { start: "190000", stop: "200000", title: "晚间新闻报道集锦" },
      { start: "200000", stop: "223000", title: "金牌晚间档品质剧场" },
      { start: "223000", stop: "235959", title: "深夜体育与军事视界" },
    ];

    const programTags = channels.map((c) => {
      return programTemplates.map((p) => {
        return `  <programme start="${todayStr}${p.start} +0800" stop="${todayStr}${p.stop} +0800" channel="${c.epgId}">
    <title lang="zh">${p.title}</title>
    <desc lang="zh">由 IPTV 电视服务自动同步 matching epg channel id [${c.epgId}]。</desc>
  </programme>`;
      }).join("\n");
    }).join("\n");

    const xmlFooter = `</tv>`;
    
    res.setHeader("Content-Type", "application/xml");
    res.send(`${xmlHeader}\n${channelTags}\n${programTags}\n${xmlFooter}`);
  });

  // Clean-up and optimization APIs
  app.post("/api/cleanup/inactive", (req, res) => {
    let affectedCount = 0;
    channels.forEach((channel) => {
      const initialLength = channel.sources.length;
      channel.sources = channel.sources.filter((s) => s.status !== "inactive");
      affectedCount += (initialLength - channel.sources.length);
    });

    saveData();
    res.json({ success: true, message: `成功清理 ${affectedCount} 个失效链接直播源` });
  });

  // DB Manual Backup & Restore APIs
  app.get("/api/backups", (req, res) => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        return res.json({ success: true, backups: [] });
      }
      const files = fs.readdirSync(DATA_DIR);
      const backupFiles = files
        .filter((f) => f.startsWith("iptv_data_backup_") && f.endsWith(".json"))
        .sort()
        .reverse(); // Newest first
      
      const backups = backupFiles.map((filename) => {
        const filePath = path.join(DATA_DIR, filename);
        const stat = fs.statSync(filePath);
        let size = stat.size;
        let channelCount = 0;
        let groupCount = 0;
        let tag = "自动备份";
        let isManual = false;
        
        if (filename.includes("_manual_") || filename.includes("_manual")) {
          isManual = true;
          tag = "手动备份";
        }
        
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(content);
          channelCount = parsed.channels ? parsed.channels.length : 0;
          groupCount = parsed.groups ? parsed.groups.length : 0;
          if (parsed.backupMeta && parsed.backupMeta.tag) {
            tag = parsed.backupMeta.tag;
            isManual = true;
          }
        } catch (e) {
          // Ignored
        }
        
        return {
          filename,
          createdAt: stat.mtime || stat.birthtime,
          size,
          type: isManual ? "manual" : "auto",
          tag,
          channelCount,
          groupCount
        };
      });
      
      res.json({ success: true, backups });
    } catch (err: any) {
      res.status(500).json({ error: "获取备份列表失败: " + err.message });
    }
  });

  app.post("/api/backups", (req, res) => {
    try {
      const { tag } = req.body;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      
      const safeTag = tag ? tag.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "").substring(0, 20) : "手动备份";
      const filename = `iptv_data_backup_manual_${timestamp}.json`;
      const filePath = path.join(DATA_DIR, filename);
      
      const backupContent = {
        groups,
        channels,
        syncConfigs,
        backupMeta: {
          tag: safeTag,
          createdAt: now.toISOString(),
          type: "manual"
        }
      };
      
      fs.writeFileSync(filePath, JSON.stringify(backupContent, null, 2), "utf-8");
      res.json({ success: true, message: "备份已成功创建", filename, tag: safeTag });
    } catch (err: any) {
      res.status(500).json({ error: "创建备份失败: " + err.message });
    }
  });

  app.post("/api/backups/restore", (req, res) => {
    try {
      const { filename, content } = req.body;
      
      // Save current database as prior backup to prevent accidental loss
      const autoBackupName = `iptv_data_backup_before_restore_${Date.now()}.json`;
      if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(DATA_FILE, path.join(DATA_DIR, autoBackupName));
      }

      if (content) {
        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          return res.status(400).json({ error: "备份文件JSON解析失败，请检查文件内容" });
        }

        if (!parsed.channels && !parsed.groups) {
          return res.status(400).json({ error: "备份文件格式不正确 (未检测到 channels 或 groups 根节点)" });
        }
        
        fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), "utf-8");
        loadData();
        return res.json({ success: true, message: "手动导入备份恢复成功！原有数据已备份为备份文件：" + autoBackupName });
      }
      
      if (!filename) {
        return res.status(400).json({ error: "参数错误: filename 或者是 JSON 备份内容 (content) 不能为空" });
      }
      
      const safeFilename = path.basename(filename);
      const filePath = path.join(DATA_DIR, safeFilename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "未找到指定的备份文件: " + safeFilename });
      }
      
      fs.copyFileSync(filePath, DATA_FILE);
      loadData();
      res.json({ success: true, message: "成功恢复到指定备份，数据已实时刷新！先前版本已自动备份为 " + autoBackupName });
    } catch (err: any) {
      res.status(500).json({ error: "恢复备份失败: " + err.message });
    }
  });

  app.delete("/api/backups/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "未找到指定的备份文件" });
      }
      fs.unlinkSync(filePath);
      res.json({ success: true, message: "备份已成功删除" });
    } catch (err: any) {
      res.status(500).json({ error: "删除备份失败: " + err.message });
    }
  });

  app.get("/api/backups/download/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(440).send("File not found");
      }
      res.download(filePath, filename);
    } catch (err: any) {
      res.status(500).send("下载备份文件发生错误: " + err.message);
    }
  });

  // Build Vite Middleware Setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serves static bundle in Production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Bind to PORT 3000 and 0.0.0.0
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server loaded with ${channels.length} channels, running on http://localhost:${PORT}`);
  });
}

startServer();
