import fs from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import {
  Channel,
  Group,
  SyncConfig,
  EpgSource,
  LiveSource,
  IpGeoApi,
  ExportPlaylistCacheItem
} from "./types";
import {
  DATA_DIR,
  DATA_FILE,
  PLAYLIST_CACHE_DIR,
  READABLE_PLAYLIST_DIR,
  EPG_EXPORT_XML_PATH,
  EPG_EXPORT_GZ_PATH,
  DEFAULT_GROUPS,
  DEFAULT_CHANNELS,
  DEFAULT_SYNC_CONFIGS,
  DEFAULT_CAROUSEL_PRESETS,
  DEFAULT_IP_GEO_APIS
} from "./constants";

export { DATA_DIR, DATA_FILE, PLAYLIST_CACHE_DIR, READABLE_PLAYLIST_DIR };
import { getDb } from "./db/sqlite";
import { normalizeChannelName, generateDefaultEpgId } from "./utils/text";
import { isPrivateOrIntranetUrl } from "./utils/network";
import { resolveChannelLogo } from "./aiService";

// In-Memory Database State
export let groups: Group[] = [];
export let channels: Channel[] = [];
export let syncConfigs: SyncConfig[] = [];
export let epgSources: EpgSource[] = [];
export let adminPassword = process.env.ADMIN_PASSWORD || "";
export let githubProxy = "";
export let autoCreateChannel = true;
export let m3uLogoVersion = "";
export let carouselProxyPresets = DEFAULT_CAROUSEL_PRESETS;
export let ipGeoApis: IpGeoApi[] = DEFAULT_IP_GEO_APIS;
export let autoSwitchGeoApi = true;

export function setAdminPassword(val: string) { adminPassword = val; }
export function setGithubProxy(val: string) { githubProxy = val; }
export function setAutoCreateChannel(val: boolean) { autoCreateChannel = val; }
export function setM3uLogoVersion(val: string) { m3uLogoVersion = val; }
export function setCarouselProxyPresets(val: any) { carouselProxyPresets = val; }
export function setIpGeoApis(val: IpGeoApi[]) { ipGeoApis = val; }
export function setAutoSwitchGeoApi(val: boolean) { autoSwitchGeoApi = val; }
export function setGroups(val: Group[]) { groups = val; }
export function setChannels(val: Channel[]) { channels = val; }
export function setSyncConfigs(val: SyncConfig[]) { syncConfigs = val; }
export function setEpgSources(val: EpgSource[]) { epgSources = val; }

export let globalLastDataUpdate = Date.now();
export function getGlobalLastDataUpdate() { return globalLastDataUpdate; }

// In-memory caches for playlists & EPG
export const exportPlaylistMemoryCache = new Map<string, ExportPlaylistCacheItem>();
export let integratedEpgXmlCache: string | null = null;
export let integratedEpgXmlGzCache: Buffer | null = null;
export let integratedEpgCacheTime = 0;
export let integratedEpgEtag = "";

export function setIntegratedEpgCache(xml: string | null, gz: Buffer | null, time: number, etag: string) {
  integratedEpgXmlCache = xml;
  integratedEpgXmlGzCache = gz;
  integratedEpgCacheTime = time;
  integratedEpgEtag = etag;
}

export function invalidateIntegratedEpgCache() {
  integratedEpgXmlCache = null;
  integratedEpgXmlGzCache = null;
  integratedEpgCacheTime = 0;
  integratedEpgEtag = "";
  try {
    if (fs.existsSync(EPG_EXPORT_XML_PATH)) fs.unlinkSync(EPG_EXPORT_XML_PATH);
    if (fs.existsSync(EPG_EXPORT_GZ_PATH)) fs.unlinkSync(EPG_EXPORT_GZ_PATH);
  } catch (_) {}
}

export function invalidatePlaylistExportCache() {
  exportPlaylistMemoryCache.clear();
  try {
    if (fs.existsSync(PLAYLIST_CACHE_DIR)) {
      const files = fs.readdirSync(PLAYLIST_CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(PLAYLIST_CACHE_DIR, file));
      }
    }
    if (fs.existsSync(READABLE_PLAYLIST_DIR)) {
      const files = fs.readdirSync(READABLE_PLAYLIST_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(READABLE_PLAYLIST_DIR, file));
      }
    }
  } catch (_) {}
}

export function getBuildVersionInfo() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const mins = pad(now.getMinutes());
  const secs = pad(now.getSeconds());

  const formattedTime = `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
  const versionId = `${year}${month}${day}${hours}${mins}${secs}`;

  return { formattedTime, versionId };
}

export function sortSourcesForExport(sources: LiveSource[]): LiveSource[] {
  return [...sources].sort((a, b) => {
    const statusWeightA = a.status === "active" ? 3 : (a.status === "inactive" ? 1 : 2);
    const statusWeightB = b.status === "active" ? 3 : (b.status === "inactive" ? 1 : 2);
    if (statusWeightA !== statusWeightB) {
      return statusWeightB - statusWeightA;
    }

    const isRtspA = (a.url || "").trim().toLowerCase().startsWith("rtsp://");
    const isRtspB = (b.url || "").trim().toLowerCase().startsWith("rtsp://");
    if (isRtspA !== isRtspB) {
      return isRtspA ? -1 : 1;
    }

    const latencyA = a.latency && a.latency > 0 ? a.latency : 9999;
    const latencyB = b.latency && b.latency > 0 ? b.latency : 9999;
    return latencyA - latencyB;
  });
}

export function generateDefaultPlaylists() {
  const m3uPath = path.join(DATA_DIR, "iptv_custom.m3u");
  const txtPath = path.join(DATA_DIR, "iptv_custom.txt");

  const { formattedTime, versionId } = getBuildVersionInfo();

  let playlistRows = [
    `#EXTM3U x-tvg-url="/api/export/epg.xml.gz" build-version="${versionId}"`,
    `# Playlist Version: v${versionId}`,
    `# Generated At: ${formattedTime}`
  ];
  const exportMap = new Map<string, string[]>();
  let count = 0;
  const maxLimit = Infinity;
  const maxPerChannel = 15;

  const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
  
  orderedGroups.forEach((group) => {
    if (group.isolated) return;
    channels.forEach((channel) => {
      if (channel.isolated) return;
      const isInGroup = channel.groupIds.includes(group.id);
      const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
      if (!isInGroup && !isFallback) return;

      let processedSources = channel.sources.filter(source => source.status === "active");
      processedSources = sortSourcesForExport(processedSources);
      
      const sourcesToExport = processedSources.slice(0, maxPerChannel);
      const groupName = group.name;

      sourcesToExport.forEach(bestSource => {
        if (count >= maxLimit) return;
        const channelDisplayName = channel.name;
        
        // M3U
        const exportLogo = resolveChannelLogo(channel.logo || "");
        playlistRows.push(
          `#EXTINF:-1 tvg-id="${channel.epgId}" tvg-name="${channel.name}" tvg-logo="${exportLogo}" group-title="${groupName}",${channelDisplayName}`
        );
        playlistRows.push(bestSource.url);

        // TXT
        if (!exportMap.has(groupName)) {
          exportMap.set(groupName, []);
        }
        exportMap.get(groupName)!.push(`${channel.name},${bestSource.url}`);
        
        count++;
      });
    });
  });

  const m3uContent = playlistRows.join("\n");
  
  const fileRows: string[] = [
    `# Playlist Version: v${versionId}`,
    `# Generated At: ${formattedTime}`,
    ""
  ];
  exportMap.forEach((lines, catName) => {
    fileRows.push(`${catName},#genre`);
    fileRows.push(...lines);
    fileRows.push("");
  });
  const txtContent = fileRows.join("\n");

  try {
    fs.writeFileSync(m3uPath, m3uContent, "utf-8");
    fs.writeFileSync(txtPath, txtContent, "utf-8");
  } catch (err) {
    console.error("[STATIC PLAYLIST WRITE ERROR]", err);
  }
}

let saveTimer: NodeJS.Timeout | null = null;
let shouldInvalidateCaches = false;

export function saveData(invalidate = true) {
  if (invalidate) {
    shouldInvalidateCaches = true;
    invalidateIntegratedEpgCache();
    invalidatePlaylistExportCache();
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDataSync();
  }, 1000);
}

export function saveDataSync() {
  const db = getDb();
  globalLastDataUpdate = Date.now();
  if (shouldInvalidateCaches) {
    invalidateIntegratedEpgCache();
    invalidatePlaylistExportCache();
    shouldInvalidateCaches = false;
    
    setImmediate(() => {
      try {
        generateDefaultPlaylists();
      } catch (e) {
        console.error("[PROACTIVE CACHE GEN ERROR]", e);
      }
    });
  }
  try {
    const syncDb = db.transaction(() => {
      // 1. Sync settings
      const insertSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      insertSetting.run("adminPassword", adminPassword);
      insertSetting.run("githubProxy", githubProxy);
      insertSetting.run("autoCreateChannel", autoCreateChannel ? "true" : "false");
      insertSetting.run("m3uLogoVersion", m3uLogoVersion);
      insertSetting.run("carouselProxyPresets", JSON.stringify(carouselProxyPresets));
      insertSetting.run("ipGeoApis", JSON.stringify(ipGeoApis));
      insertSetting.run("autoSwitchGeoApi", autoSwitchGeoApi ? "true" : "false");

      // 2. Sync groups
      db.exec("DELETE FROM groups");
      const insertGroup = db.prepare("INSERT INTO groups (id, name, isolated) VALUES (?, ?, ?)");
      for (const g of groups) {
        insertGroup.run(g.id, g.name, g.isolated ? 1 : 0);
      }

      // 3. Sync channels & sources
      db.exec("DELETE FROM channels");
      db.exec("DELETE FROM sources");

      const insertChannel = db.prepare("INSERT INTO channels (id, name, logo, groupIds, alias, epgId, description, isolated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const insertSource = db.prepare(`
        INSERT INTO sources (id, channelId, url, province, isp, status, latency, resolution, lastChecked, clientIspReported, clientProvinceReported, testCount, successCount, isolated)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const ch of channels) {
        insertChannel.run(
          ch.id,
          ch.name,
          ch.logo || "",
          JSON.stringify(ch.groupIds || []),
          JSON.stringify(ch.alias || []),
          ch.epgId || "",
          ch.description || "",
          ch.isolated ? 1 : 0
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
              s.resolution || "",
              s.lastChecked || "",
              s.clientIspReported || "",
              s.clientProvinceReported || "",
              s.testCount || 0,
              s.successCount || 0,
              s.isolated ? 1 : 0
            );
          }
        }
      }

      // 4. Sync sync_configs
      db.exec("DELETE FROM sync_configs");
      const insertSync = db.prepare(`
        INSERT INTO sync_configs (id, name, url, type, autoSync, syncInterval, lastSynced, status, message, disabled, consecutiveFailures, contentHash, isp, aliasOnly)
        VALUES (?, ?, ?, ?, 1, 12, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sc of syncConfigs) {
        insertSync.run(
          sc.id,
          sc.name,
          sc.url,
          sc.type,
          sc.lastSynced || "",
          sc.status || "never",
          sc.message || "",
          sc.disabled ? 1 : 0,
          sc.consecutiveFailures || 0,
          sc.contentHash || "",
          sc.isp || "",
          sc.aliasOnly ? 1 : 0
        );
      }

      // 5. Sync epg_sources
      db.exec("DELETE FROM epg_sources");
      const insertEpg = db.prepare(`
        INSERT INTO epg_sources (id, name, url, active, lastSynced, status, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const es of epgSources) {
        insertEpg.run(
          es.id,
          es.name,
          es.url,
          es.active ? 1 : 0,
          es.lastSynced || "",
          es.status || "never",
          es.message || ""
        );
      }
    });

    syncDb();
  } catch (error) {
    console.error("Failed to save IPTV data to SQLite:", error);
  }
}

// Automated Daily Backup of SQLite to prevent accidental data loss
export function checkAndPerformDailyBackup() {
  const db = getDb();
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

      // Generate a companion restorable legacy JSON file, compressed
      const backupJsonName = `iptv_data_backup_${dateStr}.json.gz`;
      const backupJsonPath = path.join(DATA_DIR, backupJsonName);
      if (!fs.existsSync(backupJsonPath)) {
        const backupJson = {
          groups,
          channels,
          syncConfigs,
          epgSources,
          adminPassword,
          githubProxy,
          carouselProxies: db.prepare("SELECT * FROM carousel_proxies").all(),
          deletedCarouselProxies: db.prepare("SELECT * FROM deleted_carousel_proxies").all(),
          carouselChannels: db.prepare("SELECT * FROM carousel_channels").all(),
          carouselDiscoveryRules: db.prepare("SELECT * FROM carousel_discovery_rules").all(),
          carouselDisabledRules: db.prepare("SELECT * FROM carousel_disabled_rules").all(),
        };
        fs.writeFileSync(backupJsonPath, zlib.gzipSync(Buffer.from(JSON.stringify(backupJson, null, 2), "utf-8")));
      }
      
      cleanOldBackups();
    }
  } catch (err) {
    console.error("[Backup] Daily automated backup failed:", err);
  }
}

export function cleanOldBackups() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    
    const autoJsonBackups = files.filter(f => f.startsWith("iptv_data_backup_2") && (f.endsWith(".json") || f.endsWith(".json.gz"))).sort();
    const autoSqliteBackups = files.filter(f => f.startsWith("iptv_data_sqlite_backup_") && f.endsWith(".db")).sort();
    
    // We retain the latest 30 manual backups
    const manualBackups = files.filter(f => (f.startsWith("iptv_data_backup_manual_") || f.startsWith("iptv_data_backup_before_restore_")) && (f.endsWith(".json") || f.endsWith(".json.gz")))
        .map(f => ({ name: f, time: fs.statSync(path.join(DATA_DIR, f)).mtime.getTime() }))
        .sort((a, b) => a.time - b.time)
        .map(obj => obj.name);

    if (autoJsonBackups.length > 30) {
      const extra = autoJsonBackups.slice(0, autoJsonBackups.length - 30);
      for (const f of extra) { fs.unlinkSync(path.join(DATA_DIR, f)); console.log(`[Backup] Deleted old auto JSON backup: ${f}`); }
    }
    
    if (autoSqliteBackups.length > 30) {
      const extra = autoSqliteBackups.slice(0, autoSqliteBackups.length - 30);
      for (const f of extra) { fs.unlinkSync(path.join(DATA_DIR, f)); console.log(`[Backup] Deleted old auto SQLite backup: ${f}`); }
    }
    
    if (manualBackups.length > 30) {
      const extra = manualBackups.slice(0, manualBackups.length - 30);
      for (const f of extra) { fs.unlinkSync(path.join(DATA_DIR, f)); console.log(`[Backup] Deleted old manual backup: ${f}`); }
    }
  } catch (err) {
    console.error("[Backup] Error cleaning up old backups:", err);
  }
}


export function loadData() {
  const db = getDb();
  try {
    let legacyJsonFound = false;
    let parsed: any = null;

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

      if (parsed.cronJobs && Array.isArray(parsed.cronJobs) && parsed.cronJobs.length > 0) {
        db.exec("DELETE FROM cron_jobs");
        const insertCron = db.prepare("INSERT INTO cron_jobs (id, name, startTime, intervalMinutes, active, nextRun, lastRun) VALUES (?, ?, ?, ?, ?, ?, ?)");
        for (const job of parsed.cronJobs) {
          insertCron.run(job.id, job.name, job.startTime || "00:00", job.intervalMinutes || 120, job.active === 1 || job.active === true ? 1 : 0, job.nextRun || null, job.lastRun || null);
        }
      }

      if (Array.isArray(parsed.carouselProxies)) {
        db.exec("DELETE FROM carousel_proxies");
        const ins = db.prepare("INSERT INTO carousel_proxies (id, platform, urlTemplate, status) VALUES (?, ?, ?, ?)");
        for (const item of parsed.carouselProxies) {
          ins.run(item.id || crypto.randomUUID(), item.platform || '', item.urlTemplate || '', item.status || 'active');
        }
      }

      if (Array.isArray(parsed.deletedCarouselProxies)) {
        db.exec("DELETE FROM deleted_carousel_proxies");
        const ins = db.prepare("INSERT OR REPLACE INTO deleted_carousel_proxies (urlTemplate, deletedAt) VALUES (?, ?)");
        for (const item of parsed.deletedCarouselProxies) {
          ins.run(item.urlTemplate || '', item.deletedAt || new Date().toISOString());
        }
      }

      if (Array.isArray(parsed.carouselChannels)) {
        db.exec("DELETE FROM carousel_channels");
        const ins = db.prepare("INSERT INTO carousel_channels (id, channelId, name, platform, originalId) VALUES (?, ?, ?, ?, ?)");
        for (const item of parsed.carouselChannels) {
          ins.run(item.id || crypto.randomUUID(), item.channelId || '', item.name || '', item.platform || '', item.originalId || '');
        }
      }

      if (Array.isArray(parsed.carouselDiscoveryRules)) {
        db.exec("DELETE FROM carousel_discovery_rules");
        const ins = db.prepare("INSERT INTO carousel_discovery_rules (id, platform, keyword, enabled) VALUES (?, ?, ?, ?)");
        for (const item of parsed.carouselDiscoveryRules) {
          ins.run(item.id || crypto.randomUUID(), item.platform || '', item.keyword || '', item.enabled === false ? 0 : 1);
        }
      }

      if (Array.isArray(parsed.carouselDisabledRules)) {
        db.exec("DELETE FROM carousel_disabled_rules");
        const ins = db.prepare("INSERT INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled) VALUES (?, ?, ?, ?, ?, ?)");
        for (const item of parsed.carouselDisabledRules) {
          ins.run(item.id || crypto.randomUUID(), item.pattern || item.keyword || '', item.type || 'pattern', item.platform || '', item.description || '', item.enabled === false ? 0 : 1);
        }
      }

      saveData();

      try {
        const bakPath = DATA_FILE + ".bak";
        if (fs.existsSync(bakPath)) {
          fs.unlinkSync(bakPath);
        }
        fs.renameSync(DATA_FILE, bakPath);
        console.log(`[Migration] Legacy JSON file archived to ${bakPath}`);
      } catch (err: any) {
        console.error("[Migration Error] Failed to archive legacy JSON file:", err.message);
      }
    } else {
      const loadedSettings = db.prepare("SELECT * FROM settings").all();
      for (const row of loadedSettings as any[]) {
        if (row.key === "adminPassword") adminPassword = row.value;
        if (row.key === "githubProxy") githubProxy = row.value;
        if (row.key === "m3uLogoVersion") m3uLogoVersion = row.value;
        if (row.key === "carouselProxyPresets") { try { carouselProxyPresets = JSON.parse(row.value); } catch(e) {} }
        if (row.key === "autoCreateChannel") autoCreateChannel = (row.value === "true" || row.value === "1");
        if (row.key === "ipGeoApis") {
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const anyEnabled = parsed.some((a: any) => a.enabled);
              if (!anyEnabled) {
                parsed.forEach((a: any) => { a.enabled = true; a.failCount = 0; });
              }
              if (!parsed.some((a: any) => a.id === "ipwhois" || a.url?.includes("ipwho.is"))) {
                parsed.push({ id: "ipwhois", name: "ipwho.is", url: "https://ipwho.is/{{ip}}?lang=zh-CN", enabled: true, failCount: 0 });
              }
              ipGeoApis = parsed;
            }
          } catch(e) {}
        }
        if (row.key === "autoSwitchGeoApi") autoSwitchGeoApi = (row.value === "true" || row.value === "1");
      }

      const loadedGroups = db.prepare("SELECT * FROM groups").all();
      groups = loadedGroups.map((g: any) => ({
        id: g.id,
        name: g.name,
        isolated: g.isolated === 1 ? true : false
      }));

      const loadedSyncConfigs = db.prepare("SELECT * FROM sync_configs").all();
      syncConfigs = loadedSyncConfigs.map((sc: any) => ({
        id: sc.id,
        name: sc.name,
        url: sc.url,
        type: sc.type,
        lastSynced: sc.lastSynced || undefined,
        status: sc.status || "never",
        message: sc.message || undefined,
        disabled: sc.disabled === 1,
        consecutiveFailures: sc.consecutiveFailures || 0,
        contentHash: sc.contentHash || undefined,
        isp: sc.isp || undefined,
        aliasOnly: sc.aliasOnly === 1
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
          resolution: row.resolution || undefined,
          lastChecked: row.lastChecked || undefined,
          clientIspReported: row.clientIspReported || undefined,
          clientProvinceReported: row.clientProvinceReported || undefined,
          isolated: row.isolated === 1 ? true : false,
          testCount: row.testCount || 0,
          successCount: row.successCount || 0
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
          description: ch.description || "",
          isolated: ch.isolated === 1 ? true : false,
          sources: sourceMap.get(ch.id) || []
        };
      });
    }

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

    const regionalAliasPattern = /(美洲|欧洲|亚洲|america|europe|asia|AME|EUO|EUR)/i;
    const ultraHdAliasPattern = /(4K|8K|超高清)/i;

    channels.forEach(ch => {
      const isRegionalChannel = regionalAliasPattern.test(ch.name);
      const isUltraHdChannel = ultraHdAliasPattern.test(ch.name);

      if (ch.alias && ch.alias.length > 0) {
        const origLen = ch.alias.length;
        ch.alias = ch.alias.filter(a => {
          if (!isRegionalChannel && /cctv/i.test(a) && regionalAliasPattern.test(a)) {
            return false;
          }
          if (!isUltraHdChannel && ultraHdAliasPattern.test(a)) {
            return false;
          }
          return true;
        });
        if (ch.alias.length !== origLen) {
          updated = true;
        }
      }
    });

    const chMeizhou = channels.find(c => c.name === "CCTV-4美洲" || c.name === "CCTV4美洲");
    const chOuzhou = channels.find(c => c.name === "CCTV-4欧洲" || c.name === "CCTV4欧洲");
    channels.forEach(ch => {
      if (ch.name.includes("CCTV-4") && !ch.name.includes("美洲") && !ch.name.includes("欧洲")) {
        const remainingSources: LiveSource[] = [];
        for (const src of ch.sources || []) {
          const u = src.url || "";
          if ((u.includes("cctv4meihd") || u.includes("608807416")) && chMeizhou) {
            if (!chMeizhou.sources.some(s => s.id === src.id)) {
              chMeizhou.sources.push(src);
              updated = true;
            }
          } else if ((u.includes("cctv4ouhd") || u.includes("608807419")) && chOuzhou) {
            if (!chOuzhou.sources.some(s => s.id === src.id)) {
              chOuzhou.sources.push(src);
              updated = true;
            }
          } else {
            remainingSources.push(src);
          }
        }
        if (remainingSources.length !== (ch.sources || []).length) {
          ch.sources = remainingSources;
          updated = true;
        }
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

    channels.forEach((c: any) => {
      const invalidGenericIds = ["hd", "sd", "fhd", "uhd", "hevc", "h265", "h264", "1080p", "720p", "4k", "8k", "高清", "超清", "标清", "sdi", "channel", "tv"];
      if (!c.epgId || c.epgId.trim().length === 0 || (typeof c.epgId === "string" && invalidGenericIds.includes(c.epgId.toLowerCase().trim()))) {
        const freshEpgId = generateDefaultEpgId(c.name);
        if (freshEpgId !== c.epgId) {
          c.epgId = freshEpgId;
          updated = true;
        }
      }
    });

    channels.forEach((c: any) => {
      (c.sources || []).forEach((s: any) => {
        if (isPrivateOrIntranetUrl(s.url)) {
          const isTimeout = s.latency !== undefined && s.latency >= 9999;
          if (!isTimeout) {
            if (s.isolated) {
              s.isolated = false;
              updated = true;
            }
            if (s.status === "inactive") {
              s.status = "active";
              updated = true;
            }
          }
        }
      });
    });

    try {
      const chMap = new Map(channels.map(c => [c.id, c.name]));
      const nameMap = new Map<string, string>();
      for (const ch of channels) {
        nameMap.set(normalizeChannelName(ch.name), ch.id);
        if (Array.isArray(ch.alias)) {
          for (const a of ch.alias) {
            nameMap.set(normalizeChannelName(a), ch.id);
          }
        }
      }
      const carouselChs = db.prepare("SELECT id, channelId, name FROM carousel_channels").all() as any[];
      const updateStmt = db.prepare("UPDATE carousel_channels SET channelId = ?, name = ? WHERE id = ?");
      for (const cc of carouselChs) {
        if (cc.channelId && chMap.has(cc.channelId)) {
          const liveName = chMap.get(cc.channelId)!;
          if (liveName && liveName !== cc.name) {
            updateStmt.run(cc.channelId, liveName, cc.id);
          }
        } else if (cc.name) {
          const foundId = nameMap.get(normalizeChannelName(cc.name));
          if (foundId) {
            const liveName = chMap.get(foundId) || cc.name;
            updateStmt.run(foundId, liveName, cc.id);
          }
        }
      }
    } catch (e) {
      console.error("Failed to sync carousel channel names on startup:", e);
    }

    if (updated) {
      saveDataSync();
    } else {
      setTimeout(() => {
        try {
          generateDefaultPlaylists();
        } catch(e) {
          console.error("[STARTUP CACHE GEN ERROR]", e);
        }
      }, 2000);
    }

  } catch (error) {
    console.error("Failed to load IPTV data from SQLite:", error);
    channels = DEFAULT_CHANNELS;
    syncConfigs = DEFAULT_SYNC_CONFIGS;
    groups = DEFAULT_GROUPS;
  }
}

// Initial data load from SQLite on startup
loadData();
