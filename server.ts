import express from "express";
import path from "path";
import fs from "fs";

// Ensure local time is interpreted as CST (UTC+8) by default if not specified
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

import { createServer as createViteServer } from "vite";
import net from "net";
import { XMLParser } from "fast-xml-parser";
import zlib from "zlib";
import http from "http";
import https from "https";
import crypto from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
import Database from "better-sqlite3";

interface LiveSource {
  id: string;
  url: string;
  province: string;
  isp: string;
  status: "active" | "inactive" | "unknown" | "checking";
  latency?: number;
  lastChecked?: string;
  clientIspReported?: string;
  clientProvinceReported?: string;
  isolated?: boolean;
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
  disabled?: boolean;
  consecutiveFailures?: number;
  contentHash?: string;
  isp?: string;
}

interface EpgSource {
  id: string;
  name: string;
  url: string;
  active: boolean;
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
let epgSources: EpgSource[] = [];
let adminPassword = process.env.ADMIN_PASSWORD || "";
let githubProxy = "";
let autoCreateChannel = true;

const SQLITE_DB_PATH = path.join(DATA_DIR, "iptv_sqlite.db");
let db: Database.Database;

function initSqlite() {
  db = new Database(SQLITE_DB_PATH);
  
  // Enable WAL mode for high performance concurrency and stability
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Create tables structured for fast access
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT,
      groupIds TEXT,
      alias TEXT,
      epgId TEXT
    );
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      url TEXT NOT NULL,
      province TEXT,
      isp TEXT,
      status TEXT,
      latency INTEGER,
      lastChecked TEXT,
      clientIspReported TEXT,
      clientProvinceReported TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      type TEXT,
      autoSync INTEGER,
      syncInterval INTEGER,
      lastSynced TEXT,
      status TEXT,
      message TEXT,
      disabled INTEGER,
      consecutiveFailures INTEGER,
      contentHash TEXT,
      isp TEXT
    );
    CREATE TABLE IF NOT EXISTS epg_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      active INTEGER,
      lastSynced TEXT,
      status TEXT,
      message TEXT
    );
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      startTime TEXT,
      intervalMinutes INTEGER,
      active INTEGER DEFAULT 0,
      lastRun TEXT,
      nextRun TEXT
    );
    CREATE TABLE IF NOT EXISTS cron_logs (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      runAt TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Ensure optimized indices for speedy lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sources_channelId ON sources(channelId);
    CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);
  `);

  // Seed default cron jobs if empty
  const hasCronJobs = db.prepare("SELECT COUNT(*) as count FROM cron_jobs").get() as { count: number };
  if (hasCronJobs.count === 0) {
    const insertCronJob = db.prepare(`
      INSERT INTO cron_jobs (id, name, startTime, intervalMinutes, active)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertCronJob.run("job_epg_sync", "EPG 自动同步", "02:00", 1440, 0); // default inactive, daily at 2AM
    insertCronJob.run("job_github_import", "GitHub 源自动导入", "03:00", 1440, 0); // default inactive, daily at 3AM
  }
}

const EPG_CACHE_DIR = path.join(DATA_DIR, "epg_cache_sources");
if (!fs.existsSync(EPG_CACHE_DIR)) {
  fs.mkdirSync(EPG_CACHE_DIR, { recursive: true });
}

// In-Memory cache for loaded EPG configurations to avoid reading from disk on every route hit
const loadedEpgCaches: Record<string, Record<string, { displayNames: string[], programs: { start: string, stop: string, title: string, desc: string }[] }>> = {};
const testStatus: TestStatus = {
  status: "idle",
  total: 0,
  checked: 0,
  results: [],
};

// Strip bitrate and resolution details from channel names (e.g. CCTV13 4M1080 -> CCTV13, iHot爱青春 7.5M1080 -> iHot爱青春)
function stripBitrateAndResolution(name: string): string {
  if (!name) return "";
  let clean = name.trim();

  // Remove common Chinese/English quality tags optionally appended mid-string or at the end
  clean = clean.replace(/(?:\s+|-|_)*(?:高清|超清|标清|蓝光|原画|1080[pPiI]|720[pPiI]|576[pPiI]|480[pPiI]|4[kK]|8[kK]|HEVC|hevc|H265|h265|H264|h264)+/g, " ");

  // Remove bracketed resolution or bitrate, e.g. "[1080p]", "(4M1080)", "[7.5M1080]"
  clean = clean.replace(/[\[(]\s*(?:480|576|720|1080|1280|1440|1920|2160|4320|[48][kK]|\d+(?:\.\d+)?[MmGg]\d*)[pPiI]?\s*[\])]/gi, "");

  // Remove trailing or mid-string bandwidth and pixel specs (e.g., " 4M1080", " 7.5M1080", " 8M")
  clean = clean.replace(/(?:\s+|-|_)+(?:\d+(?:\.\d+)?[MmGg](?:[bB][pP][sS])?\d*[pPiI]?)/gi, "");

  // Remove trailing or mid-string numerical resolution tags (e.g., " 1080", " 720")
  clean = clean.replace(/(?:\s+|-|_)+(?:(?:480|576|720|1080|1280|1440|1920|2160|4320|[48][kK])(?:[pPiI]\d*|fps|FPS)?|\d+[pPiI]\d*)/gi, "");

  // Remove empty brackets or parentheses remaining from substitutions
  clean = clean.replace(/[\[(（【]\s*[\])）】]/g, ""); // First remove empty pairs like ( ) or （ ）
  clean = clean.replace(/(?:\s+|-|_)*[\[()（）【】\]]/g, ""); // Then remove leftover standalone bracket characters

  return clean.trim();
}

// Normalize channel names by making them lower-case and stripping all spaces/whitespace to support smart matching (e.g., "cctv-1 综合" matches "cctv-1综合")
function normalizeChannelName(name: string): string {
  if (!name) return "";
  const stripped = stripBitrateAndResolution(name);
  let clean = stripped.toLowerCase().replace(/\s+/g, "");
  
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
    .replace(/(hd|uhd|fhd|ud|4k|8k|高清|超清|标清|sdi|channel|tv)/g, "");
}

// Generate default epgId from channel name. CCTV5 and CCTV5+ are distinguished by keeping '+'. If processed epgId is empty, fallback to channel name.
function generateDefaultEpgId(name: string): string {
  if (!name) return "";
  // 1. Strip bitrate and resolution first
  let clean = stripBitrateAndResolution(name);
  
  // 2. Convert to lowercase
  clean = clean.toLowerCase();

  // 3. Remove spaces, hyphens, dots, underscores, braces, brackets, and common symbol noise
  clean = clean.replace(/[-_.\s※\(\)\[\]{\\}/]+/g, "");

  // 4. Custom matching for CCTV channels (CCTV-1, CCTV5+, CCTV-6电影, etc.)
  const cctvMatch = clean.match(/^cctv[-_]?(\d+)(\+)?/);
  if (cctvMatch) {
    const num = cctvMatch[1];
    const plus = cctvMatch[2] || "";
    return `cctv${num}${plus}`;
  }

  // 5. Remove quality/format words but ONLY if they are not the sole text.
  // Let's remove them safely. If we remove 'hd' from 'hbo hd', we want 'hbo'.
  // But if the word is exactly 'hd' or empty after removal, we fallback so we don't return empty.
  const noiseRegex = /(fhd|uhd|hd|sd|hevc|h265|h264|1080p|720p|4k|8k|高清|超清|标清|sdi|channel|tv)/g;
  let withoutNoise = clean.replace(noiseRegex, "");
  if (withoutNoise.trim().length > 0) {
    clean = withoutNoise;
  }

  // 6. Return lowercase alphanumeric/Chinese sequence, or fallback to normalized text if empty
  let processed = clean.trim();
  return processed || name.toLowerCase().trim();
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

// Load Database from disk/SQLite
function loadData() {
  try {
    initSqlite();

    let legacyJsonFound = false;
    let parsed: any = null;

    // Check if the legacy json exists (initial transition or restored backup)
    if (fs.existsSync(DATA_FILE)) {
      console.log("[Migration] Found legacy/restored JSON data file. Loading and Syncing...");
      try {
        const content = fs.readFileSync(DATA_FILE, "utf-8");
        parsed = JSON.parse(content);
        legacyJsonFound = true;
      } catch (e: any) {
        console.error("[Migration Error] Failed to parse legacy JSON:", e.message || e);
      }
    }

    if (legacyJsonFound && parsed) {
      channels = parsed.channels || [];
      syncConfigs = parsed.syncConfigs || [];
      groups = parsed.groups || [];
      epgSources = parsed.epgSources || [];
      if (parsed.adminPassword !== undefined) {
        adminPassword = parsed.adminPassword;
      }
      if (parsed.githubProxy !== undefined) {
        githubProxy = parsed.githubProxy;
      }
      if (parsed.autoCreateChannel !== undefined) {
        autoCreateChannel = !!parsed.autoCreateChannel;
      }

      // Populate SQLite with this state
      saveData();

      // Rename DATA_FILE so we don't migrate on every start
      try {
        const bakPath = DATA_FILE + ".bak";
        if (fs.existsSync(bakPath)) {
          fs.unlinkSync(bakPath); // remove old bak if any
        }
        fs.renameSync(DATA_FILE, bakPath);
        console.log(`[Migration] Legacy JSON file archived to ${bakPath}`);
      } catch (err: any) {
        console.error("[Migration Error] Failed to archive legacy JSON file:", err.message);
      }
    } else {
      // Load directly from SQLite
      const loadedSettings = db.prepare("SELECT * FROM settings").all();
      for (const row of loadedSettings as any[]) {
        if (row.key === "adminPassword") adminPassword = row.value;
        if (row.key === "githubProxy") githubProxy = row.value;
        if (row.key === "autoCreateChannel") autoCreateChannel = (row.value === "true" || row.value === "1");
      }

      const loadedGroups = db.prepare("SELECT * FROM groups").all();
      groups = loadedGroups.map((g: any) => ({
        id: g.id,
        name: g.name
      }));

      const loadedSyncConfigs = db.prepare("SELECT * FROM sync_configs").all();
      syncConfigs = loadedSyncConfigs.map((sc: any) => ({
        id: sc.id,
        name: sc.name,
        url: sc.url,
        type: sc.type,
        autoSync: sc.autoSync === 1,
        syncInterval: sc.syncInterval,
        lastSynced: sc.lastSynced || undefined,
        status: sc.status || "never",
        message: sc.message || undefined,
        disabled: sc.disabled === 1,
        consecutiveFailures: sc.consecutiveFailures || 0,
        contentHash: sc.contentHash || undefined,
        isp: sc.isp || undefined
      }));

      const loadedEpgSources = db.prepare("SELECT * FROM epg_sources").all();
      epgSources = loadedEpgSources.map((es: any) => ({
        id: es.id,
        name: es.name,
        url: es.url,
        active: es.active === 1,
        lastSynced: es.lastSynced || undefined,
        status: es.status || "never",
        message: es.message || undefined
      }));

      const dbChannels = db.prepare("SELECT * FROM channels").all();
      const dbSources = db.prepare("SELECT * FROM sources").all();
      const sourceMap = new Map<string, LiveSource[]>();
      
      for (const row of dbSources as any[]) {
        const src: LiveSource = {
          id: row.id,
          url: row.url,
          province: row.province || "",
          isp: row.isp || "",
          status: row.status || "unknown",
          latency: row.latency !== null ? row.latency : undefined,
          lastChecked: row.lastChecked || undefined,
          clientIspReported: row.clientIspReported || undefined,
          clientProvinceReported: row.clientProvinceReported || undefined
        };
        if (!sourceMap.has(row.channelId)) {
          sourceMap.set(row.channelId, []);
        }
        sourceMap.get(row.channelId)!.push(src);
      }

      channels = dbChannels.map((ch: any) => {
        let groupIds: string[] = [];
        try {
          groupIds = JSON.parse(ch.groupIds || "[]");
        } catch {
          groupIds = ch.groupIds ? ch.groupIds.split(",") : [];
        }

        let alias: string[] = [];
        try {
          alias = JSON.parse(ch.alias || "[]");
        } catch {}

        return {
          id: ch.id,
          name: ch.name,
          logo: ch.logo || "",
          groupIds,
          alias,
          epgId: ch.epgId || "",
          sources: sourceMap.get(ch.id) || []
        };
      });
    }

    // Auto seed default EPG / configs if SQLite was completely empty
    const hasChannels = db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number };
    if (hasChannels.count === 0 && channels.length === 0) {
      console.log("[SQLite Seed] Entire database is empty. Seeding defaults...");
      channels = DEFAULT_CHANNELS;
      syncConfigs = DEFAULT_SYNC_CONFIGS;
      groups = DEFAULT_GROUPS;
      epgSources = [
        {
          id: "epg_fanmingming",
          name: "Fanmingming 高速公开 EPG XML 源",
          url: "https://live.fanmingming.com/e.xml",
          active: true,
          status: "never",
        },
        {
          id: "epg_pw",
          name: "EPG.pw 公开 XML 源",
          url: "https://epg.pw/xmltv/epg_CN.xml",
          active: true,
          status: "never",
        }
      ];
      saveData();
    }

    // Run Migration: if groups collection or channel groupIds are missing
    let updated = false;
    
    // Migrate dead EPG sources
    epgSources.forEach((s) => {
      if (s.url === "http://epg.51zmt.top:11111/e.xml" || s.id === "epg_51zmt") {
        s.url = "https://epg.pw/xmltv/epg_CN.xml";
        s.name = "EPG.pw 公开 XML 源";
        s.id = "epg_pw";
        updated = true;
      }
    });

    if (groups.length === 0) {
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
      updated = true;
    }

    // Ensure all channels have groupIds array and map old category
    channels.forEach((c: any) => {
      if (!c.groupIds) {
        c.groupIds = [];
        updated = true;
      }
      if (c.category) {
        let matchingGroup = groups.find((g) => g.name === c.category);
        if (!matchingGroup) {
          matchingGroup = {
            id: "g_" + Math.random().toString(36).substring(2, 10),
            name: c.category,
          };
          groups.push(matchingGroup);
          updated = true;
        }
        if (!c.groupIds.includes(matchingGroup.id)) {
          c.groupIds.push(matchingGroup.id);
          updated = true;
        }
      }
      // Guarantee at least one group membership
      if (c.groupIds.length === 0) {
        let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
        if (!otherGroup) {
          otherGroup = { id: "g_other", name: "其它频道" };
          groups.push(otherGroup);
          updated = true;
        }
        c.groupIds.push(otherGroup.id);
        updated = true;
      }
    });

    // Validate or Repair Channel EPG IDs to resolve generic duplicates like "hd", "1080p", "4k" or blank EPG IDs
    channels.forEach((c: any) => {
      const invalidGenericIds = ["hd", "sd", "fhd", "uhd", "hevc", "h265", "h264", "1080p", "720p", "4k", "8k", "高清", "超清", "标清", "sdi", "channel", "tv"];
      if (!c.epgId || c.epgId.trim().length === 0 || (typeof c.epgId === "string" && invalidGenericIds.includes(c.epgId.toLowerCase().trim()))) {
        const freshEpgId = generateDefaultEpgId(c.name);
        if (freshEpgId !== c.epgId) {
          console.log(`[Repair EPG ID] Repairing bad/duplicate epgId "${c.epgId}" for channel "${c.name}" -> "${freshEpgId}"`);
          c.epgId = freshEpgId;
          updated = true;
        }
      }
    });

    if (updated) {
      saveData();
    }

  } catch (error) {
    console.error("Failed to load IPTV data from SQLite:", error);
    channels = DEFAULT_CHANNELS;
    syncConfigs = DEFAULT_SYNC_CONFIGS;
    groups = DEFAULT_GROUPS;
  }
}

// Save Database to SQLite disk
function saveData() {
  try {
    const syncDb = db.transaction(() => {
      // 1. Sync settings
      const insertSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      insertSetting.run("adminPassword", adminPassword);
      insertSetting.run("githubProxy", githubProxy);
      insertSetting.run("autoCreateChannel", autoCreateChannel ? "true" : "false");

      // 2. Sync groups
      db.exec("DELETE FROM groups");
      const insertGroup = db.prepare("INSERT INTO groups (id, name) VALUES (?, ?)");
      for (const g of groups) {
        insertGroup.run(g.id, g.name);
      }

      // 3. Sync channels & sources
      db.exec("DELETE FROM channels");
      db.exec("DELETE FROM sources");

      const insertChannel = db.prepare("INSERT INTO channels (id, name, logo, groupIds, alias, epgId) VALUES (?, ?, ?, ?, ?, ?)");
      const insertSource = db.prepare(`
        INSERT INTO sources (id, channelId, url, province, isp, status, latency, lastChecked, clientIspReported, clientProvinceReported)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const ch of channels) {
        insertChannel.run(
          ch.id,
          ch.name,
          ch.logo || "",
          JSON.stringify(ch.groupIds || []),
          JSON.stringify(ch.alias || []),
          ch.epgId || ""
        );

        if (ch.sources && ch.sources.length > 0) {
          for (const s of ch.sources) {
            insertSource.run(
              s.id,
              ch.id,
              s.url,
              s.province || "",
              s.isp || "",
              s.status || "unknown",
              s.latency !== undefined ? s.latency : null,
              s.lastChecked || "",
              s.clientIspReported || "",
              s.clientProvinceReported || ""
            );
          }
        }
      }

      // 4. Sync sync_configs
      db.exec("DELETE FROM sync_configs");
      const insertSync = db.prepare(`
        INSERT INTO sync_configs (id, name, url, type, autoSync, syncInterval, lastSynced, status, message, disabled, consecutiveFailures, contentHash, isp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sc of syncConfigs) {
        insertSync.run(
          sc.id,
          sc.name,
          sc.url,
          sc.type,
          sc.autoSync ? 1 : 0,
          sc.syncInterval,
          sc.lastSynced || "",
          sc.status || "never",
          sc.message || "",
          sc.disabled ? 1 : 0,
          sc.consecutiveFailures || 0,
          sc.contentHash || "",
          sc.isp || ""
        );
      }

      // 5. Sync epg_sources
      db.exec("DELETE FROM epg_sources");
      const insertEpg = db.prepare(`
        INSERT INTO epg_sources (id, name, url, active, lastSynced, status, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const epg of epgSources) {
        insertEpg.run(
          epg.id,
          epg.name,
          epg.url,
          epg.active ? 1 : 0,
          epg.lastSynced || "",
          epg.status || "never",
          epg.message || ""
        );
      }
    });

    syncDb();
  } catch (error) {
    console.error("Failed to save IPTV data to SQLite:", error);
  }
}

// Automated Daily Backup of SQLite to prevent accidental data loss
function checkAndPerformDailyBackup() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const sqlitePath = path.join(DATA_DIR, "iptv_sqlite.db");
    if (!fs.existsSync(sqlitePath)) {
      return; 
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    
    const backupDbName = `iptv_data_sqlite_backup_${dateStr}.db`;
    const backupDbPath = path.join(DATA_DIR, backupDbName);
    
    if (!fs.existsSync(backupDbPath)) {
      console.log(`[Backup] Generating daily automated SQLite snapshot: ${backupDbName}`);
      fs.copyFileSync(sqlitePath, backupDbPath);

      // Generate a companion restorable legacy JSON file
      const backupJsonName = `iptv_data_backup_${dateStr}.json`;
      const backupJsonPath = path.join(DATA_DIR, backupJsonName);
      if (!fs.existsSync(backupJsonPath)) {
        const backupJson = {
          groups,
          channels,
          syncConfigs,
          epgSources,
          adminPassword,
          githubProxy,
        };
        fs.writeFileSync(backupJsonPath, JSON.stringify(backupJson, null, 2), "utf-8");
      }
      
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
      .filter((f) => (f.startsWith("iptv_data_backup_") || f.startsWith("iptv_data_sqlite_backup_")) && (f.endsWith(".json") || f.endsWith(".db")))
      .sort(); // Sorting list ascends alphabetically
      
    if (backupFiles.length > 30) {
      const extraBackups = backupFiles.slice(0, backupFiles.length - 30);
      for (const fileToDelete of extraBackups) {
        fs.unlinkSync(path.join(DATA_DIR, fileToDelete));
        console.log(`[Backup] Deleted old backup: ${fileToDelete}`);
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

function ensureArray<T>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function getText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    if (node["#text"] !== undefined) return String(node["#text"]);
    if (node.text !== undefined) return String(node.text);
    for (const key in node) {
      if (typeof node[key] === "string" && key !== "lang") {
        return node[key];
      }
    }
  }
  return "";
}

function parseXmltvTime(timeStr: string): { dateStr: string, timeStr: string } {
  if (!timeStr) return { dateStr: "", timeStr: "" };
  const match = timeStr.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const [_, y, m, d, hh, mm, ss] = match;
    return {
      dateStr: `${y}-${m}-${d}`,
      timeStr: `${hh}:${mm}`
    };
  }
  return { dateStr: "", timeStr: "" };
}

function getEpgCache(sourceId: string) {
  const cachePath = path.join(EPG_CACHE_DIR, `${sourceId}.json`);
  if (!fs.existsSync(cachePath)) return null;
  if (loadedEpgCaches[sourceId]) {
    return loadedEpgCaches[sourceId];
  }
  try {
    const data = fs.readFileSync(cachePath, "utf-8");
    loadedEpgCaches[sourceId] = JSON.parse(data);
    return loadedEpgCaches[sourceId];
  } catch (err) {
    console.error(`[EPG CACHE LOAD ERROR] for ${sourceId}:`, err);
    return null;
  }
}

function findMatchingEpgEntry(ch: Channel, channelMap: Record<string, { displayNames: string[], programs: any[] }>) {
  if (ch.epgId) {
    if (channelMap[ch.epgId]) return channelMap[ch.epgId];
    const foundKey = Object.keys(channelMap).find(k => k.toLowerCase() === ch.epgId.toLowerCase());
    if (foundKey) return channelMap[foundKey];
  }
  const chNameNorm = normalizeChannelName(ch.name);
  const aliasNorms = (ch.alias || []).map(a => normalizeChannelName(a)).filter(Boolean);
  for (const originalId of Object.keys(channelMap)) {
    const entry = channelMap[originalId];
    const originalIdNorm = normalizeChannelName(originalId);
    if (ch.epgId && originalIdNorm === normalizeChannelName(ch.epgId)) {
      return entry;
    }
    if (originalIdNorm === chNameNorm || aliasNorms.includes(originalIdNorm)) {
      return entry;
    }
    for (const disp of entry.displayNames) {
      const dispNorm = normalizeChannelName(disp);
      if (dispNorm === chNameNorm || aliasNorms.includes(dispNorm)) {
        return entry;
      }
    }
  }
  return null;
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case "\"": return "&quot;";
      default: return c;
    }
  });
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("请先在 系统设置 > 密钥 (Settings > Secrets) 中配置您的 GEMINI_API_KEY！");
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return geminiClient;
}

const ipGeoCache = new Map<string, { province: string, isp: string }>();

async function getClientIpGeo(ipString: string): Promise<{ province: string, isp: string }> {
  let ip = (ipString || "").trim();
  if (ip.includes("::ffff:")) {
    ip = ip.replace("::ffff:", "");
  }
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") || ip.startsWith("172.19.") || ip.startsWith("172.2") || ip.startsWith("172.3")) {
    return { province: "", isp: "" };
  }

  if (ipGeoCache.has(ip)) {
    return ipGeoCache.get(ip)!;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const checkUrl = `http://ip-api.com/json/${ip}?lang=zh-CN`;
    const res = await fetch(checkUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "success") {
        let province = "";
        let isp = "";

        const regName = data.regionName || "";
        const ispStr = data.isp || "";

        const provinces = ["北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门"];
        for (const p of provinces) {
          if (regName.includes(p)) {
            province = p;
            break;
          }
        }

        const ispKeywords = [
          { keyword: "telecom", name: "电信" },
          { keyword: "unicom", name: "联通" },
          { keyword: "mobile", name: "移动" },
          { keyword: "chinanet", name: "电信" },
          { keyword: "broadband", name: "广电" },
          { keyword: "cantv", name: "广电" },
          { keyword: "chinasat", name: "广电" },
          { keyword: "电信", name: "电信" },
          { keyword: "联通", name: "联通" },
          { keyword: "移动", name: "移动" },
          { keyword: "铁通", name: "铁通" },
          { keyword: "广电", name: "广电" },
        ];
        
        for (const ik of ispKeywords) {
          if (ispStr.toLowerCase().includes(ik.keyword)) {
            isp = ik.name;
            break;
          }
        }

        const geo = { province, isp };
        console.log(`[IP GEO LOOKUP] Resolved IP ${ip}:`, geo);
        ipGeoCache.set(ip, geo);
        return geo;
      }
    }
  } catch (err: any) {
    console.error(`[IP GEO LOOKUP ERROR] for ${ip}:`, err.message || err);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`https://whois.pconline.com.cn/ipJson.jsp?ip=${ip}&json=true`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.pro) {
        let province = data.pro.replace("省", "").replace("市", "");
        let isp = "";
        const addr = data.addr || "";
        if (addr.includes("电信")) isp = "电信";
        else if (addr.includes("联通")) isp = "联通";
        else if (addr.includes("移动")) isp = "移动";
        else if (addr.includes("广电")) isp = "广电";
        
        const geo = { province, isp };
        console.log(`[IP GEO LOOKUP FALLBACK] Resolved IP ${ip}:`, geo);
        ipGeoCache.set(ip, geo);
        return geo;
      }
    }
  } catch (err: any) {
    console.error(`[IP GEO LOOKUP FALLBACK ERROR] for ${ip}:`, err.message || err);
  }

  return { province: "", isp: "" };
}

function sortSourcesByGeo(sources: LiveSource[], clientProvince: string, clientIsp: string): LiveSource[] {
  if (!clientProvince && !clientIsp) return sources;
  
  return [...sources].sort((a, b) => {
    const getScore = (s: LiveSource) => {
      let score = 0;
      const srcProv = (s.province || "").trim();
      const srcIsp = (s.isp || "").trim();

      const provinceMatch = clientProvince && srcProv && srcProv === clientProvince;
      const ispMatch = clientIsp && srcIsp && srcIsp === clientIsp;

      if (provinceMatch && ispMatch) {
        score += 100; // Exact province + ISP match
      } else if (provinceMatch) {
        score += 50;  // Province match only
      } else if (ispMatch && (srcProv === "全国" || !srcProv)) {
        score += 30;  // Nationwide + ISP match
      } else if (srcProv === "全国" || !srcProv) {
        score += 10;  // Nationwide only
      } else if (ispMatch) {
        score += 5;   // ISP match other province
      } else {
        score += 1;   // No match
      }
      return score;
    };

    return getScore(b) - getScore(a);
  });
}

function getPlayableSources(sources: LiveSource[], targetIsp: string, targetProvince: string): LiveSource[] {
  let filtered = [...sources].filter(s => !s.isolated);
  
  if (targetIsp) {
    const normTargetIsp = targetIsp.trim();
    filtered = filtered.filter(src => {
      const srcIsp = (src.isp || "").trim();
      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他") {
        return true;
      }
      const isBGP = srcIsp.toUpperCase().includes("BGP") || srcIsp.toUpperCase().includes("BPG");
      if (isBGP) {
        return true;
      }
      if (srcIsp === normTargetIsp) {
        return true;
      }
      return false;
    });
  }

  if (targetIsp || targetProvince) {
    filtered = sortSourcesByGeo(filtered, targetProvince, targetIsp);
  }

  return filtered;
}

async function fetchBufferWithFallback(urlStr: string, userAgent: string): Promise<{ buffer: Buffer; isGzipped: boolean }> {
  const downloadDirectly = (targetUrlStr: string, maxRedirects = 5): Promise<{ buffer: Buffer; isGzipped: boolean }> => {
    return new Promise((resolve, reject) => {
      if (maxRedirects < 0) {
        return reject(new Error("Too many redirects (max 5 redirects allowed)"));
      }
      try {
        const parsedUrl = new URL(targetUrlStr);
        const isHttps = parsedUrl.protocol === "https:";
        const httpClient = isHttps ? https : http;

        const headers: Record<string, string> = {
          "User-Agent": userAgent,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept": "*/*"
        };

        const options: any = {
          method: "GET",
          headers,
          timeout: 45000,
        };

        if (isHttps) {
          options.rejectUnauthorized = false; // Bypass all certificate failures (expired, self-signed, host mismatch, etc.)
        }

        const req = httpClient.request(parsedUrl, options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, parsedUrl.href).href;
            console.log(`[EPG SYNC RECOVERY] Following redirect: ${targetUrlStr} -> ${redirectUrl}`);
            return downloadDirectly(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP Error ${res.statusCode}`));
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const contentEncoding = res.headers["content-encoding"] || "";
            const isGzipped = (
              targetUrlStr.toLowerCase().endsWith(".gz") ||
              contentEncoding.toLowerCase().includes("gzip") ||
              (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b)
            );
            resolve({ buffer, isGzipped });
          });
        });

        req.on("error", (err) => {
          reject(err);
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new Error("EPG Sync request timeout (45s)"));
        });

        req.end();
      } catch (err) {
        reject(err);
      }
    });
  };

  try {
    const res = await fetch(urlStr, {
      headers: { "User-Agent": userAgent },
    });
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentEncoding = res.headers.get("content-encoding") || "";
    const isGzipped = (
      urlStr.toLowerCase().endsWith(".gz") ||
      contentEncoding.toLowerCase().includes("gzip") ||
      (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b)
    );
    return { buffer, isGzipped };
  } catch (fetchErr: any) {
    console.log(`[EPG SYNC] Standard fetch failed for ${urlStr}: ${fetchErr.message || fetchErr}. Attempting recovery via bypass direct fetch...`);
    try {
      return await downloadDirectly(urlStr);
    } catch (fallbackErr: any) {
      console.error(`[EPG SYNC RECOVERY FAILED] ${urlStr}: ${fallbackErr.message || fallbackErr}`);
      throw new Error(fallbackErr.message || "Fetch failed");
    }
  }
}

async function performEpgSync(source: EpgSource): Promise<boolean> {
  try {
    let targetUrl = source.url;
    if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com") && !targetUrl.includes("/raw/")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }
    if (githubProxy && (targetUrl.includes("github.com") || targetUrl.includes("githubusercontent.com"))) {
      const proxyPrefix = githubProxy.endsWith("/") ? githubProxy : `${githubProxy}/`;
      targetUrl = `${proxyPrefix}${targetUrl}`;
    }
    console.log(`[EPG SYNC] Fetching ${source.name} from: ${targetUrl}`);
    
    const { buffer, isGzipped } = await fetchBufferWithFallback(targetUrl, "IPTV-Manager-EPG-Sync-Service");
                     
    let xmlText = "";
    if (isGzipped) {
      console.log(`[EPG SYNC] Detected Gzip compression for ${source.name}. Decompressing...`);
      try {
        const decompressed = zlib.gunzipSync(buffer);
        xmlText = decompressed.toString("utf-8");
      } catch (gzErr: any) {
        throw new Error(`Gzip decompression failed: ${gzErr.message}`);
      }
    } else {
      xmlText = buffer.toString("utf-8");
    }

    if (!xmlText.trim().startsWith("<?xml") && !xmlText.includes("<tv")) {
      throw new Error("Invalid EPG XML content, missing <tv> root");
    }
    console.log(`[EPG SYNC] Parsing XML of length ${xmlText.length}...`);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ""
    });
    const parsed = parser.parse(xmlText);
    const channelMap: Record<string, { displayNames: string[], programs: { start: string, stop: string, title: string, desc: string }[] }> = {};
    const channelsList = ensureArray(parsed?.tv?.channel);
    for (const ch of channelsList) {
      const originalId = (ch as any).id;
      if (!originalId) continue;
      const displayNamesList = ensureArray((ch as any)["display-name"]).map(d => getText(d).trim()).filter(Boolean);
      channelMap[originalId] = {
        displayNames: displayNamesList,
        programs: []
      };
    }
    const programmesList = ensureArray(parsed?.tv?.programme);
    for (const prog of programmesList) {
      const chId = (prog as any).channel;
      if (!chId) continue;
      const start = (prog as any).start || "";
      const stop = (prog as any).stop || "";
      const title = getText((prog as any).title);
      const desc = getText((prog as any).desc);
      if (!channelMap[chId]) {
        channelMap[chId] = { displayNames: [], programs: [] };
      }
      channelMap[chId].programs.push({ start, stop, title, desc });
    }
    if (!fs.existsSync(EPG_CACHE_DIR)) {
      fs.mkdirSync(EPG_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(EPG_CACHE_DIR, `${source.id}.json`),
      JSON.stringify(channelMap, null, 2),
      "utf-8"
    );
    delete loadedEpgCaches[source.id]; // invalidate memory cache
    source.status = "success";
    source.lastSynced = new Date().toISOString();
    source.message = `同步成功，共导入 ${Object.keys(channelMap).length} 个频道节目源`;
    saveData();
    return true;
  } catch (error: any) {
    console.error(`[EPG SYNC ERROR] ${source.name}:`, error.message);
    source.status = "failed";
    source.message = error.message;
    source.lastSynced = new Date().toISOString();
    saveData();
    return false;
  }
}

// Synchronizer for M3U and TXT
async function performSync(config: SyncConfig, force = false) {
  try {
    // Process Github URL: converts github.com/user/repo/blob/branch/file to raw.githubusercontent.com
    let targetUrl = config.url;
    if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }

    // Apply GitHub Proxy if configured
    if (githubProxy && (targetUrl.includes("github.com") || targetUrl.includes("githubusercontent.com"))) {
      const proxyPrefix = githubProxy.endsWith("/") ? githubProxy : `${githubProxy}/`;
      targetUrl = `${proxyPrefix}${targetUrl}`;
    }

    console.log(`[SUBSCRIPTION SYNC] Fetching ${config.name} from: ${targetUrl}`);
    const { buffer } = await fetchBufferWithFallback(targetUrl, "IPTV-Manager-Sync-Service");

    const content = buffer.toString("utf-8");

    // Track update status by computing md5 checksum
    const freshHash = crypto.createHash("md5").update(content).digest("hex");
    if (!force && config.contentHash && config.contentHash === freshHash) {
      console.log(`[SUBSCRIPTION SYNC] No update detected for ${config.name}. Content hash matches.`);
      config.status = "success";
      config.lastSynced = new Date().toISOString();
      config.message = "同步完成 (检测到内容无新变化)";
      config.consecutiveFailures = 0;
      saveData();
      return true;
    }

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
          name = stripBitrateAndResolution(name);

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
          const { province, isp: parsedIsp } = parseIspAndProvince(currentInfo.name + " " + currentInfo.category);
          const isp = config.isp ? config.isp : parsedIsp;

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
            if (!autoCreateChannel) {
              currentInfo = null; // reset
              continue;
            }
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
            // Auto pre-populate missing aliases from standard configuration
            if (stdInfo) {
              stdInfo.aliases.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
            }
            // Update logo if current logo is auto-generated
            if (currentInfo!.logo && (!channel!.logo || channel!.logo.includes("unsplash.com") || channel!.logo === "")) {
              channel!.logo = currentInfo!.logo;
            }
          }

          // Add source if URL not already there
          const existingSrc = channel.sources.find((s) => s.url === url);
          if (!existingSrc) {
            channel.sources.push({
              id: "src_" + Math.random().toString(36).substring(2, 10),
              url,
              province,
              isp,
              status: "unknown",
            });
            importedSourcesCount++;
          } else if (config.isp) {
            existingSrc.isp = config.isp;
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

          const { province, isp: parsedIsp } = parseIspAndProvince(nameWithSpecs + " " + currentCategory);
          const isp = config.isp ? config.isp : parsedIsp;
          // Strip ISP and specifications from standard channel title
          let name = nameWithSpecs.split("#")[0].trim();
          name = stripBitrateAndResolution(name);

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
            if (!autoCreateChannel) {
              continue;
            }
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
            if (stdInfo) {
              // FORCE UPDATE channel name to the official alias template name
              channel.name = stdInfo.templateName;
              stdInfo.aliases.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
            }
          }

          const existingSrc = channel.sources.find((s) => s.url === url);
          if (!existingSrc) {
            channel.sources.push({
              id: "src_" + Math.random().toString(36).substring(2, 10),
              url,
              province,
              isp,
              status: "unknown",
            });
            importedSourcesCount++;
          } else if (config.isp) {
            existingSrc.isp = config.isp;
          }
        }
      }
    }

    config.contentHash = freshHash;
    config.status = "success";
    config.lastSynced = new Date().toISOString();
    config.message = `成功导入 ${importedChannelsCount} 个频道，${importedSourcesCount} 个新直播源`;
    config.consecutiveFailures = 0;
    saveData();
    return true;
  } catch (err: any) {
    config.consecutiveFailures = (config.consecutiveFailures || 0) + 1;
    config.status = "failed";
    config.lastSynced = new Date().toISOString();
    if (config.consecutiveFailures >= 3) {
      config.disabled = true;
      config.autoSync = false;
      config.message = `连续导入失败 ${config.consecutiveFailures} 次，已自动禁用: ${err.message || err}`;
    } else {
      config.message = `同步失败 (连续第 ${config.consecutiveFailures} 次失败): ${err.message || err}`;
    }
    saveData();
    return false;
  }
}


function calculateNextRun(startTime: string, intervalMinutes: number, lastRunStr: string | null): string {
  const now = new Date();
  let nextRunTime = new Date();
  
  if (startTime) {
    const [hours, minutes] = startTime.split(':').map(Number);
    nextRunTime.setHours(hours, minutes, 0, 0);
    
    // If nextRunTime is in the past, add intervals until it's in the future
    while (nextRunTime <= now) {
      if (intervalMinutes && intervalMinutes > 0) {
        nextRunTime.setTime(nextRunTime.getTime() + intervalMinutes * 60 * 1000);
      } else {
        nextRunTime.setDate(nextRunTime.getDate() + 1);
      }
    }
  } else if (intervalMinutes && intervalMinutes > 0) {
    if (lastRunStr) {
      nextRunTime = new Date(new Date(lastRunStr).getTime() + intervalMinutes * 60 * 1000);
      if (nextRunTime <= now) {
         nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
      }
    } else {
      nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
    }
  } else {
    nextRunTime.setDate(nextRunTime.getDate() + 1);
  }

  return nextRunTime.toISOString();
}

async function runCronJob(job: any) {
  const nowStr = new Date().toISOString();
  db.prepare("UPDATE cron_jobs SET lastRun = ? WHERE id = ?").run(nowStr, job.id);
  
  const insertLog = db.prepare("INSERT INTO cron_logs (id, jobId, runAt, status, message) VALUES (?, ?, ?, ?, ?)");
  const logId = Math.random().toString(36).substring(2, 10);
  
  try {
    if (job.id === "job_epg_sync") {
      let successCount = 0;
      const activeSources = epgSources.filter((s) => s.active);
      for (const source of activeSources) {
        const success = await performEpgSync(source);
        if (success) successCount++;
      }
      insertLog.run(logId, job.id, nowStr, "success", `成功同步 ${successCount}/${activeSources.length} 个 EPG 源`);
    } else if (job.id === "job_github_import") {
      let successCount = 0;
      const activeConfigs = syncConfigs.filter((c) => !c.disabled);
      for (const config of activeConfigs) {
        const success = await performSync(config);
        if (success) successCount++;
      }
      insertLog.run(logId, job.id, nowStr, "success", `成功同步 ${successCount}/${activeConfigs.length} 个 GitHub 订阅源`);
    } else {
      insertLog.run(logId, job.id, nowStr, "failed", "未知的定时任务 ID");
    }
  } catch (err: any) {
    insertLog.run(logId, job.id, nowStr, "failed", err.message || "执行失败");
  }
  
  // Update nextRun
  const nextRun = calculateNextRun(job.startTime, job.intervalMinutes, nowStr);
  db.prepare("UPDATE cron_jobs SET nextRun = ? WHERE id = ?").run(nextRun, job.id);
}

// Background Cron-like Scheduler to perform Scheduled Sync
setInterval(async () => {
  const now = new Date();
  const nowStr = now.toISOString();
  
  // Periodically check and perform daily backups to prevent accidental loss
  checkAndPerformDailyBackup();

  // Run new cron jobs
  const jobs = db.prepare("SELECT * FROM cron_jobs WHERE active = 1").all() as any[];
  for (const job of jobs) {
    if (!job.nextRun || new Date(job.nextRun) <= now) {
      console.log(`Starting scheduled cron job: ${job.name}`);
      await runCronJob(job);
    }
  }

}, 60 * 1000); // Check tasks every minute


// Express Setup Configuration
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // Prevent browser caching for all API routes
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  });


  // ==================== CRON JOBS ENDPOINTS ====================
  app.get("/api/cron-jobs", (req, res) => {
    try {
      const jobs = db.prepare("SELECT * FROM cron_jobs").all();
      res.json({ success: true, jobs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.put("/api/cron-jobs/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { startTime, intervalMinutes, active } = req.body;
      const nextRun = calculateNextRun(startTime, intervalMinutes, null);
      
      db.prepare("UPDATE cron_jobs SET startTime = ?, intervalMinutes = ?, active = ?, nextRun = ? WHERE id = ?")
        .run(startTime, intervalMinutes, active ? 1 : 0, nextRun, id);
        
      res.json({ success: true, message: "定时任务已更新" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/cron-jobs/:id/logs", (req, res) => {
    try {
      const { id } = req.params;
      const logs = db.prepare("SELECT * FROM cron_logs WHERE jobId = ? ORDER BY runAt DESC LIMIT 20").all(id);
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.post("/api/cron-jobs/:id/run", async (req, res) => {
    try {
      const { id } = req.params;
      const job = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as any;
      if (!job) return res.status(404).json({ error: "Job not found" });
      
      // Run async, don't wait for completion to send response if it takes too long, but we can wait for simple
      await runCronJob(job);
      res.json({ success: true, message: "手动触发执行成功" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });


  // ==================== AUTHENTICATION ENDPOINTS (PUBLIC) ====================
  // Get current authentication protection status
  app.get("/api/auth/status", (req, res) => {
    res.json({ passwordSet: !!adminPassword });
  });

  // Verify management password (login)
  app.post("/api/auth/verify", (req, res) => {
    const { password } = req.body;
    if (!adminPassword || password === adminPassword) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: "密码不正确，请重新输入" });
    }
  });

  // Change or set a new password
  app.post("/api/auth/set-password", (req, res) => {
    const { oldPassword, newPassword } = req.body;
    
    // If password is already set, verify old password first
    if (adminPassword && oldPassword !== adminPassword) {
      return res.status(401).json({ success: false, error: "原密码不正确，无法更新密码" });
    }
    
    adminPassword = (newPassword || "").trim();
    saveData();
    res.json({ 
      success: true, 
      message: adminPassword ? "管理保护密码已设置成功！" : "管理保护密码已清空，系统已解除密码校验保护" 
    });
  });

  // ==================== SECURITY ACTION MIDDLEWARE ====================
  app.use((req, res, next) => {
    // 0. Only protect /api/ routes. Static assets and index.html must remain public.
    if (!req.path.startsWith("/api/")) {
      return next();
    }

    // 1. Skip paths that must always be public for TV playback players, external probes or login verification
    const isPublicPath = 
      req.path.startsWith("/api/export/") || 
      req.path === "/api/epg/guide" || 
      req.path === "/api/sources/detect-ip" ||
      req.path === "/api/auth/status" ||
      req.path === "/api/auth/verify" ||
      req.path === "/api/sources/client-test-results" ||
      (req.path === "/api/channels" && req.method === "GET");
      
    if (isPublicPath) {
      return next();
    }

    // 2. If no admin password is set yet, bypass protection entirely
    if (!adminPassword) {
      return next();
    }

    // 3. Otherwise, check validation header
    const clientSecretHeader = req.headers["x-admin-password"];
    if (clientSecretHeader !== adminPassword) {
      return res.status(401).json({ 
        error: "Unauthorized: 您未提供管理密码或密码校验过期", 
        code: "AUTH_REQUIRED" 
      });
    }

    next();
  });

  // API Endpoints
  // Settings Endpoints
  app.get("/api/settings", (req, res) => {
    res.json({ githubProxy, autoCreateChannel });
  });

  app.post("/api/settings", (req, res) => {
    const { githubProxy: proxy, autoCreateChannel: autoCreate } = req.body;
    if (proxy !== undefined) {
      githubProxy = (proxy || "").trim();
    }
    if (autoCreate !== undefined) {
      autoCreateChannel = !!autoCreate;
    }
    saveData();
    res.json({ success: true, githubProxy, autoCreateChannel });
  });

  // EPG Sources REST Endpoints
  app.get("/api/epg-sources", (req, res) => {
    res.json(epgSources);
  });

  app.post("/api/epg-sources", (req, res) => {
    const { name, url, active } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "EPG名称和URL不能为空" });
    }
    const newSource: EpgSource = {
      id: "epg_" + Math.random().toString(36).substring(2, 10),
      name: name.trim(),
      url: url.trim(),
      active: active === undefined ? true : !!active,
      status: "never",
    };
    epgSources.push(newSource);
    saveData();
    res.json({ success: true, source: newSource });
  });

  app.put("/api/epg-sources/:id", (req, res) => {
    const { id } = req.params;
    const { name, url, active } = req.body;
    const source = epgSources.find((s) => s.id === id);
    if (!source) {
      return res.status(404).json({ error: "未找到该 EPG 源" });
    }
    if (name !== undefined) source.name = name.trim();
    if (url !== undefined) source.url = url.trim();
    if (active !== undefined) source.active = !!active;
    saveData();
    res.json({ success: true, source });
  });

  app.delete("/api/epg-sources/:id", (req, res) => {
    const { id } = req.params;
    const initialLen = epgSources.length;
    epgSources = epgSources.filter((s) => s.id !== id);
    if (epgSources.length === initialLen) {
      return res.status(404).json({ error: "EPG源不存在" });
    }
    // Delete cache file if exists
    try {
      const cachePath = path.join(EPG_CACHE_DIR, `${id}.json`);
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
      delete loadedEpgCaches[id];
    } catch (_) {}
    saveData();
    res.json({ success: true });
  });

  app.post("/api/epg-sources/:id/sync", async (req, res) => {
    const { id } = req.params;
    const source = epgSources.find((s) => s.id === id);
    if (!source) {
      return res.status(404).json({ error: "未找到该 EPG 源" });
    }
    const success = await performEpgSync(source);
    res.json({ success, source });
  });

  app.post("/api/epg-sources/sync-all", async (req, res) => {
    let successCount = 0;
    const activeSources = epgSources.filter((s) => s.active);
    for (const source of activeSources) {
      const success = await performEpgSync(source);
      if (success) successCount++;
    }
    res.json({ success: true, count: activeSources.length, successCount });
  });

  // Group CRUD Endpoints
  
  // Isolate (soft-delete) or restore a source
  app.post("/api/channels/:channelId/sources/:sourceId/isolate", (req, res) => {
    const { channelId, sourceId } = req.params;
    const { isolated } = req.body;
    
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    
    const source = channel.sources.find((s) => s.id === sourceId);
    if (!source) return res.status(404).json({ error: "Source not found" });
    
    source.isolated = !!isolated;
    saveData();
    
    res.json({ success: true, isolated: source.isolated });
  });

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

  
  app.post("/api/groups/reorder", (req, res) => {
    const { groupIds } = req.body;
    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: "请提供合法的分组 ID 列表" });
    }
    
    const newGroups: typeof groups = [];
    groupIds.forEach(id => {
      const g = groups.find(g => g.id === id);
      if (g) newGroups.push(g);
    });
    
    // Add any missing groups to the end
    groups.forEach(g => {
      if (!newGroups.some(ng => ng.id === g.id)) {
        newGroups.push(g);
      }
    });
    
    groups = newGroups;
    saveData();
    res.json({ success: true });
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

  app.get("/api/channels", async (req, res) => {
    const { status, only_active, full, all, isp, province, ip, clientIp } = req.query;

    if (full === "true" || all === "true") {
      if (status === "active" || only_active === "true") {
        const filtered = channels.map((ch) => ({
          ...ch,
          sources: (ch.sources || []).filter((src) => src.status === "active" && !src.isolated)
        })).filter((ch) => ch.sources.length > 0);
        return res.json(filtered);
      } else if (status === "test" || status === "testable" || status === "active,unknown" || status === "active,untested") {
        const filtered = channels.map((ch) => ({
          ...ch,
          sources: (ch.sources || []).filter((src) => !src.isolated && (src.status === "active" || src.status === "unknown" || src.status === "checking"))
        })).filter((ch) => ch.sources.length > 0);
        return res.json(filtered);
      }
      return res.json(channels);
    }

    let targetProvince = province ? String(province) : "";
    let targetIsp = isp ? String(isp) : "";

    if (!province && !isp) {
      let resolvedClientIp = "";
      if (typeof ip === "string" && ip) {
        resolvedClientIp = ip;
      } else if (typeof clientIp === "string" && clientIp) {
        resolvedClientIp = clientIp;
      } else if (typeof req.headers["x-forwarded-for"] === "string") {
        resolvedClientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
      } else if (Array.isArray(req.headers["x-forwarded-for"])) {
        resolvedClientIp = req.headers["x-forwarded-for"][0].trim();
      } else if (typeof req.headers["x-real-ip"] === "string") {
        resolvedClientIp = req.headers["x-real-ip"].trim();
      } else {
        resolvedClientIp = req.socket.remoteAddress || "";
      }

      if (resolvedClientIp) {
        try {
          const geo = await getClientIpGeo(resolvedClientIp);
          targetProvince = geo.province;
          targetIsp = geo.isp;
          console.log(`[CHANNELS AUTO-IP] Client IP ${resolvedClientIp} matched Province: ${targetProvince}, ISP: ${targetIsp}`);
        } catch (e) {
          console.error("[CHANNELS AUTO-IP ERROR]", e);
        }
      }
    }

    const results = channels.map((ch) => {
      let list = ch.sources || [];

      if (status === "active" || only_active === "true") {
        list = list.filter((src) => src.status === "active");
      } else if (status === "test" || status === "testable" || status === "active,unknown" || status === "active,untested") {
        list = list.filter((src) => src.status === "active" || src.status === "unknown" || src.status === "checking");
      }

      list = getPlayableSources(list, targetIsp, targetProvince);

      return {
        ...ch,
        sources: list
      };
    }).filter((ch) => ch.sources.length > 0);

    res.json(results);
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

  
  app.post("/api/channels/reorder", (req, res) => {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds)) {
      return res.status(400).json({ error: "请提供合法的频道 ID 列表" });
    }
    
    const newChannels: typeof channels = [];
    channelIds.forEach(id => {
      const c = channels.find(c => c.id === id);
      if (c) newChannels.push(c);
    });
    
    // Add any missing channels to the end
    channels.forEach(c => {
      if (!newChannels.some(nc => nc.id === c.id)) {
        newChannels.push(c);
      }
    });
    
    channels = newChannels;
    saveData();
    res.json({ success: true });
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

  // Merge multiple channels
  app.post("/api/channels/merge", (req, res) => {
    const { channelIds, primaryId } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length < 2) {
      return res.status(400).json({ error: "请提供至少两个要合并的频道 ID" });
    }

    const targetChannels = channels.filter(c => channelIds.includes(c.id));
    if (targetChannels.length < 2) {
      return res.status(400).json({ error: "未找到足够的待合并频道项目" });
    }

    // Score channels to pick the most complete/valid as primary
    const getScore = (ch: typeof targetChannels[0]) => {
      let score = 0;
      if (ch.name && ch.name.trim().length > 0) score += 2;
      if (ch.logo && (ch.logo.startsWith("http") || ch.logo.startsWith("/") || ch.logo.length > 5)) score += 5;
      if (ch.epgId && ch.epgId.trim().length > 0 && !/^\d+$/.test(ch.epgId)) score += 3;
      if (ch.groupIds && ch.groupIds.length > 0) score += ch.groupIds.length;
      if (ch.sources && ch.sources.length > 0) score += ch.sources.length * 2;
      if (ch.alias && ch.alias.length > 0) score += ch.alias.length;

      // Heavy priority score boost for names that match the system's standard preset channel list (DEFAULT_CHANNELS and templates)
      const hasPresetName = DEFAULT_CHANNELS.some(
        dc => dc.name.trim().toLowerCase() === ch.name.trim().toLowerCase() || dc.id === ch.id
      );
      if (hasPresetName) {
        score += 10000;
      } else {
        const isTemplateName = loadedDefaultAliases.some(
          group => group.template.trim().toLowerCase() === ch.name.trim().toLowerCase()
        );
        if (isTemplateName) {
          score += 5000;
        } else {
          const aliasTemplate = findAliasTemplate(ch.name);
          if (aliasTemplate && aliasTemplate.templateName.trim().toLowerCase() === ch.name.trim().toLowerCase()) {
            score += 1000;
          }
        }
      }
      return score;
    };

    const sortedByCompleteness = [...targetChannels].sort((a, b) => getScore(b) - getScore(a));
    
    // Pick primary channel: either specified by user, or fallback to auto (best completeness score)
    let primaryChannel = sortedByCompleteness[0];
    if (primaryId) {
      const explicitPrimary = targetChannels.find(c => c.id === primaryId);
      if (explicitPrimary) {
        primaryChannel = explicitPrimary;
      }
    }

    // If one of the target channels being merged can be matched to a canonical channel list template name,
    // we use that standard name as the main channel name
    let resolvedStandardName = "";
    for (const ch of targetChannels) {
      const match = DEFAULT_CHANNELS.find(
        dc => dc.name.trim().toLowerCase() === ch.name.trim().toLowerCase() || dc.id === ch.id
      );
      if (match) {
        resolvedStandardName = match.name;
        break;
      }
    }

    if (!resolvedStandardName) {
      for (const ch of targetChannels) {
        const match = loadedDefaultAliases.find(
          group => group.template.trim().toLowerCase() === ch.name.trim().toLowerCase()
        );
        if (match) {
          resolvedStandardName = match.template;
          break;
        }
      }
    }

    if (!resolvedStandardName) {
      for (const ch of targetChannels) {
        const match = findAliasTemplate(ch.name);
        if (match) {
          resolvedStandardName = match.templateName;
          break;
        }
      }
    }

    if (resolvedStandardName) {
      console.log(`[Channel Merge] Prioritized preset/standard channel list name: "${primaryChannel.name}" -> "${resolvedStandardName}"`);
      primaryChannel.name = resolvedStandardName;
    }

    const allNames = new Set<string>();
    const allAliases = new Set<string>();
    const allGroupIds = new Set<string>();
    const logoCandidates: string[] = [];
    const epgIdCandidates: string[] = [];

    targetChannels.forEach(c => {
      if (c.name) allNames.add(c.name.trim());
      // 添加其他频道的名称作为别名
      if (c.id !== primaryChannel.id && c.name) {
        allAliases.add(c.name.trim());
      }
      if (c.alias && Array.isArray(c.alias)) {
        c.alias.forEach(a => {
          if (a) allAliases.add(a.trim());
        });
      }
      if (c.groupIds && Array.isArray(c.groupIds)) {
        c.groupIds.forEach(g => allGroupIds.add(g));
      }
      if (c.logo && c.logo.trim()) {
        logoCandidates.push(c.logo.trim());
      }
      if (c.epgId && c.epgId.trim()) {
        epgIdCandidates.push(c.epgId.trim());
      }
    });

    let bestLogo = primaryChannel.logo || "";
    const isSystemGenerated = (logo: string) => !logo || logo.includes("unsplash.com");
    
    // 只有主频道logo为空或系统生成的，才选取其他频道的logo
    if (isSystemGenerated(bestLogo)) {
      const alternativeLogo = logoCandidates.find(l => !isSystemGenerated(l));
      if (alternativeLogo) {
        bestLogo = alternativeLogo;
      }
    }

    let bestEpgId = primaryChannel.epgId || "";
    const validEpgId = epgIdCandidates.find(e => e && !/^\d+$/.test(e) && e.toLowerCase() !== "null" && e.toLowerCase() !== "undefined");
    if (validEpgId) {
      bestEpgId = validEpgId;
    } else if (epgIdCandidates.length > 0) {
      bestEpgId = epgIdCandidates[0];
    }

    const mergedSources: typeof primaryChannel.sources = [];
    const addedUrls = new Set<string>();

    const allSources = [
      ...(primaryChannel.sources || []),
      ...targetChannels.filter(c => c.id !== primaryChannel.id).flatMap(c => c.sources || [])
    ];

    allSources.forEach(s => {
      if (!s || !s.url) return;
      const cleanUrl = s.url.trim();
      if (!addedUrls.has(cleanUrl)) {
        addedUrls.add(cleanUrl);
        mergedSources.push({
          ...s,
          url: cleanUrl
        });
      } else {
        const existingIdx = mergedSources.findIndex(x => x.url === cleanUrl);
        if (existingIdx !== -1) {
          const existing = mergedSources[existingIdx];
          if (existing.status !== "active" && s.status === "active") {
            mergedSources[existingIdx] = s;
          } else if (existing.status === s.status && s.latency && (!existing.latency || s.latency < existing.latency)) {
            mergedSources[existingIdx] = s;
          }
        }
      }
    });

    const primaryName = primaryChannel.name;
    allNames.forEach(n => {
      if (n !== primaryName) {
        allAliases.add(n);
      }
    });

    primaryChannel.logo = bestLogo;
    primaryChannel.epgId = bestEpgId;
    primaryChannel.groupIds = Array.from(allGroupIds);
    primaryChannel.alias = Array.from(allAliases).filter(a => a !== primaryName);
    primaryChannel.sources = mergedSources;

    const otherIdsToMerge = channelIds.filter(id => id !== primaryChannel.id);
    channels = channels.filter(c => !otherIdsToMerge.includes(c.id));

    saveData();

    res.json({
      success: true,
      message: `成功合并 ${targetChannels.length} 个频道。保留了最完备的主频道 [${primaryChannel.name}]，合并后包含别名: ${primaryChannel.alias.join(", ") || "无"}，已整合并去重 ${primaryChannel.sources.length} 条播放线路。`,
      primaryChannel
    });
  });

  // Batch update channel groups
  app.post("/api/channels/batch-groups", (req, res) => {
    const { channelIds, groupIds, mode } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供目标频道 ID 列表" });
    }
    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: "请提供合法的分组 ID 列表" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      if (channelIds.includes(c.id)) {
        if (!Array.isArray(c.groupIds)) {
          c.groupIds = [];
        }
        if (mode === "append") {
          // Append selected groupIds to existing groupIds, preserving other categories
          const merged = new Set([...c.groupIds, ...groupIds]);
          c.groupIds = Array.from(merged);
        } else {
          // Replace mode (default): overwrite existing categories with selected ones
          c.groupIds = groupIds;
        }
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
            name = stripBitrateAndResolution(name);

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
              if (stdInfo) {
                stdInfo.aliases.forEach(a => {
                  if (!channel!.alias.includes(a)) {
                    channel!.alias.push(a);
                  }
                });
              }
              // Update logo if current logo is auto-generated
              if (currentInfo.logo && (!channel!.logo || channel!.logo.includes("unsplash.com") || channel!.logo === "")) {
                channel!.logo = currentInfo.logo;
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
            let name = nameWithSpecs.split("#")[0].trim();
            name = stripBitrateAndResolution(name);

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
              if (stdInfo) {
                // FORCE UPDATE channel name to the official alias template name
                channel.name = stdInfo.templateName;
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

  // Export sync configurations as a downloadable JSON file
  app.get("/api/sync-configs/export", (req, res) => {
    try {
      res.setHeader("Content-Disposition", "attachment; filename=\"iptv_sync_subscriptions.json\"");
      res.setHeader("Content-Type", "application/json");
      res.json(syncConfigs);
    } catch (err: any) {
      res.status(500).json({ error: `导出订阅失败: ${err.message || err}` });
    }
  });

  // Import sync configurations from JSON list
  app.post("/api/sync-configs/import", (req, res) => {
    try {
      const { configs, overwrite } = req.body;
      if (!Array.isArray(configs)) {
        return res.status(400).json({ error: "导入的备份格式不合法：期望一个 JSON 数组" });
      }

      const importedConfigs: SyncConfig[] = [];
      for (const item of configs) {
        if (!item.name || !item.url) {
          continue; // Skip invalid entries
        }
        importedConfigs.push({
          id: item.id && !overwrite ? item.id : "sc_" + Math.random().toString(36).substring(2, 10),
          name: String(item.name).trim(),
          url: String(item.url).trim(),
          type: item.type === "txt" ? "txt" : "m3u",
          autoSync: item.autoSync !== undefined ? !!item.autoSync : true,
          syncInterval: Number(item.syncInterval) || 12,
          status: item.status || "never",
          message: item.message || "",
          lastSynced: item.lastSynced,
          disabled: !!item.disabled,
          consecutiveFailures: Number(item.consecutiveFailures) || 0,
          contentHash: item.contentHash,
          isp: item.isp ? String(item.isp).trim() : undefined,
        });
      }

      if (overwrite) {
        syncConfigs = importedConfigs;
      } else {
        // Merge - avoid duplicate URLs
        for (const imported of importedConfigs) {
          const existingIdx = syncConfigs.findIndex(c => c.url === imported.url);
          if (existingIdx >= 0) {
            // Update existing
            syncConfigs[existingIdx] = {
              ...syncConfigs[existingIdx],
              name: imported.name,
              type: imported.type,
              autoSync: imported.autoSync,
              syncInterval: imported.syncInterval,
              isp: imported.isp,
            };
          } else {
            syncConfigs.push(imported);
          }
        }
      }

      saveData();
      res.json({
        success: true,
        message: `成功导入 ${importedConfigs.length} 项同步订阅配置`,
        syncConfigs
      });
    } catch (err: any) {
      res.status(500).json({ error: `导入订阅失败: ${err.message || err}` });
    }
  });

  app.post("/api/sync-configs", (req, res) => {
    const { name, url, type, autoSync, syncInterval, isp } = req.body;
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
      isp: isp ? String(isp).trim() : undefined,
    };

    syncConfigs.push(newConfig);
    saveData();
    res.status(201).json(newConfig);
  });

  app.put("/api/sync-configs/:id", (req, res) => {
    const { id } = req.params;
    const { name, url, type, autoSync, syncInterval, isp, disabled } = req.body;

    const config = syncConfigs.find((c) => c.id === id);
    if (!config) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    if (name) config.name = name;
    if (url && url !== config.url) {
      config.url = url;
      config.contentHash = undefined;
      config.disabled = false;
      config.consecutiveFailures = 0;
    } else if (url) {
      config.url = url;
    }
    if (type) config.type = type;
    if (isp !== undefined) {
      config.isp = isp ? String(isp).trim() : undefined;
    }
    if (autoSync !== undefined) {
      config.autoSync = autoSync;
      if (autoSync === true) {
        config.disabled = false;
        config.consecutiveFailures = 0;
      }
    }
    if (syncInterval !== undefined) config.syncInterval = Number(syncInterval);
    if (disabled !== undefined) {
      config.disabled = !!disabled;
      if (disabled === false) {
        config.consecutiveFailures = 0;
      }
    }

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

  // Batch Run All Active Sync Configs
  app.post("/api/sync-configs/run-all", async (req, res) => {
    const activeConfigs = syncConfigs.filter((c) => !c.disabled);
    if (activeConfigs.length === 0) {
      return res.json({ success: true, message: "没有发现任何未禁用的订阅源", syncConfigs });
    }

    let successCount = 0;
    let failCount = 0;

    // Execute in parallel
    const promises = activeConfigs.map(async (config) => {
      config.status = "never";
      config.message = "正在进行后台批量同步...";
      config.consecutiveFailures = 0;
      const success = await performSync(config, true);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    });

    await Promise.all(promises);
    saveData();

    res.json({
      success: true,
      message: `批量订阅同步完成：成功 ${successCount} 个，失败 ${failCount} 个`,
      syncConfigs
    });
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
    config.disabled = false;
    config.consecutiveFailures = 0;
    
    // Run sync asynchronously forcing update on manual trigger
    const success = await performSync(config, true);
    if (success) {
      res.json({ success: true, message: "同步完成", config });
    } else {
      res.status(500).json({ error: "同步失败", config });
    }
  });

  // Link validation & latency speed checking triggered by browser
  app.post("/api/sources/test", (req, res) => {
    const { sourceIds, channelIds, concurrency, isp, province, status } = req.body;

    if (testStatus.status === "running") {
      return res.status(400).json({ error: "已有正在运行的批量测速任务" });
    }

    // Capture files to check
    let targetSources: { id: string; channelId: string; url: string }[] = [];

    channels.forEach((channel) => {
      if (channelIds && !channelIds.includes(channel.id)) return;
      channel.sources.forEach((source) => {
        // Apply filter constraints if specified
        if (sourceIds && !sourceIds.includes(source.id)) return;
        if (isp && isp !== "all" && source.isp !== isp) return;
        if (province && province !== "all" && source.province !== province) return;
        if (status && status !== "all" && source.status !== status) return;

        targetSources.push({
          id: source.id,
          channelId: channel.id,
          url: source.url,
        });
      });
    });

    if (targetSources.length === 0) {
      return res.status(400).json({ error: "未选择或未检索到符合过滤条件的直播源进行测试" });
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

  // Option 2: Endpoint for client-side/browser speed test report submission
  app.post("/api/sources/client-test-results", (req, res) => {
    const { results, clientIsp, clientProvince } = req.body;
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: "请提供有效的客户端代测结果报告数据" });
    }

    let updatedCount = 0;
    results.forEach((r: any) => {
      const { sourceId, channelId, status, latency } = r;
      if (!sourceId || !status) return;

      channels.forEach((c) => {
        if (channelId && c.id !== channelId) return;
        const src = c.sources.find((s) => s.id === sourceId);
        if (src) {
          src.status = status;
          if (latency !== undefined) {
            src.latency = latency;
          }
          src.lastChecked = new Date().toISOString();
          // Annotate that it's validated by local client ISP
          src.clientIspReported = clientIsp || "宿主";
          src.clientProvinceReported = clientProvince || "本地";
          updatedCount++;
        }
      });
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  app.get("/api/sources/test-status", (req, res) => {
    res.json(testStatus);
  });

  // Detect client IP information (ISP and Province)
  app.get("/api/sources/detect-ip", async (req, res) => {
    try {
      let clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
      if (Array.isArray(clientIp)) {
        clientIp = clientIp[0];
      }
      if (typeof clientIp === "string" && clientIp.includes(",")) {
        clientIp = clientIp.split(",")[0].trim();
      }
      
      if (clientIp === "::1" || clientIp === "::ffff:127.0.0.1") {
        clientIp = "127.0.0.1";
      }

      let detectedIp = clientIp as string;
      let province = "北京";
      let isp = "电信";

      const queryIp = detectedIp === "127.0.0.1" ? "" : detectedIp;
      const url = `http://ip-api.com/json/${queryIp}?lang=zh-CN`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json() as any;
        if (data && data.status === "success") {
          detectedIp = data.query || detectedIp;
          if (data.regionName) {
            province = data.regionName.replace(/(省|市|特别行政区|自治区|壮族自治区|回族自治区|维吾尔自治区|盟)/g, "");
          }
          const rawIsp = (data.isp || data.org || "").toLowerCase();
          if (rawIsp.includes("telecom") || rawIsp.includes("chinanet") || rawIsp.includes("电信")) {
            isp = "电信";
          } else if (rawIsp.includes("unicom") || rawIsp.includes("联通")) {
            isp = "联通";
          } else if (rawIsp.includes("mobile") || rawIsp.includes("cmcc") || rawIsp.includes("移动")) {
            isp = "移动";
          } else if (rawIsp.includes("broadband") || rawIsp.includes("cable") || rawIsp.includes("广电") || rawIsp.includes("wasu")) {
            isp = "广电";
          } else {
            // Check for names like 'china mobile' directly
            if (rawIsp.includes("china mobile")) isp = "移动";
            else if (rawIsp.includes("china unicom")) isp = "联通";
            else if (rawIsp.includes("china telecom")) isp = "电信";
            else isp = "其它";
          }
        }
      }
      
      res.json({ ip: detectedIp, province, isp });
    } catch (err: any) {
      console.error("[IP Detect ERROR]:", err.message);
      res.json({ ip: "127.0.0.1", province: "北京", isp: "电信" });
    }
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

  // EPG Mapping Status
  app.get("/api/epg/mapping-status", (req, res) => {
    const activeEpgSrcs = epgSources.filter(s => s.active);
    const combinedCache: Record<string, { displayNames: string[], programs: any[], sourceId: string, sourceName: string }> = {};
    
    // Merge caches
    for (const src of activeEpgSrcs) {
      const cache = getEpgCache(src.id);
      if (cache) {
        for (const [key, value] of Object.entries(cache)) {
          if (!combinedCache[key]) {
            combinedCache[key] = { ...value, sourceId: src.id, sourceName: src.name };
          }
        }
      }
    }

    const epgTotalChannels = Object.keys(combinedCache).length;

    const mappedChannels = [];
    const unmappedChannels = [];

    for (const ch of channels) {
      // Find matching entry
      let matchedEntry = null;
      let matchedOriginalId = null;

      // Duplicate find logic inline or reuse
      if (ch.epgId) {
        if (combinedCache[ch.epgId]) {
           matchedEntry = combinedCache[ch.epgId];
           matchedOriginalId = ch.epgId;
        } else {
           const foundKey = Object.keys(combinedCache).find(k => k.toLowerCase() === ch.epgId.toLowerCase());
           if (foundKey) {
             matchedEntry = combinedCache[foundKey];
             matchedOriginalId = foundKey;
           }
        }
      }

      if (!matchedEntry) {
        const chNameNorm = normalizeChannelName(ch.name);
        const aliasNorms = (ch.alias || []).map(a => normalizeChannelName(a)).filter(Boolean);
        for (const originalId of Object.keys(combinedCache)) {
          const entry = combinedCache[originalId];
          const originalIdNorm = normalizeChannelName(originalId);
          if (ch.epgId && originalIdNorm === normalizeChannelName(ch.epgId)) {
            matchedEntry = entry;
            matchedOriginalId = originalId;
            break;
          }
          if (originalIdNorm === chNameNorm || aliasNorms.includes(originalIdNorm)) {
            matchedEntry = entry;
            matchedOriginalId = originalId;
            break;
          }
          let foundInDisp = false;
          for (const disp of entry.displayNames) {
            const dispNorm = normalizeChannelName(disp);
            if (dispNorm === chNameNorm || aliasNorms.includes(dispNorm)) {
              matchedEntry = entry;
              matchedOriginalId = originalId;
              foundInDisp = true;
              break;
            }
          }
          if (foundInDisp) break;
        }
      }

      if (matchedEntry) {
        mappedChannels.push({
          id: ch.id,
          name: ch.name,
          epgId: ch.epgId,
          matchedId: matchedOriginalId,
          matchedName: matchedEntry.displayNames[0] || matchedOriginalId,
          sourceName: matchedEntry.sourceName
        });
      } else {
        unmappedChannels.push({
          id: ch.id,
          name: ch.name,
          epgId: ch.epgId
        });
      }
    }

    res.json({
      epgTotalChannels,
      mappedChannels,
      unmappedChannels
    });
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

    const getEpgForChannelAndDate = (ch: Channel) => {
      const activeEpgSrcs = epgSources.filter(s => s.active);
      for (const src of activeEpgSrcs) {
        const cache = getEpgCache(src.id);
        if (cache) {
          const entry = findMatchingEpgEntry(ch, cache);
          if (entry && entry.programs && entry.programs.length > 0) {
            const filtered = entry.programs.filter((p: any) => {
              const parsed = parseXmltvTime(p.start);
              return parsed.dateStr === targetDate;
            }).map((p: any) => {
              const parsed = parseXmltvTime(p.start);
              return {
                time: parsed.timeStr,
                title: p.title
              };
            });
            if (filtered.length > 0) {
              filtered.sort((a: any, b: any) => a.time.localeCompare(b.time));
              return filtered;
            }
          }
        }
      }
      return getSchedulesForChannel(ch.id, ch.name);
    };

    if (channelId) {
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        let isSimulated = true;
        const activeEpgSrcs = epgSources.filter(s => s.active);
        for (const src of activeEpgSrcs) {
          const cache = getEpgCache(src.id);
          if (cache) {
            const entry = findMatchingEpgEntry(channel, cache);
            if (entry && entry.programs && entry.programs.length > 0) {
              isSimulated = false;
              break;
            }
          }
        }

        return res.json({
          channelId,
          channelName: channel.name,
          date: targetDate,
          epgId: channel.epgId,
          isSimulated,
          programs: getEpgForChannelAndDate(channel),
        });
      }
    }

    // Yield mappings for all matched channels
    const guideMap = channels.map((c) => ({
      channelId: c.id,
      channelName: c.name,
      epgId: c.epgId,
      programs: getEpgForChannelAndDate(c),
    }));

    res.json({ date: targetDate, guides: guideMap });
  });

  // AI Smart Auto-Correction Recommendation Endpoint
  app.post("/api/epg/ai-recommend", async (req, res) => {
    try {
      const { channelId, channelName } = req.body;
      let targetName = "";
      if (channelId) {
        const found = channels.find(c => c.id === channelId);
        if (found) {
          targetName = found.name;
        }
      }
      if (!targetName && channelName) {
        targetName = String(channelName).trim();
      }

      if (!targetName) {
        return res.status(400).json({ error: "缺少频道名称或频道ID" });
      }

      // 1. Gather all candidates from active EPG sources
      const candidates: { epgId: string; displayNames: string[]; sourceName: string }[] = [];
      const seenIds = new Set<string>();

      const activeEpgSrcs = epgSources.filter(s => s.active);
      for (const src of activeEpgSrcs) {
        const cache = getEpgCache(src.id);
        if (cache) {
          for (const [epgId, entry] of Object.entries(cache)) {
            const key = `${src.id}::${epgId}`;
            if (!seenIds.has(key)) {
              seenIds.add(key);
              candidates.push({
                epgId,
                displayNames: entry.displayNames || [],
                sourceName: src.name
              });
            }
          }
        }
      }

      // 2. Score and sort candidates to get the top 100
      const scoreCand = (name: string, cand: { epgId: string; displayNames: string[] }) => {
        const normTarget = name.toLowerCase().replace(/[\s\-hd高超清蓝光]/g, "");
        let maxScore = 0;

        const checkText = (text: string) => {
          const normText = text.toLowerCase().replace(/[\s\-hd高超清蓝光]/g, "");
          if (!normText || !normTarget) return 0;
          if (normText === normTarget) return 100;
          if (normTarget.includes(normText) || normText.includes(normTarget)) {
            return 50 + Math.min(normText.length, normTarget.length) * 5;
          }
          const s1 = new Set(normTarget.split(""));
          const s2 = new Set(normText.split(""));
          let intersection = 0;
          for (const char of s1) {
            if (s2.has(char)) intersection++;
          }
          if (intersection > 0) {
            return (intersection / Math.max(s1.size, s2.size)) * 40;
          }
          return 0;
        };

        maxScore = Math.max(maxScore, checkText(cand.epgId));
        if (cand.displayNames) {
          for (const display of cand.displayNames) {
            maxScore = Math.max(maxScore, checkText(display));
          }
        }
        return maxScore;
      };

      const scoredList = candidates
        .map(c => ({ candidate: c, score: scoreCand(targetName, c) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 100)
        .map(x => x.candidate);

      // 3. Get Gemini Client and generate content
      const ai = getGeminiClient();

      const prompt = `你是一个智能IPTV电视频道匹配专家。
我们正在为用户导入的频道：【${targetName}】匹配最合适的 EPG (电子节目单) ID。

下面是从当前已被激活的 EPG 节目源里筛选出的匹配候选列表（包含 epgId、displayNames、及来源Epg源名）：
${JSON.stringify(scoredList.map(c => ({ epgId: c.epgId, names: c.displayNames, src: c.sourceName })), null, 2)}

请根据：
1. 名字同义性（例如 CCTV-5 对应 CCTV5 或者 体育台，广东体育 对应 粤语体育）
2. 缩写和官方标准（例如 CCTV1 代表 Central China Television Channel 1，或者 湖南卫视 对应 Hunan-TV）
3. 剔除噪声（如 HD, 高清, 超清 等分辨率标识不影响频道属性）

请在候选项目中，选出最完美最精准的前 3 个推荐推荐。
如果候选列表没有完美匹配，请在 EPG 的标准命名规范下（如“cctv1”, “hunantv”等）推荐一个最合理的 EPG ID。并且说明这是非候选项目的常识性推荐。

请精确按照以下 JSON Schema 返回数据：
[
  {
    "epgId": "推荐匹配的 epgId",
    "displayName": "该 epgId 的代表名称 (例如 湖南卫视)",
    "reason": "推荐理由简短中文",
    "confidence": 0.95 // 匹配置信度，范围 0.0 到 1.0
  }
]`;

      const geminiRes = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                epgId: { type: Type.STRING },
                displayName: { type: Type.STRING },
                reason: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              },
              required: ["epgId", "displayName", "reason", "confidence"]
            }
          }
        }
      });

      const responseText = geminiRes.text;
      if (!responseText) {
        throw new Error("模型未返回任何结果");
      }

      const results = JSON.parse(responseText.trim());
      res.json({ success: true, channelName: targetName, recommendations: results });
    } catch (err: any) {
      console.error("[EPG AI RECOMMEND ERROR]", err.message || err);
      res.status(500).json({ error: err.message || "智能匹配推荐失败，请检查 API Key 配置" });
    }
  });

  // CUSTOM EXPORTS/PLAYBACK API INTERFACE
  // Third-party players consume this!
  // Example usage: http://localhost:3000/api/export/m3u?isp=电信&status=active
  // Example usage: http://localhost:3000/api/export/txt?province=北京
  app.get("/api/export/m3u", async (req, res) => {
    const { category, isp, province, status, limit, ip, clientIp } = req.query;

    let targetProvince = province ? String(province) : "";
    let targetIsp = isp ? String(isp) : "";

    // If province/isp not explicitly provided, detect from IP
    let resolvedClientIp = "";
    if (!province && !isp) {
      if (typeof ip === "string" && ip) {
        resolvedClientIp = ip;
      } else if (typeof clientIp === "string" && clientIp) {
        resolvedClientIp = clientIp;
      } else if (typeof req.headers["x-forwarded-for"] === "string") {
        resolvedClientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
      } else if (Array.isArray(req.headers["x-forwarded-for"])) {
        resolvedClientIp = req.headers["x-forwarded-for"][0].trim();
      } else if (typeof req.headers["x-real-ip"] === "string") {
        resolvedClientIp = req.headers["x-real-ip"].trim();
      } else {
        resolvedClientIp = req.socket.remoteAddress || "";
      }

      if (resolvedClientIp) {
        const geo = await getClientIpGeo(resolvedClientIp);
        targetProvince = geo.province;
        targetIsp = geo.isp;
        console.log(`[EXPORT M3U AUTO-IP] Client IP ${resolvedClientIp} matched Province: ${targetProvince}, ISP: ${targetIsp}`);
      }
    }

    const host = req.headers.host || "localhost:3000";
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;
    let playlistRows = [`#EXTM3U x-tvg-url="${baseUrl}/api/export/epg.xml.gz"`];

    let count = 0;
    const maxLimit = limit ? Number(limit) : Infinity;

    const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
    orderedGroups.forEach((group) => {
      channels.forEach((channel) => {
        const isInGroup = channel.groupIds.includes(group.id);
        const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
        if (!isInGroup && !isFallback) return;
        const gId = group.id;
        const groupName = group.name;

        // Filter group level if specific category selected
        if (category && groupName !== String(category) && gId !== String(category)) return;

        let processedSources = channel.sources;
        const finalIsp = isp ? String(isp) : targetIsp;
        const finalProvince = province ? String(province) : targetProvince;

        processedSources = getPlayableSources(processedSources, finalIsp, finalProvince);

        if (province) {
          processedSources = processedSources.filter(source => source.province === String(province));
        }

        processedSources.forEach((source) => {
          if (count >= maxLimit) return;
          if (status && source.status !== String(status)) return;

          // Extra details label
          // (User requested to remove suffix with ISP/Province from M3U export)
          const channelDisplayName = channel.name;

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
  app.get("/api/export/txt", async (req, res) => {
    const { category, isp, province, status, limit, ip, clientIp } = req.query;

    let targetProvince = province ? String(province) : "";
    let targetIsp = isp ? String(isp) : "";

    // If province/isp not explicitly provided, detect from IP
    let resolvedClientIp = "";
    if (!province && !isp) {
      if (typeof ip === "string" && ip) {
        resolvedClientIp = ip;
      } else if (typeof clientIp === "string" && clientIp) {
        resolvedClientIp = clientIp;
      } else if (typeof req.headers["x-forwarded-for"] === "string") {
        resolvedClientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
      } else if (Array.isArray(req.headers["x-forwarded-for"])) {
        resolvedClientIp = req.headers["x-forwarded-for"][0].trim();
      } else if (typeof req.headers["x-real-ip"] === "string") {
        resolvedClientIp = req.headers["x-real-ip"].trim();
      } else {
        resolvedClientIp = req.socket.remoteAddress || "";
      }

      if (resolvedClientIp) {
        const geo = await getClientIpGeo(resolvedClientIp);
        targetProvince = geo.province;
        targetIsp = geo.isp;
        console.log(`[EXPORT TXT AUTO-IP] Client IP ${resolvedClientIp} matched Province: ${targetProvince}, ISP: ${targetIsp}`);
      }
    }

    const exportMap = new Map<string, string[]>();

    let count = 0;
    const maxLimit = limit ? Number(limit) : Infinity;

    const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
    orderedGroups.forEach((group) => {
      channels.forEach((channel) => {
        const isInGroup = channel.groupIds.includes(group.id);
        const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
        if (!isInGroup && !isFallback) return;
        const gId = group.id;
        const groupName = group.name;

        if (category && groupName !== String(category) && gId !== String(category)) return;

        let processedSources = channel.sources;
        const finalIsp = isp ? String(isp) : targetIsp;
        const finalProvince = province ? String(province) : targetProvince;

        processedSources = getPlayableSources(processedSources, finalIsp, finalProvince);

        if (province) {
          processedSources = processedSources.filter(source => source.province === String(province));
        }

        processedSources.forEach((source) => {
          if (count >= maxLimit) return;
          if (status && source.status !== String(status)) return;

          const catName = groupName;
          if (!exportMap.has(catName)) {
            exportMap.set(catName, []);
          }

          const channelDisplayStr = `${channel.name},${source.url}`;
          
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
      const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
      return `  <channel id="${epgIdEscaped}">
    <display-name lang="zh">${escapeXml(c.name)}</display-name>
    <icon src="${escapeXml(c.logo)}" />
  </channel>`;
    }).join("\n");

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

    const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const activeEpgSources = epgSources.filter(s => s.active);

    const programTags = channels.map((c) => {
      const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
      
      let matchedPrograms: any[] = [];
      let found = false;

      for (const source of activeEpgSources) {
        const cache = getEpgCache(source.id);
        if (cache) {
          const entry = findMatchingEpgEntry(c, cache);
          if (entry && entry.programs && entry.programs.length > 0) {
            matchedPrograms = entry.programs;
            found = true;
            break;
          }
        }
      }

      if (found && matchedPrograms.length > 0) {
        return matchedPrograms.map((prog: any) => {
          return `  <programme start="${escapeXml(prog.start)}" stop="${escapeXml(prog.stop)}" channel="${epgIdEscaped}">
    <title lang="zh">${escapeXml(prog.title)}</title>
    ${prog.desc ? `<desc lang="zh">${escapeXml(prog.desc)}</desc>` : ""}
  </programme>`;
        }).join("\n");
      } else {
        return programTemplates.map((p) => {
          return `  <programme start="${todayStr}${p.start} +0800" stop="${todayStr}${p.stop} +0800" channel="${epgIdEscaped}">
    <title lang="zh">${escapeXml(p.title)}</title>
    <desc lang="zh">由 IPTV 电视服务自动同步 matching epg channel id [${epgIdEscaped}]。</desc>
  </programme>`;
        }).join("\n");
      }
    }).join("\n");

    const xmlFooter = `</tv>`;
    
    res.setHeader("Content-Type", "application/xml");
    res.send(`${xmlHeader}\n${channelTags}\n${programTags}\n${xmlFooter}`);
  });

  // Compressed XML.GZ EPG feed
  app.get("/api/export/epg.xml.gz", (req, res) => {
    const xmlHeader = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="IPTV Channel Manager" generator-info-url="http://localhost:3000/">`;

    const channelTags = channels.map((c) => {
      const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
      return `  <channel id="${epgIdEscaped}">
    <display-name lang="zh">${escapeXml(c.name)}</display-name>
    <icon src="${escapeXml(c.logo)}" />
  </channel>`;
    }).join("\n");

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

    const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const activeEpgSources = epgSources.filter(s => s.active);

    const programTags = channels.map((c) => {
      const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
      
      let matchedPrograms: any[] = [];
      let found = false;

      for (const source of activeEpgSources) {
        const cache = getEpgCache(source.id);
        if (cache) {
          const entry = findMatchingEpgEntry(c, cache);
          if (entry && entry.programs && entry.programs.length > 0) {
            matchedPrograms = entry.programs;
            found = true;
            break;
          }
        }
      }

      if (found && matchedPrograms.length > 0) {
        return matchedPrograms.map((prog: any) => {
          return `  <programme start="${escapeXml(prog.start)}" stop="${escapeXml(prog.stop)}" channel="${epgIdEscaped}">
    <title lang="zh">${escapeXml(prog.title)}</title>
    ${prog.desc ? `<desc lang="zh">${escapeXml(prog.desc)}</desc>` : ""}
  </programme>`;
        }).join("\n");
      } else {
        return programTemplates.map((p) => {
          return `  <programme start="${todayStr}${p.start} +0800" stop="${todayStr}${p.stop} +0800" channel="${epgIdEscaped}">
    <title lang="zh">${escapeXml(p.title)}</title>
    <desc lang="zh">由 IPTV 电视服务自动同步 matching epg channel id [${epgIdEscaped}]。</desc>
  </programme>`;
        }).join("\n");
      }
    }).join("\n");

    const xmlFooter = `</tv>`;
    const fullXml = `${xmlHeader}\n${channelTags}\n${programTags}\n${xmlFooter}`;

    try {
      const compressed = zlib.gzipSync(Buffer.from(fullXml, "utf-8"));
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", "attachment; filename=\"epg.xml.gz\"");
      res.end(compressed);
    } catch (err: any) {
      console.error("[EPG GZIP COMPRESSION ERROR]", err);
      res.status(500).send("Internal Server Error during compression");
    }
  });

  // Clean-up and optimization APIs
  app.post("/api/cleanup/duplicates", (req, res) => {
    let affectedCount = 0;
    channels.forEach((channel) => {
      const urlMap = new Set<string>();
      const uniqueSources: any[] = [];
      channel.sources.forEach((s) => {
        if (!urlMap.has(s.url)) {
          urlMap.add(s.url);
          uniqueSources.push(s);
        } else {
          affectedCount++;
        }
      });
      channel.sources = uniqueSources;
    });
    saveData();
    res.json({ success: true, message: `成功清理并物理移除了 ${affectedCount} 个完全重复的直播线路` });
  });

  app.post("/api/cleanup/inactive", (req, res) => {
    let affectedCount = 0;
    channels.forEach((channel) => {
      channel.sources.forEach((s) => {
        if (s.status === "inactive" && !s.isolated) {
          s.isolated = true;
          affectedCount++;
        }
      });
    });

    saveData();
    res.json({ success: true, message: `成功隔离 (软删除) ${affectedCount} 个失效链接直播源` });
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
      try {
        const priorBackupJson = {
          groups,
          channels,
          syncConfigs,
          epgSources,
          adminPassword,
          githubProxy,
        };
        fs.writeFileSync(path.join(DATA_DIR, autoBackupName), JSON.stringify(priorBackupJson, null, 2), "utf-8");
      } catch (backupErr) {
        console.error("[Restore Backup] Failed to write safety prior backup:", backupErr);
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
