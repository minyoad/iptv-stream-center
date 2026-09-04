import express from "express";
import zlib from "zlib";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { execFile } from "child_process";
import compression from "compression";
import { createServer as createViteServer } from "vite";

const execFileAsync = promisify(execFile);

// Ensure local time is interpreted as CST (UTC+8) by default if not specified
process.env.TZ = process.env.TZ || "Asia/Shanghai";

// Shared types
import {
  LiveSource,
  Channel,
  Group,
  SyncConfig,
  EpgSource,
  TestStatus,
  CarouselProxy,
  CarouselChannel,
  CarouselDiscoveryRule,
  CarouselDisabledRule,
  EpgEntry,
  IpGeoApi
} from "./server/types";

// Constants
import { DEFAULT_CHANNELS, DATA_DIR, DATA_FILE } from "./server/constants";

// DB & Store
import { getDb } from "./server/db/sqlite";
import {
  loadData,
  globalLastDataUpdate,
  channels,
  groups,
  syncConfigs,
  epgSources,
  adminPassword,
  githubProxy,
  autoCreateChannel,
  m3uLogoVersion,
  carouselProxyPresets,
  ipGeoApis,
  autoSwitchGeoApi,
  saveData,
  saveDataSync,
  checkAndPerformDailyBackup,
  setGroups,
  setChannels,
  setSyncConfigs,
  setEpgSources,
  setAdminPassword,
  setGithubProxy,
  setAutoCreateChannel,
  setM3uLogoVersion,
  setCarouselProxyPresets,
  setIpGeoApis,
  setAutoSwitchGeoApi
} from "./server/store";

// Utilities
import {
  toSimplifiedChinese,
  normalizeChannelName,
  findAliasTemplate,
  stripBitrateAndResolution,
  parseIspAndProvince,
  generateDefaultEpgId,
  getBuildVersionInfo,
  loadedDefaultAliases
} from "./server/utils/text";

import {
  fetchBufferWithFallback,
  isPrivateOrIntranetUrl
} from "./server/utils/network";

// Geo Channels & AI Services
import {
  PROVINCES_LIST,
  CITY_TO_PROVINCE,
  REGIONAL_TV_BRANDS,
  STANDARD_CCTV_NAME_MAP,
  detectProvinceAndIspFromName,
  formatProvinceGroupName,
  determineSmartTargetGroups,
  cleanChannelNameForSmartOrganize,
  stripNoiseForDetection
} from "./server/geo_channels";

import {
  getAiConfig,
  saveAiConfig,
  testAiConnection,
  suggestChannelMetadata,
  batchSuggestChannels,
  describeChannelWithAi,
  batchDescribeChannelsWithAi,
  matchBuiltinChannel,
  deduceChannelRule,
  getLogoSources,
  resolveChannelLogo,
  LogoCdnSource,
  AiConfig
} from "./server/aiService";

// Carousel Services
import {
  seedKnownRules,
  seedDisabledRules,
  getDiscoveryRules,
  getDisabledRules,
  isUrlBlockedByDisabledRules,
  cleanupBlockedCarouselProxies,
  removeSourcesForProxyTemplates,
  parseCarouselUrl,
  detectAndRegisterCarouselProxy,
  scanAndRegisterAllCarouselProxies,
  syncCarouselSources,
  isCarouselSource,
  invalidateDiscoveryRulesCache,
  invalidateDisabledRulesCache
} from "./server/services/carouselService";

// Speed Test & Geo Services
import {
  testStatus,
  testSingleUrl,
  isResponseContentInvalid,
  runConcurrentTest,
  updateSourceDbStatus,
  getClientIpGeo,
  testCarouselProxyAvailability
} from "./server/services/speedTestService";

// EPG Services
import {
  EPG_CACHE_DIR,
  loadedEpgCaches,
  parseXmltvTime,
  isEpgDisclaimerProgram,
  getEpgCache,
  findMatchingEpgEntry,
  performEpgSync,
  getOrGenerateIntegratedEpgXml,
  invalidateIntegratedEpgCache
} from "./server/services/epgService";

// Sync & Cron Services
import {
  ChannelImportHelper,
  performSync,
  calculateNextRun,
  runCronJob,
  startCronScheduler
} from "./server/services/syncService";

// Playlist Services
import {
  getPlaylistCacheKey,
  sortSourcesByGeo,
  sortSourcesForExport,
  getPlayableSources,
  getOrGeneratePlaylistExport,
  generateM3uPlaylist,
  generateTxtPlaylist,
  preGenerateIspPlaylists,
  invalidatePlaylistExportCache,
  recordClientAccess,
  parseClientApp
} from "./server/services/playlistService";

const db = getDb();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(compression());
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
    
    setAdminPassword((newPassword || "").trim());
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
      req.path === "/api/sources/client-test-list" ||
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
    res.json({ githubProxy, autoCreateChannel, ipGeoApis, autoSwitchGeoApi, m3uLogoVersion, carouselProxyPresets });
  });

  app.post("/api/settings", (req, res) => {
    const { githubProxy: proxy, autoCreateChannel: autoCreate, ipGeoApis: newIpGeoApis, autoSwitchGeoApi: newAutoSwitchGeoApi, m3uLogoVersion: newM3uLogoVersion, carouselProxyPresets: newCarouselProxyPresets } = req.body;
    if (proxy !== undefined) {
      setGithubProxy((proxy || "").trim());
    }
    if (autoCreate !== undefined) {
      setAutoCreateChannel(!!autoCreate);
    }
    if (newIpGeoApis !== undefined) {
      setIpGeoApis(newIpGeoApis);
    }
    if (newAutoSwitchGeoApi !== undefined) {
      setAutoSwitchGeoApi(!!newAutoSwitchGeoApi);
    }
    if (newM3uLogoVersion !== undefined) {
      setM3uLogoVersion((newM3uLogoVersion || "").trim());
    }
    if (newCarouselProxyPresets !== undefined) {
      setCarouselProxyPresets(newCarouselProxyPresets);
    }

    saveData();
    res.json({ success: true, githubProxy, autoCreateChannel, ipGeoApis, autoSwitchGeoApi, m3uLogoVersion, carouselProxyPresets });
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
    setEpgSources(epgSources.filter((s) => s.id !== id));
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
    source.status = "syncing";
    source.message = "正在后台拉取 EPG XML 数据...";
    saveData();
    res.json({ success: true, message: "EPG 同步任务已在后台启动", source, isBackground: true });

    setImmediate(async () => {
      try {
        await performEpgSync(source);
      } catch (e: any) {
        source.status = "failed";
        source.message = e.message || "EPG 同步失败";
        saveData();
      }
    });
  });

  app.post("/api/epg-sources/sync-all", async (req, res) => {
    const activeSources = epgSources.filter((s) => s.active);
    for (const s of activeSources) {
      s.status = "syncing";
      s.message = "正在后台排队同步 EPG...";
    }
    saveData();
    res.json({ success: true, message: `已在后台启动 ${activeSources.length} 个 EPG 源的同步任务`, count: activeSources.length, isBackground: true });

    setImmediate(async () => {
      for (const source of activeSources) {
        try {
          await performEpgSync(source);
        } catch (e: any) {
          source.status = "failed";
          source.message = e.message || "EPG 同步失败";
          saveData();
        }
      }
    });
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

  // 实时对单个直播源发起深度诊断与测速
  app.post("/api/sources/test-single", async (req, res) => {
    const { sourceId, channelId, url } = req.body;
    let targetUrl = url;
    let targetChannelId = channelId;
    let targetSourceId = sourceId;

    if (targetChannelId && targetSourceId) {
      const ch = channels.find((c) => c.id === targetChannelId);
      const src = ch?.sources.find((s) => s.id === targetSourceId);
      if (src) {
        targetUrl = src.url;
      }
    } else if (targetSourceId) {
      for (const c of channels) {
        const src = c.sources.find((s) => s.id === targetSourceId);
        if (src) {
          targetChannelId = c.id;
          targetUrl = src.url;
          break;
        }
      }
    }

    if (!targetUrl) {
      return res.status(400).json({ error: "参数不完整或未找到目标 URL" });
    }

    try {
      const result = await testSingleUrl(targetUrl, 6000);
      if (targetChannelId && targetSourceId) {
        updateSourceDbStatus(targetChannelId, targetSourceId, result.status, result.latency, result.resolution, result.diagMsg);
        saveData(true);
      }
      res.json({
        success: true,
        status: result.status,
        latency: result.latency,
        resolution: result.resolution,
        diagMsg: result.diagMsg
      });
    } catch (err: any) {
      res.status(500).json({ error: "现场诊断失败: " + (err?.message || err) });
    }
  });

  app.get("/api/groups", (req, res) => {
    res.json(groups);
  });

  app.post("/api/groups", (req, res) => {
    const { name, isolated } = req.body;
    if (!name) {
      return res.status(400).json({ error: "分组名称不能为空" });
    }
    const newGroup: Group = {
      id: "g_" + Math.random().toString(36).substring(2, 10),
      name,
      isolated: !!isolated,
    };
    groups.push(newGroup);
    saveData();
    res.status(201).json(newGroup);
  });

  app.put("/api/groups/:id", (req, res) => {
    const { id } = req.params;
    const { name, isolated } = req.body;

    const group = groups.find((g) => g.id === id);
    if (!group) {
      return res.status(404).json({ error: "未找到该分组" });
    }
    if (name) group.name = name;
    if (isolated !== undefined) group.isolated = !!isolated;
    saveData();
    res.json(group);
  });

  app.post("/api/groups/:id/isolated", (req, res) => {
    const { id } = req.params;
    const { isolated } = req.body;
    
    const group = groups.find((g) => g.id === id);
    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }
    
    group.isolated = !!isolated;
    saveData();
    res.json({ success: true, isolated: group.isolated });
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
    
    setGroups(newGroups);
    saveData();
    res.json({ success: true });
  });

  app.delete("/api/groups/:id", (req, res) => {
    const { id } = req.params;
    setGroups(groups.filter((g) => g.id !== id));

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

    app.get("/api/all-data", (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    let carouselStats = { channelsCount: 0, proxiesCount: 0, activeProxiesCount: 0 };
    try {
      const chCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_channels').get() as any)?.count || 0;
      const prCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any)?.count || 0;
      const activePrCount = (db.prepare("SELECT COUNT(*) as count FROM carousel_proxies WHERE status = 'active'").get() as any)?.count || 0;
      carouselStats = { channelsCount: chCount, proxiesCount: prCount, activeProxiesCount: activePrCount };
    } catch {}
    res.json({
      channels,
      syncConfigs,
      groups,
      epgSources,
      carouselStats,
      settings: { githubProxy, autoCreateChannel, ipGeoApis, autoSwitchGeoApi, m3uLogoVersion, carouselProxyPresets }
    });
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
        logo: resolveChannelLogo(ch.logo || ""),
        sources: list
      };
    }).filter((ch) => ch.sources.length > 0);

    res.json(results);
  });

  app.post("/api/channels", (req, res) => {
    let { name, groupIds, category, logo, alias, epgId, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: "频道名称为必填项" });
    }

    name = toSimplifiedChinese(name);
    if (category) category = toSimplifiedChinese(category);
    if (description) description = toSimplifiedChinese(description);

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
      description: description || "",
      isolated: !!req.body.isolated,
      sources: []
    };

    channels.push(newChannel);
    saveData();
    res.status(201).json(newChannel);
  });

  app.put("/api/channels/:id", (req, res) => {
    const { id } = req.params;
    const { name, groupIds, category, logo, alias, epgId, description, isolated } = req.body;

    const channel = channels.find((c) => c.id === id);
    if (!channel) {
      return res.status(404).json({ error: "未找到该频道" });
    }

    if (name) {
      channel.name = name;
      try {
        db.prepare("UPDATE carousel_channels SET name = ? WHERE channelId = ?").run(name, id);
      } catch (e) {}
    }
    
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
      channel.alias = Array.from(new Set(Array.isArray(alias) ? alias : alias.split(/[,;，；:]/).map((s: string) => s.trim()).filter(Boolean)));
    }
    if (epgId !== undefined) channel.epgId = epgId;
    if (description !== undefined) channel.description = toSimplifiedChinese(description);
    if (isolated !== undefined) {
      channel.isolated = !!isolated;
      if (channel.sources) {
        channel.sources.forEach(s => s.isolated = !!isolated);
      }
    }

    saveData();
    res.json(channel);
  });

  // Toggle single channel isolation
  app.post("/api/channels/:id/isolated", (req, res) => {
    const { id } = req.params;
    const { isolated } = req.body;
    const channel = channels.find((c) => c.id === id);
    if (!channel) {
      return res.status(404).json({ error: "未找到该频道" });
    }
    channel.isolated = !!isolated;
    if (channel.sources) {
      channel.sources.forEach(s => s.isolated = !!isolated);
    }
    saveData();
    res.json({ success: true, isolated: channel.isolated });
  });

  // Batch toggle channel isolation
  app.post("/api/channels/batch-isolate", (req, res) => {
    const { channelIds, isolated } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供频道 ID 列表" });
    }
    let updatedCount = 0;
    channels.forEach((c) => {
      if (channelIds.includes(c.id)) {
        c.isolated = !!isolated;
        if (c.sources) {
          c.sources.forEach(s => s.isolated = !!isolated);
        }
        updatedCount++;
      }
    });
    saveData();
    res.json({ success: true, count: updatedCount, isolated: !!isolated });
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
    
    setChannels(newChannels);
    saveData();
    res.json({ success: true });
  });

  app.delete("/api/channels/:id", (req, res) => {
    const { id } = req.params;
    const initialLength = channels.length;
    setChannels(channels.filter((c) => c.id !== id));

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
    setChannels(channels.filter((c) => !channelIds.includes(c.id)));

    saveData();
    res.json({ success: true, count: initialLength - channels.length });
  });

  // Batch enrich channel logos using AI and authority knowledge base
  app.post("/api/channels/batch-enrich-logos", (req, res) => {
    try {
      const { channelIds, overwrite = false } = req.body;
      let targetChannels = channels;
      if (Array.isArray(channelIds) && channelIds.length > 0) {
        targetChannels = channels.filter((c) => channelIds.includes(c.id));
      }

      let updatedCount = 0;
      const details: Array<{ id: string; name: string; oldLogo: string; newLogo: string }> = [];

      for (const ch of targetChannels) {
        const hasMissingLogo = !ch.logo || ch.logo.includes("placeholder") || ch.logo.includes("default") || ch.logo.trim() === "";
        if (!overwrite && !hasMissingLogo) {
          continue;
        }

        // Match against standard channel database
        const builtin = matchBuiltinChannel(ch.name);
        let targetLogo = "";
        if (builtin && builtin.logo) {
          targetLogo = resolveChannelLogo(builtin.logo);
        } else {
          const rule = deduceChannelRule(ch.name);
          if (rule && rule.logo && !rule.logo.includes("undefined")) {
            targetLogo = resolveChannelLogo(rule.logo);
          }
        }

        if (targetLogo && targetLogo !== ch.logo) {
          const oldLogo = ch.logo || "";
          ch.logo = targetLogo;
          updatedCount++;
          details.push({
            id: ch.id,
            name: ch.name,
            oldLogo,
            newLogo: targetLogo
          });
        }
      }

      if (updatedCount > 0) {
        saveData();
        invalidatePlaylistExportCache();
        invalidateIntegratedEpgCache();
      }

      res.json({
        success: true,
        updatedCount,
        totalChecked: targetChannels.length,
        message: `已成功为 ${updatedCount} 个频道智能匹配并补齐官方高清台标！`,
        details
      });
    } catch (err: any) {
      console.error("[Batch Enrich Logos Error]:", err);
      res.status(500).json({ error: "批量补齐台标失败: " + err.message });
    }
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
    setChannels(channels.filter(c => !otherIdsToMerge.includes(c.id)));

    // Update any carousel_channels mappings that were linked to merged channels or primary channel
    try {
      if (otherIdsToMerge.length > 0) {
        const placeholders = otherIdsToMerge.map(() => '?').join(',');
        db.prepare(`UPDATE carousel_channels SET channelId = ?, name = ? WHERE channelId IN (${placeholders})`).run(
          primaryChannel.id,
          primaryChannel.name,
          ...otherIdsToMerge
        );
      }
      db.prepare("UPDATE carousel_channels SET name = ? WHERE channelId = ?").run(primaryChannel.name, primaryChannel.id);
    } catch (e) {
      console.error("[Carousel Merge Sync Error]", e);
    }

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

  // Batch remove channel from specific group
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
        if (!Array.isArray(c.groupIds)) {
          c.groupIds = [];
        }
        const originalLen = c.groupIds.length;
        c.groupIds = c.groupIds.filter((gId) => gId !== groupId);
        
        // If no group is assigned, fallback to other group
        if (c.groupIds.length === 0) {
          let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
          if (!otherGroup) {
            otherGroup = { id: "g_other", name: "其它频道" };
            groups.push(otherGroup);
          }
          c.groupIds.push(otherGroup.id);
        }

        if (c.groupIds.length !== originalLen || c.groupIds.includes("g_other")) {
          updatedCount++;
        }
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // --- AI Model & Assistant Endpoints ---
  app.get("/api/ai/config", (req, res) => {
    try {
      const cfg = getAiConfig();
      const maskedApiKey = cfg.apiKey
        ? cfg.apiKey.length > 8
          ? cfg.apiKey.substring(0, 4) + "********" + cfg.apiKey.substring(cfg.apiKey.length - 4)
          : "********"
        : "";
      const logoSources = getLogoSources();
      res.json({
        success: true,
        config: {
          provider: cfg.provider,
          model: cfg.model,
          baseUrl: cfg.baseUrl,
          temperature: cfg.temperature,
          logoBaseFan: cfg.logoBaseFan || "",
          logoBase112: cfg.logoBase112 || "",
          logoSources,
          hasApiKey: Boolean(cfg.apiKey),
          maskedApiKey
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: "获取 AI 配置失败: " + err.message });
    }
  });

  app.post("/api/ai/config", (req, res) => {
    try {
      const { provider, apiKey, baseUrl, model, temperature, logoBaseFan, logoBase112, logoSources } = req.body;
      const current = getAiConfig();
      const targetProvider = provider || current.provider || "siliconflow";
      const sameProvider = targetProvider === current.provider;

      let finalApiKey = sameProvider ? current.apiKey : "";
      if (typeof apiKey === "string" && !apiKey.includes("*") && apiKey.trim() !== "") {
        finalApiKey = apiKey.trim();
      }

      const newConfig: AiConfig = {
        provider: targetProvider,
        apiKey: finalApiKey,
        baseUrl: baseUrl || current.baseUrl,
        model: model || current.model,
        temperature: typeof temperature === "number" ? temperature : current.temperature,
        logoBaseFan: typeof logoBaseFan === "string" ? logoBaseFan.trim() : current.logoBaseFan,
        logoBase112: typeof logoBase112 === "string" ? logoBase112.trim() : current.logoBase112,
        logoSources: Array.isArray(logoSources) ? logoSources : current.logoSources
      };
      saveAiConfig(newConfig);
      invalidatePlaylistExportCache();
      invalidateIntegratedEpgCache();
      res.json({ success: true, message: "AI 与官方台标库配置已成功保存" });
    } catch (err: any) {
      res.status(500).json({ error: "保存 AI 配置失败: " + err.message });
    }
  });

  app.post("/api/channels/batch-sync-cdn-logos", (req, res) => {
    try {
      let updatedCount = 0;
      channels.forEach((ch) => {
        if (ch.logo && !ch.logo.includes("unsplash.com") && !ch.logo.startsWith("data:")) {
          const resolved = resolveChannelLogo(ch.logo);
          if (resolved && resolved !== ch.logo) {
            ch.logo = resolved;
            updatedCount++;
          }
        }
      });
      if (updatedCount > 0) {
        saveData();
      }
      invalidatePlaylistExportCache();
      invalidateIntegratedEpgCache();
      res.json({
        success: true,
        updatedCount,
        message: `已成功将当前生效的台标 CDN 库应用并同步至 ${updatedCount} 个频道！`
      });
    } catch (err: any) {
      res.status(500).json({ error: "应用台标 CDN 失败: " + err.message });
    }
  });

  app.post("/api/ai/test", async (req, res) => {
    try {
      const customConfig = req.body;
      const result = await testAiConnection(customConfig);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: "测试请求异常: " + err.message });
    }
  });

  app.post("/api/ai/describe-channel", async (req, res) => {
    try {
      const { channelName, groupNames, epgId, existingNotes } = req.body;
      if (!channelName) {
        return res.status(400).json({ error: "频道名称不能为空" });
      }
      const description = await describeChannelWithAi(channelName, groupNames, epgId, existingNotes);
      res.json({ success: true, description });
    } catch (err: any) {
      res.status(500).json({ error: "AI 描述生成失败: " + err.message });
    }
  });

  app.post("/api/channels/batch-describe", async (req, res) => {
    try {
      const { channelIds, overwrite = false } = req.body;
      let targetChannels = channels;
      if (Array.isArray(channelIds) && channelIds.length > 0) {
        targetChannels = channels.filter((c) => channelIds.includes(c.id));
      }

      const toProcess = targetChannels.filter(
        (c) => overwrite || !c.description || c.description.trim() === ""
      );

      if (toProcess.length === 0) {
        return res.json({
          success: true,
          updatedCount: 0,
          totalChecked: targetChannels.length,
          message: "所选频道均已有描述与备注"
        });
      }

      const prepareList = toProcess.map((ch) => {
        const gNames = (ch.groupIds || [])
          .map((gId) => groups.find((g) => g.id === gId)?.name)
          .filter(Boolean) as string[];
        return {
          id: ch.id,
          name: ch.name,
          groupNames: gNames,
          epgId: ch.epgId,
          description: ch.description
        };
      });

      const results = await batchDescribeChannelsWithAi(prepareList);
      let updatedCount = 0;

      for (const resItem of results) {
        const found = channels.find((c) => c.id === resItem.id);
        if (found && resItem.description) {
          found.description = resItem.description;
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        saveData();
      }

      res.json({
        success: true,
        updatedCount,
        totalChecked: targetChannels.length,
        message: `已成功为 ${updatedCount} 个频道生成 AI 描述与备注！`
      });
    } catch (err: any) {
      console.error("[Batch Describe Error]:", err);
      res.status(500).json({ error: "批量生成描述失败: " + err.message });
    }
  });

  app.post("/api/ai/channel-suggest", async (req, res) => {
    try {
      const { channelName, originalGroup, existingGroups } = req.body;
      if (!channelName) {
        return res.status(400).json({ error: "频道名称不能为空" });
      }
      const allGroupNames = Array.isArray(existingGroups) && existingGroups.length > 0
        ? existingGroups
        : groups.map((g) => g.name);

      const suggestion = await suggestChannelMetadata(channelName, originalGroup, allGroupNames);
      res.json({ success: true, suggestion });
    } catch (err: any) {
      res.status(500).json({ error: "AI 推导失败: " + err.message });
    }
  });

  app.post("/api/ai/batch-suggest", async (req, res) => {
    try {
      const { channelList, existingGroups } = req.body;
      if (!Array.isArray(channelList) || channelList.length === 0) {
        return res.status(400).json({ error: "待推导频道列表不能为空" });
      }
      const allGroupNames = Array.isArray(existingGroups) && existingGroups.length > 0
        ? existingGroups
        : groups.map((g) => g.name);

      const suggestions = await batchSuggestChannels(channelList, allGroupNames);
      res.json({ success: true, suggestions });
    } catch (err: any) {
      res.status(500).json({ error: "批量 AI 推导失败: " + err.message });
    }
  });

  // --- Smart Organize (智能整理) Endpoints ---
  app.post("/api/channels/smart-organize/preview", async (req, res) => {
    const startTime = Date.now();
    try {
      const options = req.body || {};
      const organizeEngine = options.organizeEngine || (options.useAi === false ? "fast" : "ai");
      const useAi = organizeEngine === "ai" && options.useAi !== false;
      const groupingMode = options.groupingMode || "smart"; // "smart" | "province_only" | "keep_existing"
      const provinceNameFormat = options.provinceNameFormat || "raw";
      const allowMultiGroup = options.allowMultiGroup !== false; // Default true
      const normalizeCctv = options.normalizeCctv !== false;
      const normalizeSatTv = options.normalizeSatTv !== false;
      const stripResolution = options.stripResolution !== false;
      const extractIspAndProvince = options.extractIspAndProvince !== false;
      const onlyLocalChannels = options.onlyLocalChannels === true;

      // Group name mapping
      const groupMap = new Map<string, string>(); // id -> name
      groups.forEach((g) => groupMap.set(g.id, g.name));
      const existingGroupNames = Array.from(new Set(groups.map((g) => g.name)));

      const changes: any[] = [];
      const neededGroupNames = new Set<string>();

      // AI Batch Suggestions (if useAi is enabled)
      let aiMap = new Map<string, any>();
      if (useAi && channels.length > 0) {
        try {
          const channelItems = channels.map((c) => ({
            id: c.id,
            name: c.name,
            originalGroup: (c.groupIds || []).map((id) => groupMap.get(id) || "").filter(Boolean).join(", ")
          }));
          const aiResults = await batchSuggestChannels(channelItems, existingGroupNames);
          if (aiResults && typeof aiResults === "object") {
            Object.entries(aiResults).forEach(([id, r]) => aiMap.set(id, r));
          }
        } catch (aiErr) {
          console.warn("[SmartOrganize Preview] AI batch error, falling back to rule engine:", aiErr);
        }
      }

      channels.forEach((c) => {
        const originalName = c.name;
        const rawGroupNames = (c.groupIds || []).map((id) => groupMap.get(id) || "其它频道");
        const originalGroupNames = rawGroupNames.length > 0 ? rawGroupNames : ["其它频道"];

        // 1. Detect Province & ISP from original channel title and sources using robust geo engine
        const sourceUrls = (c.sources || []).map((s) => s.url || "").filter(Boolean);
        const { detectedProvince, detectedIsp } = detectProvinceAndIspFromName(originalName, sourceUrls);
        
        // Explicitly check province/city detection from channel name ONLY
        const nameProvince = detectProvinceAndIspFromName(originalName).detectedProvince;

        // If onlyLocalChannels mode is enabled, skip channels that are CCTV, Satellite TV, HK/Macau/Taiwan or have no detected province in channel name
        if (onlyLocalChannels) {
          const upper = originalName.toUpperCase();
          const isCctvOrSatOrHk = /^CCTV/i.test(upper) || upper.includes("央视") || upper.includes("CGTN") || upper.includes("CETV") || originalName.includes("卫视") || /翡翠|明珠|TVB|凤凰|澳视|华视|台视|中视|三立|东森|HBO|星空/i.test(originalName);
          if (isCctvOrSatOrHk || !nameProvince) {
            return; // Skip non-local channels or channels without explicit province/city keyword in channel name
          }
        }

        // 2. Clean/Normalize Name
        let newName = cleanChannelNameForSmartOrganize(
          originalName,
          {
            stripResolution,
            extractIspAndProvince,
            normalizeCctv,
            normalizeSatTv
          },
          stripBitrateAndResolution,
          normalizeChannelName
        );

        // 3. Determine Target Group(s)
        let targetGroupNames: string[] = determineSmartTargetGroups(
          originalName,
          detectedProvince,
          { groupingMode, provinceNameFormat, allowMultiGroup },
          existingGroupNames
        );

        // 4. Integrate AI Suggestions if available
        const aiInfo = aiMap.get(c.id);
        let aiEnhanced = false;
        let aiReason = "";
        let suggestedLogo = "";
        let suggestedAliases: string[] = [];
        let suggestedEpgId = "";

        if (aiInfo) {
          aiEnhanced = true;
          aiReason = aiInfo.reason || "";
          suggestedLogo = aiInfo.suggestedLogo || "";
          suggestedAliases = aiInfo.suggestedAliases || [];
          suggestedEpgId = aiInfo.suggestedEpgId || "";

          // If AI suggested a standard name and rule didn't change it much, adopt AI standard name
          if (aiInfo.standardName && aiInfo.standardName !== originalName) {
            newName = aiInfo.standardName;
          }

          // If groupingMode is smart, merge AI suggested groups
          if (groupingMode === "smart" && Array.isArray(aiInfo.suggestedGroups) && aiInfo.suggestedGroups.length > 0) {
            if (allowMultiGroup) {
              targetGroupNames = Array.from(new Set([...targetGroupNames, ...aiInfo.suggestedGroups]));
            } else {
              targetGroupNames = [aiInfo.suggestedGroups[0]];
            }
          }
        }

        // 4.1 If suggestedLogo is not populated yet, check builtin and deduction knowledge base
        if (!suggestedLogo) {
          const builtin = matchBuiltinChannel(newName) || matchBuiltinChannel(originalName);
          if (builtin && builtin.logo) {
            suggestedLogo = builtin.logo;
          } else {
            const deduced = deduceChannelRule(newName);
            if (deduced && deduced.logo && !deduced.logo.includes("undefined")) {
              suggestedLogo = deduced.logo;
            }
          }
        }

        if (groupingMode === "keep_existing") {
          const hasCustomGroup = originalGroupNames.some((gn) => gn !== "其它频道" && gn !== "未分类");
          if (hasCustomGroup) {
            targetGroupNames = [...originalGroupNames];
          }
        }

        // Check source updates
        let sourcesUpdatedCount = 0;
        const proposedSources = (c.sources || []).map((s) => {
          let updatedIsp = s.isp;
          let updatedProvince = s.province;

          if (extractIspAndProvince) {
            if ((!updatedIsp || updatedIsp === "BGP" || updatedIsp === "未知") && detectedIsp) {
              updatedIsp = detectedIsp;
            }
            if ((!updatedProvince || updatedProvince === "全国" || updatedProvince === "未知") && detectedProvince) {
              updatedProvince = detectedProvince;
            }
          }

          if (updatedIsp !== s.isp || updatedProvince !== s.province) {
            sourcesUpdatedCount++;
          }

          return {
            id: s.id,
            url: s.url,
            originalIsp: s.isp || "BGP",
            newIsp: updatedIsp || "BGP",
            originalProvince: s.province || "全国",
            newProvince: updatedProvince || "全国"
          };
        });

        // Record needed group names
        targetGroupNames.forEach((gn) => neededGroupNames.add(gn));

        const nameChanged = originalName !== newName;
        const groupsChanged = JSON.stringify([...originalGroupNames].sort()) !== JSON.stringify([...targetGroupNames].sort());

        if (nameChanged || groupsChanged || sourcesUpdatedCount > 0 || aiEnhanced) {
          changes.push({
            channelId: c.id,
            originalName,
            newName,
            originalGroupNames,
            targetGroupNames,
            sourcesUpdatedCount,
            detectedProvince: detectedProvince || "全国",
            detectedIsp: detectedIsp || "BGP",
            proposedSources,
            nameChanged,
            groupsChanged,
            aiEnhanced,
            aiReason,
            suggestedLogo,
            suggestedAliases,
            suggestedEpgId
          });
        }
      });

      // Find which target groups do not exist yet in database
      const existingGroupNameSet = new Set(groups.map((g) => g.name));
      const newGroupsToCreate = Array.from(neededGroupNames).filter((gn) => !existingGroupNameSet.has(gn));

      const elapsedMs = Date.now() - startTime;

      res.json({
        success: true,
        summary: {
          totalChannels: channels.length,
          modifiedChannelsCount: changes.length,
          nameChangesCount: changes.filter((c) => c.nameChanged).length,
          groupChangesCount: changes.filter((c) => c.groupsChanged).length,
          sourcesUpdatedCount: changes.reduce((sum, c) => sum + c.sourcesUpdatedCount, 0),
          newGroupsToCreate,
          aiProcessedCount: aiMap.size,
          elapsedMs,
          engine: useAi ? "ai_hybrid" : "fast_local"
        },
        changes
      });
    } catch (err: any) {
      console.error("[SmartOrganize Preview Error]", err);
      res.status(500).json({ error: "生成智能整理预览失败: " + err.message });
    }
  });

  app.post("/api/channels/smart-organize/apply", (req, res) => {
    try {
      const { selectedChanges, options = {} } = req.body;
      if (!Array.isArray(selectedChanges) || selectedChanges.length === 0) {
        return res.status(400).json({ error: "请选择要应用的智能整理项目" });
      }

      // 1. Create missing groups
      const existingGroupMap = new Map<string, string>(); // groupName -> groupId
      groups.forEach((g) => existingGroupMap.set(g.name, g.id));

      let createdGroupsCount = 0;
      selectedChanges.forEach((change) => {
        (change.targetGroupNames || []).forEach((gName: string) => {
          if (!existingGroupMap.has(gName)) {
            const newGroupId = "g_" + crypto.randomUUID().slice(0, 8);
            const newGroup = { id: newGroupId, name: gName, sortOrder: groups.length };
            groups.push(newGroup);
            existingGroupMap.set(gName, newGroupId);
            createdGroupsCount++;
            try {
              db.prepare("INSERT OR IGNORE INTO groups (id, name, sortOrder) VALUES (?, ?, ?)").run(
                newGroupId,
                gName,
                newGroup.sortOrder
              );
            } catch (e) {}
          }
        });
      });

      // 2. Apply changes to channels
      let appliedCount = 0;
      const changeMap = new Map<string, any>();
      selectedChanges.forEach((c) => changeMap.set(c.channelId, c));

      channels.forEach((c) => {
        const change = changeMap.get(c.id);
        if (change) {
          if (change.newName) {
            c.name = change.newName;
            try {
              db.prepare("UPDATE carousel_channels SET name = ? WHERE channelId = ?").run(change.newName, c.id);
            } catch (e) {}
          }
          if (change.suggestedLogo && (!c.logo || c.logo.includes("placeholder") || c.logo.includes("default"))) {
            c.logo = change.suggestedLogo;
          }
          if (Array.isArray(change.suggestedAliases) && change.suggestedAliases.length > 0) {
            const currentAliases = Array.isArray(c.alias) ? c.alias : [];
            c.alias = Array.from(new Set([...currentAliases, ...change.suggestedAliases]));
          }
          if (change.suggestedEpgId && (!c.epgId || c.epgId.startsWith("epg_"))) {
            c.epgId = change.suggestedEpgId;
          }
          if (Array.isArray(change.targetGroupNames)) {
            const targetIds = change.targetGroupNames
              .map((gn: string) => existingGroupMap.get(gn))
              .filter(Boolean);
            if (targetIds.length > 0) {
              c.groupIds = targetIds;
            }
          }
          if (Array.isArray(change.proposedSources) && Array.isArray(c.sources)) {
            const srcMap = new Map<string, any>();
            change.proposedSources.forEach((ps: any) => srcMap.set(ps.id, ps));
            c.sources.forEach((s) => {
              const ps = srcMap.get(s.id);
              if (ps) {
                s.isp = ps.newIsp;
                s.province = ps.newProvince;
              }
            });
          }
          appliedCount++;
        }
      });

      if (appliedCount > 0 || createdGroupsCount > 0) {
        saveData();
      }

      res.json({
        success: true,
        message: `智能整理成功！已整理 ${appliedCount} 个频道，新建 ${createdGroupsCount} 个分组。`,
        appliedCount,
        createdGroupsCount
      });
    } catch (err: any) {
      console.error("[SmartOrganize Apply Error]", err);
      res.status(500).json({ error: "应用智能整理失败: " + err.message });
    }
  });

  // Source endpoints
  app.post("/api/channels/:channelId/sources", (req, res) => {
    const { channelId } = req.params;
    const { url, province, isp, resolution } = req.body;

    if (!url) {
      return res.status(400).json({ error: "播放链接为必填项" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    if (channel.sources.some((s) => s.url === url)) {
      return res.status(400).json({ error: "该直播源链接在此频道下已存在，重复添加已自动拦截" });
    }

    const newSource: LiveSource = {
      id: "src_" + Math.random().toString(36).substring(2, 10),
      url,
      province: province || "全国",
      isp: isp || "BGP",
      status: "unknown",
      resolution: resolution || undefined,
    };

    channel.sources.push(newSource);
    detectAndRegisterCarouselProxy(url);
    saveData();
    res.status(201).json(newSource);
  });

  app.put("/api/channels/:channelId/sources/:sourceId", (req, res) => {
    const { channelId, sourceId } = req.params;
    const { url, province, isp, status, resolution } = req.body;

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const source = channel.sources.find((s) => s.id === sourceId);
    if (!source) {
      return res.status(404).json({ error: "未找到直播源" });
    }

    if (url) {
      source.url = url;
      detectAndRegisterCarouselProxy(url);
    }
    if (province) source.province = province;
    if (isp) source.isp = isp;
    if (status) source.status = status;
    if (resolution !== undefined) source.resolution = resolution;

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

  // Batch isolate live sources of a channel
  app.post("/api/channels/:channelId/sources/batch-isolate", (req, res) => {
    const { channelId } = req.params;
    const { sourceIds, isolated } = req.body;
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
        s.isolated = !!isolated;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
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
    const { sourceIds, isp, province, resolution } = req.body;
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
        if (resolution !== undefined && resolution !== null && resolution !== "") {
          s.resolution = resolution;
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
    const { sourceIds, isp, province, status, resolution } = req.body;
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
          if (resolution !== undefined && resolution !== null && resolution !== "") {
            s.resolution = resolution;
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

  // Global batch isolate/restore live sources
  app.post("/api/sources/global-batch-isolate", (req, res) => {
    const { sourceIds, isolated } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要操作的直播线路 ID 列表" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      c.sources.forEach((s) => {
        if (sourceIds.includes(s.id)) {
          s.isolated = !!isolated;
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
  app.post("/api/import/file", async (req, res) => {
    const { content, type, aliasOnly } = req.body;
    if (!content) {
      return res.status(400).json({ error: "文件内容不能为空" });
    }

    try {
      let actualContent = String(content).trim();
      let isRemoteFetched = false;

      // Smart URL detection: if user pasted a single remote URL, automatically fetch it
      if (/^https?:\/\/[^\s]+$/i.test(actualContent) || (actualContent.startsWith("http") && !actualContent.includes("\n"))) {
        let targetUrl = actualContent;
        if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com")) {
          targetUrl = targetUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
        }
        if (githubProxy && (targetUrl.includes("github.com") || targetUrl.includes("githubusercontent.com"))) {
          const proxyPrefix = githubProxy.endsWith("/") ? githubProxy : `${githubProxy}/`;
          targetUrl = `${proxyPrefix}${targetUrl}`;
        }
        console.log(`[/api/import/file] Automatically fetching remote playlist from: ${targetUrl}`);
        const { buffer, isGzipped } = await fetchBufferWithFallback(targetUrl, "IPTV-Manager-Import-Service");
        if (isGzipped) {
          try {
            actualContent = zlib.gunzipSync(buffer).toString("utf-8");
          } catch (e) {
            actualContent = buffer.toString("utf-8");
          }
        } else {
          actualContent = buffer.toString("utf-8");
        }
        isRemoteFetched = true;
      }

      const isM3u = type === "m3u" || actualContent.includes("#EXTM3U");
      let importedChannelsCount = 0;
      let importedSourcesCount = 0;

      const helper = new ChannelImportHelper(channels, groups);

      if (isM3u) {
        const lines = actualContent.split(/\r?\n/);
        let currentInfo: any = null;

        const processFileM3uItem = (info: any, rawUrl?: string) => {
          if (!info || !info.name || info.name === "未知频道") return;

          let url = rawUrl ? rawUrl.split("$")[0].trim() : "";
          const { province, isp } = parseIspAndProvince(info.name + " " + info.category);
          
          let isCarouselM3u = false;
          let carouselKeyM3u = null;
          if (url) {
            const parsedCarouselM3u = parseCarouselUrl(url);
            if (parsedCarouselM3u.platform && parsedCarouselM3u.originalId) {
              isCarouselM3u = true;
              carouselKeyM3u = `@carousel:${parsedCarouselM3u.platform}_${parsedCarouselM3u.originalId}`;
              const registry = db.prepare(`
                SELECT c.channelId, COALESCE(NULLIF(ch.name, ''), NULLIF(c.name, ''), '未知频道') as name 
                FROM carousel_channels c 
                LEFT JOIN channels ch ON c.channelId = ch.id 
                WHERE c.platform = ? AND c.originalId = ?
              `).get(parsedCarouselM3u.platform, parsedCarouselM3u.originalId) as any;
              if (registry) {
                info.name = registry.name;
              }
              detectAndRegisterCarouselProxy(url);
            }
          }

          const catNames = (isCarouselM3u ? ["轮播频道"] : info.category.split(/[,;，；]/)).map((s: string) => s.trim()).filter(Boolean);
          if (catNames.length === 0) catNames.push("手动导入");

          const matchedGroupIds: string[] = [];
          for (const catName of catNames) {
            const gid = helper.resolveGroup(catName, autoCreateChannel);
            if (gid) matchedGroupIds.push(gid);
          }

          const stdInfo = findAliasTemplate(info.name);
          const lookupName = stdInfo ? stdInfo.templateName : info.name;

          let channel = helper.findChannel(lookupName, stdInfo, carouselKeyM3u);

          if (!channel) {
            if (!autoCreateChannel || aliasOnly) {
              return;
            }
            const cleanName = stdInfo ? stdInfo.templateName : info.name;
            let cleanAliases = stdInfo
              ? Array.from(new Set([cleanName, info.name, ...stdInfo.aliases, ...(info.alias || [])]))
              : (info.alias || []);
            if (carouselKeyM3u) cleanAliases.push(carouselKeyM3u);

            channel = {
              id: "ch_" + Math.random().toString(36).substring(2, 10),
              name: cleanName,
              logo: info.logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
              groupIds: matchedGroupIds,
              alias: cleanAliases,
              epgId: info.epgId || generateDefaultEpgId(cleanName),
              sources: [],
            };
            helper.addChannel(channel);
            importedChannelsCount++;
          } else {
            if (stdInfo) {
              channel.name = stdInfo.templateName;
              helper.registerChannelAliases(channel, stdInfo.aliases);
            }
            if (info.alias) {
              helper.registerChannelAliases(channel, info.alias);
            }
            if (autoCreateChannel) {
              matchedGroupIds.forEach(gid => {
                if (!channel!.groupIds.includes(gid)) {
                  channel!.groupIds.push(gid);
                }
              });
            }
            if (info.logo && (!channel!.logo || channel!.logo.includes("unsplash.com"))) {
              channel!.logo = info.logo;
            }
            if (info.epgId) {
              channel!.epgId = info.epgId;
            }
          }

          if (aliasOnly || !url) {
            return;
          }

          const addRes = helper.addSource(channel, url, province, isp);
          if (addRes.added) {
            importedSourcesCount++;
          }
        };

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("#EXTINF:")) {
            if (currentInfo) {
              processFileM3uItem(currentInfo);
              currentInfo = null;
            }
            const logoMatch = line.match(/tvg-logo="([^"]+)"/) || line.match(/logo="([^"]+)"/);
            const groupMatch = line.match(/group-title="([^"]+)"/);
            const epgMatch = line.match(/tvg-id="([^"]+)"/) || line.match(/epg-id="([^"]+)"/);
            const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
            const aliasMatch = line.match(/tvg-alias="([^"]+)"/) || line.match(/alias="([^"]+)"/);
            
            const commaIndex = line.indexOf(",");
            let name = "未知频道";
            if (commaIndex !== -1) {
              name = line.substring(commaIndex + 1).trim();
            }
            name = stripBitrateAndResolution(name);

            if (name.includes("线路") || name.includes("盗源狗")) {
              currentInfo = null;
              continue;
            }

            const nameParts = name.split(/[,;，；:]/).map(s => toSimplifiedChinese(s.trim())).filter(Boolean);
            if (nameParts.length > 0) {
              name = nameParts[0];
            }

            let parsedAliases = [...nameParts];
            if (tvgNameMatch && tvgNameMatch[1]) {
              parsedAliases.push(...tvgNameMatch[1].split(/[,;，；:]/).map(s => toSimplifiedChinese(s.trim())).filter(Boolean));
            }
            if (aliasMatch && aliasMatch[1]) {
              parsedAliases.push(...aliasMatch[1].split(/[,;，；:]/).map(s => toSimplifiedChinese(s.trim())).filter(Boolean));
            }
            parsedAliases = Array.from(new Set(parsedAliases));

            currentInfo = {
              name,
              logo: logoMatch ? logoMatch[1] : "",
              category: toSimplifiedChinese(groupMatch ? groupMatch[1] : "手动导入"),
              alias: parsedAliases,
              epgId: epgMatch ? epgMatch[1] : "",
            };
          } else if (line && !line.startsWith("#") && currentInfo) {
            processFileM3uItem(currentInfo, line);
            currentInfo = null;
          }
        }
        if (currentInfo) {
          processFileM3uItem(currentInfo);
          currentInfo = null;
        }
      } else {
        // Parse TVBox TXT
        const lines = actualContent.split(/\r?\n/);
        let currentCategory = "手动导入";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;

          if (line.includes(",#genre") || line.includes("#genre#")) {
            const commaIdx = line.indexOf(",");
            let cat = commaIdx !== -1 ? line.slice(0, commaIdx).trim() : line.replace(/#genre#?/gi, "").trim();
            currentCategory = toSimplifiedChinese(cat) || "其它频道";
          } else if (line.includes(",") || line.length > 0) {
            const firstComma = line.indexOf(",");
            if (firstComma === -1) continue;

            const nameWithSpecs = line.slice(0, firstComma).trim();
            const rawUrlPart = line.slice(firstComma + 1).trim();

            const urls = rawUrlPart.split('#').map(u => {
              let u2 = u.trim();
              if (u2.includes('$')) u2 = u2.split('$')[0].trim();
              return u2;
            }).filter(Boolean);

            if (urls.length === 0) continue;

            const { province, isp } = parseIspAndProvince(nameWithSpecs + " " + currentCategory);
            let name = nameWithSpecs.split("#")[0].trim();
            name = stripBitrateAndResolution(name);

            if (name.includes("线路") || name.includes("盗源狗") || !name) {
              continue;
            }

            const nameParts = name.split(/[,;，；:]/).map(s => toSimplifiedChinese(s.trim())).filter(Boolean);
            if (nameParts.length > 0) {
              name = nameParts[0];
            }

            let isCarouselTxt = false;
            for (const u of urls) {
               const parsedCarouselTxt = parseCarouselUrl(u);
               if (parsedCarouselTxt.platform && parsedCarouselTxt.originalId) {
                 isCarouselTxt = true;
                 const registry = db.prepare(`
                   SELECT c.channelId, COALESCE(NULLIF(ch.name, ''), NULLIF(c.name, ''), '未知频道') as name 
                   FROM carousel_channels c 
                   LEFT JOIN channels ch ON c.channelId = ch.id 
                   WHERE c.platform = ? AND c.originalId = ?
                 `).get(parsedCarouselTxt.platform, parsedCarouselTxt.originalId) as any;
                 if (registry) {
                   name = registry.name;
                 }
                 detectAndRegisterCarouselProxy(u);
               }
            }
            const catNames = (isCarouselTxt ? ["轮播频道"] : currentCategory.split(/[,;，；]/)).map((s: string) => s.trim()).filter(Boolean);
            if (catNames.length === 0) catNames.push("手动导入");

            const matchedGroupIds: string[] = [];
            for (const catName of catNames) {
              const gid = helper.resolveGroup(catName, autoCreateChannel);
              if (gid) matchedGroupIds.push(gid);
            }

            const stdInfo = findAliasTemplate(name);
            const lookupName = stdInfo ? stdInfo.templateName : name;

            let channel = helper.findChannel(lookupName, stdInfo);

            if (!channel) {
              if (!autoCreateChannel || aliasOnly) {
                continue;
              }
              const cleanName = stdInfo ? stdInfo.templateName : name;
              const cleanAliases = stdInfo 
                ? Array.from(new Set([cleanName, ...nameParts, ...stdInfo.aliases]))
                : Array.from(new Set(nameParts));

              channel = {
                id: "ch_" + Math.random().toString(36).substring(2, 10),
                name: cleanName,
                logo: "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
                groupIds: matchedGroupIds,
                alias: cleanAliases,
                epgId: generateDefaultEpgId(cleanName),
                sources: [],
              };
              helper.addChannel(channel);
              importedChannelsCount++;
            } else {
              if (stdInfo) {
                // FORCE UPDATE channel name to the official alias template name
                channel.name = stdInfo.templateName;
                helper.registerChannelAliases(channel, stdInfo.aliases);
              }
              if (autoCreateChannel) {
                matchedGroupIds.forEach(gid => {
                  if (!channel!.groupIds.includes(gid)) {
                    channel!.groupIds.push(gid);
                  }
                });
              }
              // Add any aliases parsed from the current TXT metadata
              helper.registerChannelAliases(channel, nameParts);
            }

            if (aliasOnly) {
              continue;
            }

            for (const url of urls) {
              const addRes = helper.addSource(channel, url, province, isp);
              if (addRes.added) {
                importedSourcesCount++;
                detectAndRegisterCarouselProxy(url);
              }
            }
          }
        }
      }

      saveData();
      const prefix = isRemoteFetched ? "已自动拉取远程网络资源并" : "";
      res.json({
        success: true,
        message: `${prefix}成功导入 ${importedChannelsCount} 个频道，${importedSourcesCount} 个直播播放源`,
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
          status: item.status || "never",
          message: item.message || "",
          lastSynced: item.lastSynced,
          disabled: !!item.disabled,
          consecutiveFailures: Number(item.consecutiveFailures) || 0,
          contentHash: item.contentHash,
          isp: item.isp ? String(item.isp).trim() : undefined,
          aliasOnly: !!item.aliasOnly
        });
      }

      if (overwrite) {
        setSyncConfigs(importedConfigs);
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
              isp: imported.isp,
              aliasOnly: imported.aliasOnly
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
    const { name, url, type, isp, aliasOnly } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "同步名称和URL为必填项" });
    }

    const newConfig: SyncConfig = {
      id: "sc_" + Math.random().toString(36).substring(2, 10),
      name,
      url,
      type: type || "m3u",
      status: "never",
      isp: isp ? String(isp).trim() : undefined,
      aliasOnly: !!aliasOnly
    };

    syncConfigs.push(newConfig);
    saveData();
    res.status(201).json(newConfig);
  });

  app.put("/api/sync-configs/:id", (req, res) => {
    const { id } = req.params;
    const { name, url, type, isp, disabled, aliasOnly } = req.body;

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
    if (aliasOnly !== undefined) {
      config.aliasOnly = !!aliasOnly;
    }
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
    setSyncConfigs(syncConfigs.filter((c) => c.id !== id));

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

    for (const config of activeConfigs) {
      config.status = "syncing";
      config.message = "正在后台排队批量同步...";
      config.consecutiveFailures = 0;
    }
    saveData();

    // Respond immediately to prevent Reverse Proxy (Nginx/Cloudflare) 504 Gateway Timeout
    res.json({
      success: true,
      message: `已在后台启动 ${activeConfigs.length} 个订阅源的批量同步任务`,
      syncConfigs,
      isBackground: true
    });

    // Execute in background
    setImmediate(async () => {
      let successCount = 0;
      let failCount = 0;
      for (const config of activeConfigs) {
        try {
          config.message = "正在拉取与同步解析中...";
          const ok = await performSync(config, true);
          if (ok) successCount++;
          else failCount++;
        } catch (err: any) {
          console.error(`[BATCH SYNC ERROR] ${config.name}:`, err);
          config.status = "failed";
          config.message = `同步失败: ${err.message || err}`;
          failCount++;
          saveData();
        }
      }
      console.log(`[BATCH SYNC COMPLETE] Success: ${successCount}, Failed: ${failCount}`);
    });
  });

  // Manually Run Sync
  app.post("/api/sync-configs/:id/run", async (req, res) => {
    const { id } = req.params;
    const config = syncConfigs.find((c) => c.id === id);
    if (!config) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    if (config.status === "syncing") {
      return res.json({ success: true, message: "该订阅源当前正在后台同步处理中...", config, isBackground: true });
    }

    config.status = "syncing";
    config.message = "正在后台拉取并同步解析中...";
    config.disabled = false;
    config.consecutiveFailures = 0;
    saveData();

    // Respond immediately to prevent Reverse Proxy (Nginx/Cloudflare) 504 Gateway Timeout
    res.json({ success: true, message: "已在后台启动同步任务，请稍候...", config, isBackground: true });

    // Asynchronously perform sync in background
    setImmediate(async () => {
      try {
        await performSync(config, true);
      } catch (err: any) {
        console.error(`[BACKGROUND SYNC ERROR] ${config.name}:`, err);
        config.status = "failed";
        config.message = `同步失败: ${err.message || err}`;
        saveData();
      }
    });
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
      if (channel.isolated) return;
      if (channelIds && !channelIds.includes(channel.id)) return;
      channel.sources.forEach((source) => {
        if (source.isolated) return;
        // Apply filter constraints if specified
        if (sourceIds && !sourceIds.includes(source.id)) return;
        if (isp && isp !== "all" && source.isp !== isp) return;
        if (province && province !== "all" && source.province !== province) return;
        if (status && status !== "all" && source.status !== status) return;

        // 服务端全网异步多线程测速：保留测速轮播直播源与咪咕代理源，不对普通单网源测速
        const isCarousel = isCarouselSource(source, channel);
        const specificISPs = ["电信", "联通", "移动", "广电", "铁通"];
        if (!isCarousel && source.isp && specificISPs.includes(source.isp)) {
          return;
        }

        targetSources.push({
          id: source.id,
          channelId: channel.id,
          url: source.url,
          lastChecked: source.lastChecked || "",
          testCount: source.testCount || 0,
          status: source.status || "unknown"
        } as any);
      });
    });

    if (targetSources.length === 0) {
      return res.status(400).json({ error: "未选择或未检索到符合过滤条件的直播源进行测试" });
    }

    // 优先测速长时间未测和测试次数最少的直播源
    targetSources.sort((a: any, b: any) => {
      const parseT = (val: any) => (val ? (typeof val === "number" ? val : (isNaN(Date.parse(String(val))) ? 0 : Date.parse(String(val)))) : 0);
      const tA = parseT(a.lastChecked);
      const tB = parseT(b.lastChecked);
      if (tA !== tB) return tA - tB;
      const cA = Number(a.testCount) || 0;
      const cB = Number(b.testCount) || 0;
      if (cA !== cB) return cA - cB;
      return 0;
    });

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

  // Endpoint to fetch test list for client/browser probes, filtered by ISP + BGP/多线/未知, independent of UI filters
  app.get("/api/sources/client-test-list", (req, res) => {
    const clientIsp = ((req.query.isp as string) || "").trim();
    const clientProvince = ((req.query.province as string) || "").trim();
    const onlyActive = req.query.onlyActive === "true";
    const includeCarousel = req.query.includeCarousel === "true";
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 0;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;

    const targetSources: any[] = [];

    channels.forEach((channel) => {
      if (channel.isolated) return;
      if (!channel.sources) return;
      channel.sources.forEach((s) => {
        if (s.isolated) return;

        // 轮播线路靠服务端轮播代理测速，客户端测速自动排除轮播线路
        if (!includeCarousel && isCarouselSource(s, channel)) {
          return;
        }

        if (onlyActive && s.status !== "active" && s.status !== "unknown" && s.status !== "checking") {
          return;
        }

        let isIspMatch = false;
        if (!clientIsp || clientIsp === "all" || clientIsp === "全部") {
          isIspMatch = true;
        } else {
          const sIsp = (s.isp || "").toLowerCase();
          const cIsp = clientIsp.toLowerCase();

          if (!sIsp || sIsp === "未知" || sIsp.includes("bgp") || sIsp.includes("多线") || sIsp.includes("混合") || sIsp.includes("全网")) {
            isIspMatch = true;
          } else if (sIsp.includes(cIsp) || cIsp.includes(sIsp)) {
            isIspMatch = true;
          }
        }

        if (isIspMatch) {
          targetSources.push({
            id: s.id,
            channelId: channel.id,
            channelName: channel.name,
            url: s.url,
            isp: s.isp || "未知",
            province: s.province || "全国",
            status: s.status || "unknown",
            latency: s.latency,
            resolution: s.resolution,
            lastChecked: s.lastChecked || "",
            testCount: s.testCount || 0,
            successCount: s.successCount || 0
          });
        }
      });
    });

    // 智能测速优先排序策略：
    // 1. 优先待测试/极久未测速的直播源（lastChecked 为空或时间戳越小/越久远排在最前面）
    // 2. 优先测试次数少的直播源（testCount 升序）
    // 3. 优先 pending 状态（status 为 unknown / checking 排在 active / inactive 之前）
    // 4. 随机扰动（jitter）：同等优先级的未测/旧测源库中打乱排列，防止多个探针/客户端并发请求时重复获取完全相同的顶端线路
    const parseCheckTime = (val: any): number => {
      if (!val) return 0;
      if (typeof val === "number") return val;
      const t = Date.parse(String(val));
      return isNaN(t) ? 0 : t;
    };

    targetSources.forEach((s) => {
      s._checkTime = parseCheckTime(s.lastChecked);
      s._testCount = Number(s.testCount) || 0;
      s._isPending = (s.status === "unknown" || s.status === "checking") ? 0 : 1;
      s._jitter = Math.random();
    });

    targetSources.sort((a, b) => {
      // 1. 时间最久远的（0 / 从未测速的排在最前）
      if (a._checkTime !== b._checkTime) {
        return a._checkTime - b._checkTime;
      }
      // 2. 测速次数最少的
      if (a._testCount !== b._testCount) {
        return a._testCount - b._testCount;
      }
      // 3. 待检测/未知状态优先
      if (a._isPending !== b._isPending) {
        return a._isPending - b._isPending;
      }
      // 4. 同等优先级打乱，避免多探针重复
      return a._jitter - b._jitter;
    });

    // 清理临时排序辅助属性
    targetSources.forEach((s) => {
      delete s._checkTime;
      delete s._testCount;
      delete s._isPending;
      delete s._jitter;
    });

    const totalCount = targetSources.length;
    let paginatedSources = targetSources;
    
    if (limit > 0) {
      const startIndex = (page - 1) * limit;
      paginatedSources = targetSources.slice(startIndex, startIndex + limit);
    }

    res.json({
      success: true,
      count: paginatedSources.length,
      total: totalCount,
      page: limit > 0 ? page : 1,
      limit: limit > 0 ? limit : totalCount,
      clientIsp: clientIsp || "全部",
      clientProvince: clientProvince || "全国",
      sources: paginatedSources
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
      const { sourceId, channelId, status, latency, resolution } = r;
      if (!sourceId || !status) return;

      channels.forEach((c) => {
        if (channelId && c.id !== channelId) return;
        const src = c.sources.find((s) => s.id === sourceId);
        if (src) {
          // Update test counts
          src.testCount = (src.testCount || 0) + 1;
          if (status === "active") {
            src.successCount = (src.successCount || 0) + 1;
          }

          if (resolution) {
            src.resolution = resolution;
          }

          // Exponential Moving Average for latency to smooth out anomalies
          if (latency !== undefined && latency > 0) {
            if (src.latency && src.latency > 0) {
               src.latency = Math.round(src.latency * 0.7 + latency * 0.3);
            } else {
               src.latency = latency;
            }
          }

          // Smart ISP/Province Discovery:
          // If the source lacks ISP/Province info, and the client had a great connection (<100ms)
          if (status === "active" && latency !== undefined && latency <= 100) {
            if ((!src.isp || src.isp === "未知") && clientIsp) {
              src.isp = clientIsp;
            }
            if ((!src.province || src.province === "未知") && clientProvince) {
              src.province = clientProvince;
            }
          }

          // Decide status based on reliability if we have enough tests
          // E.g., if it failed now, but has > 50% success rate historically, we might keep it active
          // But to be responsive to actual outages, we just use the latest status.
          if (isPrivateOrIntranetUrl(src.url) && status === "inactive") {
            src.status = "active";
          } else {
            src.status = status;
          }
          src.lastChecked = new Date().toISOString();
          
          src.clientIspReported = clientIsp || "宿主";
          src.clientProvinceReported = clientProvince || "本地";
          updatedCount++;
        }
      });
    });

    // Save test report history
    try {
      const reportId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
      const activeCount = results.filter(r => r.status === 'active').length;
      const inactiveCount = results.filter(r => r.status === 'inactive').length;
      
      const stmt = db.prepare(`
        INSERT INTO test_reports (id, createdAt, totalTested, activeCount, inactiveCount, clientIsp, clientProvince, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        reportId,
        new Date().toISOString(),
        results.length,
        activeCount,
        inactiveCount,
        clientIsp || "",
        clientProvince || "",
        JSON.stringify(results)
      );
    } catch (e) {
      console.error("Error saving test report:", e);
    }

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // REST API for test reports

  
  app.get("/api/carousel-discovery-rules", (req, res) => {
    try {
      res.json(getDiscoveryRules(true));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-discovery-rules/preset", (req, res) => {
    try {
      const { mode } = req.body || {};
      const overwrite = mode === "reset";
      const added = seedKnownRules(overwrite);
      const totalRules = getDiscoveryRules(true);
      res.json({
        success: true,
        addedCount: added,
        total: totalRules.length,
        rules: totalRules,
        message: overwrite
          ? `重置并预置已知规则成功！共加载 ${totalRules.length} 条常见平台特征规则。`
          : `已知特征规则增量补充成功！补充新增 ${added} 条规则，当前共 ${totalRules.length} 条规则。`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-discovery-rules", (req, res) => {
    const { platform, keyword, enabled = 1 } = req.body;
    if (!platform || !keyword) return res.status(400).json({ error: "Missing fields" });
    try {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO carousel_discovery_rules (id, platform, keyword, enabled) VALUES (?, ?, ?, ?)').run(
        id,
        platform.trim().toLowerCase(),
        keyword.trim(),
        enabled !== undefined ? (enabled ? 1 : 0) : 1
      );
      invalidateDiscoveryRulesCache();
      res.json({ id, platform: platform.trim().toLowerCase(), keyword: keyword.trim(), enabled: enabled ? 1 : 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-discovery-rules/:id", (req, res) => {
    const { id } = req.params;
    const { platform, keyword, enabled } = req.body;
    try {
      const current = db.prepare('SELECT * FROM carousel_discovery_rules WHERE id = ?').get(id) as any;
      if (!current) {
        return res.status(404).json({ error: "未找到该发现规则" });
      }
      db.prepare(`
        UPDATE carousel_discovery_rules
        SET platform = ?, keyword = ?, enabled = ?
        WHERE id = ?
      `).run(
        platform !== undefined ? platform.trim().toLowerCase() : current.platform,
        keyword !== undefined ? keyword.trim() : current.keyword,
        enabled !== undefined ? (enabled ? 1 : 0) : (current.enabled ?? 1),
        id
      );
      invalidateDiscoveryRulesCache();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-discovery-rules/batch-delete", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "未选择要删除的规则" });
    }
    try {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM carousel_discovery_rules WHERE id IN (${placeholders})`).run(...ids);
      invalidateDiscoveryRulesCache();
      res.json({ success: true, count: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-discovery-rules/:id", (req, res) => {
    try {
      db.prepare('DELETE FROM carousel_discovery_rules WHERE id = ?').run(req.params.id);
      invalidateDiscoveryRulesCache();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Disabled Discovery Rules API (禁用代理发现规则 / 黑名单) ---

  app.get("/api/carousel-disabled-rules", (req, res) => {
    try {
      res.json(getDisabledRules());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules", (req, res) => {
    const { pattern, type = 'contains', platform = '', description = '', enabled = 1 } = req.body;
    if (!pattern || !pattern.trim()) {
      return res.status(400).json({ error: "规则匹配内容为必填项" });
    }
    try {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, pattern.trim(), type || 'contains', platform || '', description || '', enabled !== undefined ? (enabled ? 1 : 0) : 1);
      invalidateDisabledRulesCache();
      cleanupBlockedCarouselProxies();
      res.json({ id, pattern: pattern.trim(), type, platform, description, enabled: enabled ? 1 : 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-disabled-rules/:id", (req, res) => {
    const { id } = req.params;
    const { pattern, type, platform, description, enabled } = req.body;
    try {
      const current = db.prepare('SELECT * FROM carousel_disabled_rules WHERE id = ?').get(id) as any;
      if (!current) {
        return res.status(404).json({ error: "未找到该禁用规则" });
      }
      db.prepare(`
        UPDATE carousel_disabled_rules
        SET pattern = ?, type = ?, platform = ?, description = ?, enabled = ?
        WHERE id = ?
      `).run(
        pattern !== undefined ? pattern.trim() : current.pattern,
        type !== undefined ? type : current.type,
        platform !== undefined ? platform : current.platform,
        description !== undefined ? description : current.description,
        enabled !== undefined ? (enabled ? 1 : 0) : current.enabled,
        id
      );
      invalidateDisabledRulesCache();
      cleanupBlockedCarouselProxies();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-disabled-rules/:id", (req, res) => {
    try {
      db.prepare('DELETE FROM carousel_disabled_rules WHERE id = ?').run(req.params.id);
      invalidateDisabledRulesCache();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules/preset", (req, res) => {
    try {
      const { mode } = req.body || {};
      const overwrite = mode === "reset";
      const added = seedDisabledRules(overwrite);
      const rules = getDisabledRules();
      const purged = cleanupBlockedCarouselProxies();
      res.json({
        success: true,
        addedCount: added,
        purgedCount: purged,
        total: rules.length,
        rules,
        message: overwrite
          ? `重置并预置禁用发现规则成功！共加载 ${rules.length} 条内置忽略规则，并清理了 ${purged} 个违规代理模板。`
          : `内置忽略规则增量补充成功！补充新增 ${added} 条规则，当前共 ${rules.length} 条规则。`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules/batch", (req, res) => {
    const { lines, type = 'contains', platform = '', description = '' } = req.body;
    if (!lines || typeof lines !== 'string') {
      return res.status(400).json({ error: "请提供多行规则文本" });
    }
    try {
      const rawPatterns = lines.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let added = 0;
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled)
        VALUES (?, ?, ?, ?, ?, 1)
      `);
      for (const pat of rawPatterns) {
        const info = stmt.run(crypto.randomUUID(), pat, type || 'contains', platform || '', description || '');
        if (info.changes > 0) added++;
      }
      invalidateDisabledRulesCache();
      const purged = cleanupBlockedCarouselProxies();
      res.json({ success: true, addedCount: added, purgedCount: purged, total: getDisabledRules().length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules/apply-cleanup", (req, res) => {
    try {
      const purged = cleanupBlockedCarouselProxies();
      const remaining = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
      res.json({ success: true, purgedCount: purged, remainingCount: remaining });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Carousel Channels Management API ---

  app.get("/api/carousel-channels", (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT 
          c.id, 
          c.channelId, 
          COALESCE(NULLIF(ch.name, ''), NULLIF(c.name, ''), '未知频道') as name, 
          c.platform, 
          c.originalId,
          (
            SELECT COUNT(*) 
            FROM sources s 
            WHERE s.channelId = c.channelId 
              AND (s.isolated = 0 OR s.isolated IS NULL)
          ) as sourceCount
        FROM carousel_channels c 
        LEFT JOIN channels ch ON c.channelId = ch.id
      `).all();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels", (req, res) => {
    const { name, platform, originalId } = req.body;
    if (!name || !platform || !originalId) return res.status(400).json({ error: "Missing required fields" });
    const id = crypto.randomUUID();
    try {
      let ch = db.prepare('SELECT id FROM channels WHERE id = ?').get(req.body.channelId);
      if (!ch && name) {
        const nid = crypto.randomUUID();
        db.prepare('INSERT INTO channels (id, name, logo, groupIds, alias, epgId) VALUES (?, ?, ?, ?, ?, ?)').run(nid, name, '', '[]', '[]', '');
        req.body.channelId = nid;
      }
      db.prepare('INSERT INTO carousel_channels (id, channelId, name, platform, originalId) VALUES (?, ?, ?, ?, ?)').run(id, req.body.channelId || '', name || '', platform, originalId);
      syncCarouselSources();
      res.json({ id, name, platform, originalId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-channels/:id", (req, res) => {
    const { id } = req.params;
    const { name, platform, originalId } = req.body;
    try {
      db.prepare('UPDATE carousel_channels SET name = ?, channelId = ?, platform = ?, originalId = ? WHERE id = ?').run(name || '', req.body.channelId || '', platform, originalId, id);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-channels/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare('DELETE FROM carousel_channels WHERE id = ?').run(id);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  function getUnregisteredCarouselSources() {
    // Exclude isolated sources and sources belonging to isolated channels
    const allSources = db.prepare(`
      SELECT s.url, c.name as channelName 
      FROM sources s 
      JOIN channels c ON s.channelId = c.id 
      WHERE (s.isolated = 0 OR s.isolated IS NULL) 
        AND (c.isolated = 0 OR c.isolated IS NULL)
    `).all() as any[];
    const existingChannels = db.prepare('SELECT platform, originalId FROM carousel_channels').all() as any[];
    const existingSet = new Set(existingChannels.map((c: any) => `${c.platform}_${c.originalId}`));

    // Also gather from in-memory channels (skipping isolated)
    const inMemorySources: { url: string; channelName: string }[] = [];
    for (const ch of channels) {
      if (ch.isolated) continue;
      if (ch.sources) {
        for (const s of ch.sources) {
          if (s.isolated) continue;
          if (s.url) {
            inMemorySources.push({ url: s.url, channelName: ch.name });
          }
        }
      }
    }
    const combinedSources = allSources.length > 0 ? allSources : inMemorySources;

    const map = new Map();
    for (const row of combinedSources) {
      if (!row.url || isUrlBlockedByDisabledRules(row.url)) continue;
      const parsed = parseCarouselUrl(row.url);
      if (parsed.platform && parsed.originalId) {
        const key = `${parsed.platform}_${parsed.originalId}`;
        if (!existingSet.has(key)) {
          if (!map.has(key)) {
            map.set(key, { platform: parsed.platform, originalId: parsed.originalId, sampleNames: new Set() });
          }
          map.get(key).sampleNames.add(row.channelName);
        }
      }
    }
    return {
      unregistered: Array.from(map.values()).map((v: any) => ({
        ...v,
        sampleNames: Array.from(v.sampleNames)
      })),
      totalSourcesScanned: combinedSources.length
    };
  }

  app.get("/api/carousel-channels-unregistered", (req, res) => {
    try {
      const { unregistered } = getUnregisteredCarouselSources();
      res.json(unregistered);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels-unregistered/rescan", (req, res) => {
    try {
      invalidateDiscoveryRulesCache();
      const newlyDiscoveredProxies = scanAndRegisterAllCarouselProxies();
      const { unregistered, totalSourcesScanned } = getUnregisteredCarouselSources();
      res.json({
        success: true,
        count: unregistered.length,
        unregistered,
        newlyDiscoveredProxies,
        scannedSourcesCount: totalSourcesScanned
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels/batch", (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Invalid payload" });
    try {
      const stmt = db.prepare('INSERT INTO carousel_channels (id, channelId, name, platform, originalId) VALUES (?, ?, ?, ?, ?)');
      const insertMany = db.transaction((itemsToInsert) => {
        for (const item of itemsToInsert) {
           const exists = db.prepare('SELECT id FROM carousel_channels WHERE platform = ? AND originalId = ?').get(item.platform, item.originalId);
           if (!exists) {
             let ch = db.prepare('SELECT id FROM channels WHERE name = ?').get(item.name) as any;
             if (!ch) {
               const nid = crypto.randomUUID();
               db.prepare('INSERT INTO channels (id, name, logo, groupIds, alias, epgId) VALUES (?, ?, ?, ?, ?, ?)').run(nid, item.name, '', '[]', '[]', '');
               ch = { id: nid };
             }
             stmt.run(crypto.randomUUID(), ch.id, item.name, item.platform, item.originalId);
           }
        }
      });
      insertMany(items);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels/batch-delete", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "Invalid payload" });
    try {
      const stmt = db.prepare('DELETE FROM carousel_channels WHERE id = ?');
      const deleteMany = db.transaction((idsToDelete) => {
        for (const id of idsToDelete) stmt.run(id);
      });
      deleteMany(ids);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels-apply", (req, res) => {
    try {
      // 1. Scan and register any proxy templates discovered in current sources if any
      try {
        scanAndRegisterAllCarouselProxies();
      } catch (e) {}

      // 2. Perform carousel sources synchronization
      const stats = syncCarouselSources();

      const registriesCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_channels').get() as any).count;
      const proxiesCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
      const activeProxiesCount = (db.prepare("SELECT COUNT(*) as count FROM carousel_proxies WHERE status = 'active'").get() as any).count;

      let message = "";
      if (stats.createdCount > 0 || stats.removedCount > 0 || stats.updatedCount > 0) {
        let parts: string[] = [];
        if (stats.removedCount > 0) {
          parts.push(`清理移除 ${stats.removedCount} 条失效/隔离源`);
        }
        if (stats.createdCount > 0) {
          parts.push(`新增 ${stats.createdCount} 个直播源`);
        }
        if (stats.updatedCount > 0) {
          parts.push(`归类 ${stats.updatedCount} 条线路`);
        }
        const summaryText = parts.length > 0 ? parts.join("，") : "同步完成";
        message = `已重新生成轮播直播源（${summaryText}），当前共 ${stats.totalCount} 个有效轮播源，覆盖 ${stats.channelsCount} 个频道！`;
      } else if (stats.totalCount > 0) {
        message = `所有 ${stats.channelsCount} 个轮播频道的直播源（共 ${stats.totalCount} 条线路）均已处于最新同步状态。`;
      } else if (activeProxiesCount === 0) {
        message = `已同步 ${registriesCount} 个频道映射，但系统当前没有启用的轮播代理模板（可用代理: 0/${proxiesCount}）。请先前往【轮播代理】配置并启用可用代理，或点击【从现有源自动提取】！`;
      } else if (registriesCount === 0) {
        message = `当前映射列表为空，请先在【未识别项发现】中添加频道映射或手动添加映射！`;
      } else {
        message = `已同步 ${registriesCount} 个频道映射，未匹配到对应平台的可用代理模板。`;
      }

      res.json({
        success: true,
        createdSourcesCount: stats.createdCount,
        updatedCount: stats.updatedCount,
        removedSourcesCount: stats.removedCount,
        totalSourcesCount: stats.totalCount,
        channelsCount: stats.channelsCount,
        activeProxiesCount,
        totalProxiesCount: proxiesCount,
        registriesCount,
        message
      });
    } catch (e: any) {
      console.error("[carousel-channels-apply error]", e);
      res.status(500).json({ error: e.message || "应用生成频道源失败" });
    }
  });

  // --- Carousel Proxy Management API ---
  
  app.get("/api/carousel-proxies", (req, res) => {
    try {
      const proxies = db.prepare('SELECT * FROM carousel_proxies').all() as any[];
      const enabledRules = getDiscoveryRules(false);
      const enabledPlatforms = new Set(enabledRules.map((r: any) => (r.platform || '').toLowerCase()));
      const hasDiscoveryRules = (db.prepare('SELECT COUNT(*) as count FROM carousel_discovery_rules').get() as any).count > 0;

      const annotated = proxies.map((p: any) => {
        const plat = (p.platform || '').toLowerCase();
        let isBlocked = isUrlBlockedByDisabledRules(p.urlTemplate, p.platform);
        let blockedReason = isBlocked ? "命中禁用发现规则 (黑名单)" : "";

        if (!isBlocked && hasDiscoveryRules && !enabledPlatforms.has(plat)) {
          isBlocked = true;
          blockedReason = `所属平台 [${plat.toUpperCase()}] 特征发现规则已停用`;
        }

        return {
          ...p,
          isBlocked: Boolean(isBlocked),
          blockedReason
        };
      });

      res.json(annotated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-proxies/scan-sources", (req, res) => {
    try {
      cleanupBlockedCarouselProxies();
      try {
        db.prepare('DELETE FROM deleted_carousel_proxies').run();
      } catch (e) {}

      let added = 0;
      // Scan sources in memory (ignoring isolated channels and sources)
      for (const ch of channels) {
        if (ch.isolated) continue;
        if (ch && ch.sources) {
          for (const s of ch.sources) {
            if (s.isolated) continue;
            if (s && s.url && !isUrlBlockedByDisabledRules(s.url)) {
              const beforeCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
              detectAndRegisterCarouselProxy(s.url, true);
              const afterCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
              if (afterCount > beforeCount) {
                added += (afterCount - beforeCount);
              }
            }
          }
        }
      }
      // Scan sources in SQLite if any (ignoring isolated sources and channels)
      const sqlAdded = scanAndRegisterAllCarouselProxies(true);
      added += sqlAdded;

      const proxies = db.prepare('SELECT * FROM carousel_proxies').all();
      res.json({ success: true, count: added, total: proxies.length, proxies });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-proxies", (req, res) => {
    const { platform, urlTemplate, status = 'active' } = req.body;
    if (!platform || !urlTemplate) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const id = crypto.randomUUID();
    try {
      // If previously marked as deleted, unmark it
      try {
        db.prepare('DELETE FROM deleted_carousel_proxies WHERE urlTemplate = ?').run(urlTemplate);
      } catch (e) {}

      db.prepare('INSERT INTO carousel_proxies (id, platform, urlTemplate, status) VALUES (?, ?, ?, ?)').run(id, platform, urlTemplate, status);
      if (status === 'active') {
        syncCarouselSources();
      }
      res.json({ id, platform, urlTemplate, status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-proxies/:id", async (req, res) => {
    const { id } = req.params;
    const { platform, urlTemplate, status, test } = req.body;
    try {
      const existing = db.prepare('SELECT * FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: "未找到该代理" });
      }

      const nextPlatform = platform || existing.platform;
      const nextUrl = urlTemplate || existing.urlTemplate;
      const nextStatus = status !== undefined ? status : existing.status;

      if (nextUrl) {
        try {
          db.prepare('DELETE FROM deleted_carousel_proxies WHERE urlTemplate = ?').run(nextUrl);
        } catch (e) {}
      }

      // If enabling or restoring (status === 'active')
      if (nextStatus === 'active') {
        if (test !== false) {
          const testRes = await testCarouselProxyAvailability({ platform: nextPlatform, urlTemplate: nextUrl });
          if (!testRes.available) {
            db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'inactive', id);
            removeSourcesForProxyTemplates([existing, { platform: nextPlatform, urlTemplate: nextUrl }]);
            syncCarouselSources();
            return res.json({
              success: false,
              available: false,
              status: 'inactive',
              error: `代理测试不可用: ${testRes.error || '连接失败'}，未恢复直播源`
            });
          }

          db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'active', id);
          syncCarouselSources();
          return res.json({
            success: true,
            available: true,
            status: 'active',
            latency: testRes.latency,
            message: `代理测试可用 (${testRes.latency}ms)，已恢复并同步添加直播源`
          });
        } else {
          db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'active', id);
          syncCarouselSources();
          return res.json({ success: true, status: 'active', message: '已强制启用并添加对应直播源' });
        }
      } else {
        // Disabling proxy ('inactive' or 'disabled')
        db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'inactive', id);
        removeSourcesForProxyTemplates([existing, { platform: nextPlatform, urlTemplate: nextUrl }]);
        syncCarouselSources();
        return res.json({ success: true, status: 'inactive', message: '代理已禁用，对应直播源已移除' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Single proxy toggle status
  app.post("/api/carousel-proxies/:id/toggle-status", async (req, res) => {
    const { id } = req.params;
    const { status, test = true } = req.body;
    try {
      const proxy = db.prepare('SELECT * FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (!proxy) return res.status(404).json({ error: "代理不存在" });

      const targetStatus = status || (proxy.status === 'active' ? 'inactive' : 'active');

      if (targetStatus === 'active') {
        if (test !== false) {
          const testRes = await testCarouselProxyAvailability(proxy);
          if (!testRes.available) {
            db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', id);
            removeSourcesForProxyTemplates([proxy]);
            syncCarouselSources();
            return res.json({
              success: false,
              available: false,
              status: 'inactive',
              error: `代理测试不可用: ${testRes.error || '连接失败'}，未恢复直播源`
            });
          }

          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', id);
          syncCarouselSources();
          return res.json({
            success: true,
            available: true,
            status: 'active',
            latency: testRes.latency,
            message: `代理测试可用 (${testRes.latency}ms)，已恢复启用并添加对应直播源`
          });
        } else {
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', id);
          syncCarouselSources();
          return res.json({ success: true, status: 'active', message: '已启用代理并添加对应直播源' });
        }
      } else {
        // Disabling
        db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', id);
        removeSourcesForProxyTemplates([proxy]);
        syncCarouselSources();
        return res.json({ success: true, status: 'inactive', message: '代理已禁用，对应直播源已移除' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Single proxy test availability
  app.post("/api/carousel-proxies/:id/test", async (req, res) => {
    const { id } = req.params;
    try {
      const proxy = db.prepare('SELECT * FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (!proxy) return res.status(404).json({ error: "代理不存在" });

      const testRes = await testCarouselProxyAvailability(proxy);
      if (testRes.available) {
        db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', id);
        syncCarouselSources();
      } else {
        db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', id);
        removeSourcesForProxyTemplates([proxy]);
        syncCarouselSources();
      }
      res.json({
        success: true,
        ...testRes,
        status: testRes.available ? 'active' : 'inactive'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Batch toggle status (Batch Enable / Batch Disable)
  app.post("/api/carousel-proxies/batch-status", async (req, res) => {
    const { ids, status, test = true } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Missing ids array" });
    }
    if (status !== 'active' && status !== 'inactive' && status !== 'disabled') {
      return res.status(400).json({ error: "Invalid status value" });
    }

    try {
      const placeholders = ids.map(() => '?').join(',');
      const proxies = db.prepare(`SELECT * FROM carousel_proxies WHERE id IN (${placeholders})`).all(...ids) as any[];

      if (status === 'inactive' || status === 'disabled') {
        // Batch disable: set status to inactive and remove corresponding live sources
        db.prepare(`UPDATE carousel_proxies SET status = 'inactive' WHERE id IN (${placeholders})`).run(...ids);
        removeSourcesForProxyTemplates(proxies);
        syncCarouselSources();
        return res.json({
          success: true,
          status: 'inactive',
          count: proxies.length,
          message: `已批量禁用 ${proxies.length} 个代理，对应直播源已全部移除`
        });
      }

      // Batch enable (restore): test availability for each unless test === false
      if (test === false) {
        db.prepare(`UPDATE carousel_proxies SET status = 'active' WHERE id IN (${placeholders})`).run(...ids);
        syncCarouselSources();
        return res.json({
          success: true,
          status: 'active',
          activatedCount: proxies.length,
          failedCount: 0,
          message: `已强制启用选中的 ${proxies.length} 个代理并添加直播源`
        });
      }

      const results: any[] = [];
      let activatedCount = 0;
      let failedCount = 0;

      await Promise.all(proxies.map(async (proxy) => {
        const testRes = await testCarouselProxyAvailability(proxy);
        if (testRes.available) {
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', proxy.id);
          activatedCount++;
          results.push({ id: proxy.id, platform: proxy.platform, available: true, latency: testRes.latency });
        } else {
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', proxy.id);
          failedCount++;
          results.push({ id: proxy.id, platform: proxy.platform, available: false, error: testRes.error });
        }
      }));

      // Sync sources (will add for active and remove for inactive)
      syncCarouselSources();

      return res.json({
        success: true,
        activatedCount,
        failedCount,
        total: proxies.length,
        results,
        message: activatedCount > 0
          ? `恢复测试完成: ${activatedCount} 个代理可用已恢复并添加直播源` + (failedCount > 0 ? ` (${failedCount} 个不可用保持禁用)` : '')
          : `选中的 ${failedCount} 个代理测试均不可用，已保持禁用且未添加直播源`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-proxies/:id", (req, res) => {
    const { id } = req.params;
    try {
      const proxy = db.prepare('SELECT id, platform, urlTemplate FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (proxy && proxy.urlTemplate) {
        try {
          db.prepare('INSERT OR REPLACE INTO deleted_carousel_proxies (urlTemplate, deletedAt) VALUES (?, ?)').run(
            proxy.urlTemplate,
            new Date().toISOString()
          );
        } catch (e) {}
        // Remove all corresponding live stream sources
        removeSourcesForProxyTemplates([proxy]);
      }
      db.prepare('DELETE FROM carousel_proxies WHERE id = ?').run(id);
      syncCarouselSources();
      res.json({ success: true, message: "代理已删除，对应直播源已移除" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-proxies/batch-delete", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Missing ids array" });
    }
    try {
      const placeholders = ids.map(() => '?').join(',');
      const proxies = db.prepare(`SELECT id, platform, urlTemplate FROM carousel_proxies WHERE id IN (${placeholders})`).all(...ids) as any[];
      const nowStr = new Date().toISOString();
      const insertDeleted = db.prepare('INSERT OR REPLACE INTO deleted_carousel_proxies (urlTemplate, deletedAt) VALUES (?, ?)');
      const deleteStmt = db.prepare('DELETE FROM carousel_proxies WHERE id = ?');
      
      const tx = db.transaction((idList: string[]) => {
        for (const id of idList) {
          const proxy = proxies.find(p => p.id === id);
          if (proxy && proxy.urlTemplate) {
            try {
              insertDeleted.run(proxy.urlTemplate, nowStr);
            } catch (e) {}
          }
          deleteStmt.run(id);
        }
      });
      tx(ids);

      // Remove all corresponding live stream sources
      removeSourcesForProxyTemplates(proxies);
      syncCarouselSources();

      res.json({ success: true, count: ids.length, message: `已批量删除 ${ids.length} 个代理，对应直播源已移除` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  
  app.post("/api/carousel/test-all", async (req, res) => {
    try {
      const proxies = db.prepare('SELECT * FROM carousel_proxies').all() as any[];
      if (proxies.length === 0) {
        return res.json({ success: true, count: 0, results: [] });
      }
      
      const results: any[] = [];
      const fetchPromises = proxies.map(async (proxy) => {
        const testRes = await testCarouselProxyAvailability(proxy);
        if (testRes.available) {
          results.push({ templateId: proxy.id, platform: proxy.platform, url: proxy.urlTemplate, status: 'active', latency: testRes.latency });
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', proxy.id);
        } else {
          results.push({ templateId: proxy.id, platform: proxy.platform, url: proxy.urlTemplate, status: 'inactive', latency: null, error: testRes.error });
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', proxy.id);
        }
      });
      
      await Promise.all(fetchPromises);
      syncCarouselSources();
      res.json({ success: true, count: proxies.length, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Test carousel proxies for a specific channel
  app.post("/api/carousel/test", async (req, res) => {
    const { channelId, platform, originalId } = req.body;
    if (!channelId || !platform || !originalId) {
       return res.status(400).json({ error: "Missing required fields" });
    }
    
    try {
      // 1. Get ALL templates for this platform
      const templates = db.prepare('SELECT * FROM carousel_proxies WHERE platform = ?').all(platform) as any[];
      if (templates.length === 0) {
         return res.json({ success: true, count: 0, tested: 0, results: [] });
      }
      
      // 2. Generate URLs
      const urlsToTest = templates.map(t => ({
         templateId: t.id,
         url: t.urlTemplate.replace('{}', originalId)
      }));
      
      // 3. Test URLs
      const results = [];
      const fetchPromises = urlsToTest.map(async (item) => {
         try {
           const controller = new AbortController();
           const timeoutId = setTimeout(() => controller.abort(), 5000);
           const start = Date.now();
           const response = await fetch(item.url, { 
             method: 'GET',
             signal: controller.signal,
             headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
             }
           });
           clearTimeout(timeoutId);
           const latency = Date.now() - start;
           
           if (response.ok) {
              const text = await response.text().catch(() => "");
              const contentCheck = isResponseContentInvalid(text, response.headers.get("content-type") || "");
              if (contentCheck.invalid) {
                results.push({ ...item, status: 'inactive', latency: null, error: contentCheck.reason });
                db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', item.templateId);
              } else {
                results.push({ ...item, status: 'active', latency });
                db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', item.templateId);
              }
           } else {
              results.push({ ...item, status: 'inactive', latency: null });
              db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', item.templateId);
           }
         } catch (e) {
            results.push({ ...item, status: 'inactive', latency: null });
         }
      });
      
      await Promise.allSettled(fetchPromises);
      
      // 4. Save active results as new sources for the channel
      const activeResults = results.filter(r => r.status === 'active');
      const now = new Date().toISOString();
      const insertStmt = db.prepare('INSERT INTO sources (id, channelId, url, status, latency, lastChecked) VALUES (?, ?, ?, ?, ?, ?)');
      
      const insertMany = db.transaction((activeRes) => {
         for (const res of activeRes) {
            // Check if exists
            const exists = db.prepare('SELECT id FROM sources WHERE channelId = ? AND url = ?').get(channelId, res.url);
            if (!exists) {
               insertStmt.run(crypto.randomUUID(), channelId, res.url, 'active', res.latency, now);
            }
         }
      });
      
      insertMany(activeResults);
      
      res.json({ success: true, count: activeResults.length, tested: templates.length, results });
    } catch (e) {
      console.error('Carousel test error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/test-reports", (req, res) => {
    try {
      const reports = db.prepare("SELECT id, createdAt, totalTested, activeCount, inactiveCount, clientIsp, clientProvince FROM test_reports ORDER BY createdAt DESC LIMIT 50").all();
      res.json(reports);
    } catch (e) {
      console.error(e);
      res.json([]);
    }
  });

  app.get("/api/test-reports/:id", (req, res) => {
    try {
      const report = db.prepare("SELECT * FROM test_reports WHERE id = ?").get(req.params.id) as any;
      if (report) {
        report.details = JSON.parse(report.details);
        res.json(report);
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/test-reports/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM test_reports WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Client API Access Statistics Endpoints
  app.get("/api/stats/client-access", (req, res) => {
    try {
      const endpointFilter = (req.query.endpoint as string || "").trim();
      const searchFilter = (req.query.search as string || "").trim();
      const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string), 500) : 100;

      let whereClause = "WHERE 1=1";
      const params: any[] = [];

      if (endpointFilter && endpointFilter !== "all") {
        whereClause += " AND endpoint = ?";
        params.push(endpointFilter);
      }

      if (searchFilter) {
        whereClause += " AND (clientIp LIKE ? OR userAgent LIKE ? OR clientApp LIKE ? OR province LIKE ? OR isp LIKE ?)";
        const term = `%${searchFilter}%`;
        params.push(term, term, term, term, term);
      }

      // 1. Overview counts
      const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM client_access_logs ${whereClause}`).get(...params) as { cnt: number };
      const todayRow = db.prepare(`SELECT COUNT(*) as cnt FROM client_access_logs ${whereClause} AND accessTime >= date('now', 'localtime')`).get(...params) as { cnt: number };
      const last24hRow = db.prepare(`SELECT COUNT(*) as cnt FROM client_access_logs ${whereClause} AND accessTime >= datetime('now', '-24 hours', 'localtime')`).get(...params) as { cnt: number };
      const uniqueIpsTotalRow = db.prepare(`SELECT COUNT(DISTINCT clientIp) as cnt FROM client_access_logs ${whereClause}`).get(...params) as { cnt: number };
      const uniqueIpsTodayRow = db.prepare(`SELECT COUNT(DISTINCT clientIp) as cnt FROM client_access_logs ${whereClause} AND accessTime >= date('now', 'localtime')`).get(...params) as { cnt: number };

      // 2. Breakdown by Endpoint
      const endpointRows = db.prepare(`
        SELECT endpoint, COUNT(*) as total, 
               SUM(CASE WHEN accessTime >= date('now', 'localtime') THEN 1 ELSE 0 END) as today
        FROM client_access_logs
        GROUP BY endpoint
        ORDER BY total DESC
      `).all() as any[];

      // 3. Breakdown by Client App
      const appRows = db.prepare(`
        SELECT clientApp, COUNT(*) as total,
               SUM(CASE WHEN accessTime >= date('now', 'localtime') THEN 1 ELSE 0 END) as today
        FROM client_access_logs
        GROUP BY clientApp
        ORDER BY total DESC
        LIMIT 12
      `).all() as any[];

      // 4. Breakdown by Location / ISP
      const locationRows = db.prepare(`
        SELECT province, isp, COUNT(*) as total
        FROM client_access_logs
        WHERE province != '' OR isp != ''
        GROUP BY province, isp
        ORDER BY total DESC
        LIMIT 12
      `).all() as any[];

      // 5. Hourly Trend (Past 24 Hours)
      const hourlyRows = db.prepare(`
        SELECT strftime('%H:00', accessTime) as hourSlot, COUNT(*) as cnt
        FROM client_access_logs
        WHERE accessTime >= datetime('now', '-24 hours', 'localtime')
        GROUP BY hourSlot
        ORDER BY hourSlot ASC
      `).all() as any[];

      // 6. Recent Logs
      const logs = db.prepare(`
        SELECT id, endpoint, endpointPath, clientIp, province, isp, userAgent, clientApp, queryParams, statusCode, responseBytes, accessTime
        FROM client_access_logs
        ${whereClause}
        ORDER BY accessTime DESC
        LIMIT ?
      `).all(...params, limit) as any[];

      res.json({
        overview: {
          totalRequests: totalRow?.cnt || 0,
          todayRequests: todayRow?.cnt || 0,
          last24hRequests: last24hRow?.cnt || 0,
          uniqueIpsTotal: uniqueIpsTotalRow?.cnt || 0,
          uniqueIpsToday: uniqueIpsTodayRow?.cnt || 0
        },
        byEndpoint: endpointRows,
        byClientApp: appRows,
        byLocation: locationRows,
        hourlyTrend: hourlyRows,
        recentLogs: logs
      });
    } catch (err: any) {
      console.error("[GET CLIENT ACCESS STATS ERROR]", err);
      res.status(500).json({ error: "获取客户端访问统计失败: " + (err.message || err) });
    }
  });

  app.post("/api/stats/client-access/clear", (req, res) => {
    try {
      db.prepare(`DELETE FROM client_access_logs`).run();
      res.json({ success: true, message: "所有客户端访问日志已成功清空" });
    } catch (err: any) {
      res.status(500).json({ error: "清空访问日志失败: " + (err.message || err) });
    }
  });

  app.get("/api/sources/test-status", (req, res) => {
    res.json({ ...testStatus, lastDataUpdate: globalLastDataUpdate });
  });

  // Detect client IP information (ISP and Province) with robust multi-source fallbacks
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

      // 1. If it's a valid public IP, try getClientIpGeo first
      if (detectedIp && detectedIp !== "127.0.0.1") {
        try {
          const geo = await getClientIpGeo(detectedIp);
          if (geo && (geo.province || geo.isp)) {
            return res.json({
              ip: detectedIp,
              province: geo.province || "北京",
              isp: geo.isp || "电信"
            });
          }
        } catch (e) {
          // ignore
        }
      }

      // 2. Try external services with safe text/json parsing (pconline, ip-api, bilibili, cip.cc)
      const queryIp = detectedIp === "127.0.0.1" ? "" : detectedIp;
      
      // Try pconline (stable in CN, no strict rate limit)
      try {
        const pcRes = await fetch(`https://whois.pconline.com.cn/ipJson.jsp?ip=${queryIp}&json=true`, {
          signal: AbortSignal.timeout(3000)
        });
        if (pcRes.ok) {
          const rawBuffer = await pcRes.arrayBuffer();
          let rawText = "";
          try {
            rawText = new TextDecoder("gbk").decode(rawBuffer);
          } catch {
            rawText = new TextDecoder("utf-8").decode(rawBuffer);
          }
          if (rawText && rawText.includes("{")) {
            const data = JSON.parse(rawText.trim());
            if (data && data.ip) detectedIp = data.ip;
            if (data && data.pro) {
              province = data.pro.replace(/(省|市|特别行政区|自治区|壮族自治区|回族自治区|维吾尔自治区|盟)/g, "");
            }
            const addr = (data.addr || "").toLowerCase();
            if (addr.includes("电信")) isp = "电信";
            else if (addr.includes("联通")) isp = "联通";
            else if (addr.includes("移动")) isp = "移动";
            else if (addr.includes("广电")) isp = "广电";
            else if (addr.includes("铁通")) isp = "铁通";
            return res.json({ ip: detectedIp, province, isp });
          }
        }
      } catch (e) {
        // continue to next provider
      }

      // Try ip-api.com safely (checking content-type / rate limits)
      try {
        const url = `http://ip-api.com/json/${queryIp}?lang=zh-CN`;
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const rawText = await response.text();
        if (rawText && !rawText.includes("Rate exceeded") && rawText.trim().startsWith("{")) {
          const data = JSON.parse(rawText);
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
              if (rawIsp.includes("china mobile")) isp = "移动";
              else if (rawIsp.includes("china unicom")) isp = "联通";
              else if (rawIsp.includes("china telecom")) isp = "电信";
              else isp = "其它";
            }
            return res.json({ ip: detectedIp, province, isp });
          }
        }
      } catch (e) {
        // continue to fallback
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
    
    let epgTotalChannels = 0;
    const uniqueIds = new Set<string>();
    for (const src of activeEpgSrcs) {
      const cache = getEpgCache(src.id);
      if (cache && cache.raw) {
        Object.keys(cache.raw).forEach(k => uniqueIds.add(k));
      }
    }
    epgTotalChannels = uniqueIds.size;

    const mappedChannels: any[] = [];
    const unmappedChannels: any[] = [];

    for (const ch of channels) {
      let matchedEntry: EpgEntry | null = null;
      let matchedSourceName = "";
      let matchedOriginalId = "";

      for (const src of activeEpgSrcs) {
        const cache = getEpgCache(src.id);
        if (cache) {
          const entry = findMatchingEpgEntry(ch, cache);
          if (entry) {
            matchedEntry = entry;
            matchedSourceName = src.name;
            // Find the original XML id for this entry
            for (const [key, val] of Object.entries(cache.raw)) {
              if (val === entry) {
                matchedOriginalId = key;
                break;
              }
            }
            break;
          }
        }
      }

      if (matchedEntry) {
        mappedChannels.push({
          id: ch.id,
          name: ch.name,
          epgId: ch.epgId,
          matchedId: matchedOriginalId,
          matchedName: matchedEntry.displayNames[0] || matchedOriginalId,
          sourceName: matchedSourceName
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

    const getEpgForChannelAndDate = (ch: Channel) => {
      const activeEpgSrcs = epgSources.filter(s => s.active);
      let bestPrograms: any[] = [];
      for (const src of activeEpgSrcs) {
        const cache = getEpgCache(src.id);
        if (cache) {
          const entry = findMatchingEpgEntry(ch, cache);
          if (entry && entry.programs && entry.programs.length > 0) {
            const filtered = entry.programs.filter((p: any) => {
              if (isEpgDisclaimerProgram(p.title, p.desc)) return false;
              const parsed = parseXmltvTime(p.start);
              return parsed.dateStr === targetDate;
            }).map((p: any) => {
              const parsed = parseXmltvTime(p.start);
              return {
                time: parsed.timeStr,
                title: p.title
              };
            });
            if (filtered.length > bestPrograms.length) {
              filtered.sort((a: any, b: any) => a.time.localeCompare(b.time));
              bestPrograms = filtered;
            }
          }
        }
      }
      if (bestPrograms.length > 0) {
        return bestPrograms;
      }
      return [];
    };

    if (channelId) {
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        return res.json({
          channelId,
          channelName: channel.name,
          date: targetDate,
          epgId: channel.epgId,
          isSimulated: false,
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
          for (const [epgId, entry] of Object.entries(cache.raw)) {
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

          // Prevent numerical mismatch (e.g. CCTV13 matching CCTV1)
          const targetDigits = normTarget.match(/\d+/g)?.join("") || "";
          const textDigits = normText.match(/\d+/g)?.join("") || "";
          if (targetDigits && textDigits && targetDigits !== textDigits) {
            return 0;
          }

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

      // 3. Try configured AI model (SiliconFlow / GLM / DeepSeek / Gemini / etc.)
      const aiCfg = getAiConfig();
      const meta = await suggestChannelMetadata(targetName, "", []);

      // If top candidate matches scored list, incorporate
      const recs: any[] = [];
      if (meta && meta.epgId) {
        recs.push({
          epgId: meta.epgId,
          displayName: meta.standardName,
          reason: meta.reason || "智能大模型/权威库匹配",
          confidence: meta.confidence || 0.95
        });
      }

      // Add scored candidates
      for (const cand of scoredList) {
        if (!recs.some(r => r.epgId === cand.epgId)) {
          recs.push({
            epgId: cand.epgId,
            displayName: (cand.displayNames && cand.displayNames[0]) || cand.epgId,
            reason: `来源 EPG 源 [${cand.sourceName}] 候选匹配`,
            confidence: 0.85
          });
        }
        if (recs.length >= 5) break;
      }

      res.json({ success: true, channelName: targetName, recommendations: recs });
    } catch (err: any) {
      console.error("[EPG AI RECOMMEND ERROR]", err.message || err);
      res.status(500).json({ error: err.message || "智能匹配推荐失败" });
    }
  });

  // CUSTOM EXPORTS/PLAYBACK API INTERFACE
  // Third-party players consume this!
  // Example usage: http://localhost:3000/api/export/m3u?isp=电信&status=active
  // Example usage: http://localhost:3000/api/export/txt?province=北京
  app.get("/api/export/m3u", async (req, res) => {
    const { category, isp, province, status, limit, maxPerChannel: queryMaxPerChannel, ip, clientIp, v } = req.query;

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

    const finalIsp = isp ? String(isp) : targetIsp;
    const finalProvince = province ? String(province) : targetProvince;

    const cacheParams = {
      format: "m3u" as const,
      category: category ? String(category) : undefined,
      isp: finalIsp || undefined,
      province: finalProvince || undefined,
      status: status ? String(status) : undefined,
      limit: limit ? String(limit) : undefined,
      maxPerChannel: queryMaxPerChannel ? String(queryMaxPerChannel) : undefined,
      baseUrl,
      v: m3uLogoVersion || undefined
    };

    const { content, etag } = getOrGeneratePlaylistExport(cacheParams, () => {
      const { formattedTime, versionId } = getBuildVersionInfo();
      let playlistRows = [
        `#EXTM3U x-tvg-url="${baseUrl}/api/export/epg.xml.gz" build-version="${versionId}"`,
        `# Playlist Version: v${versionId}`,
        `# Generated At: ${formattedTime}`
      ];
      let count = 0;
      const maxLimit = limit ? Number(limit) : Infinity;
      const maxPerChannel = queryMaxPerChannel ? Number(queryMaxPerChannel) : 15;
      const versionString = m3uLogoVersion || "";

      const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
      orderedGroups.forEach((group) => {
        if (group.isolated) return;
        channels.forEach((channel) => {
          if (channel.isolated) return;
          const isInGroup = channel.groupIds.includes(group.id);
          const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
          if (!isInGroup && !isFallback) return;
          const gId = group.id;
          const groupName = group.name;

          // Filter group level if specific category selected
          if (category && groupName !== String(category) && gId !== String(category)) return;

          let processedSources = channel.sources;

          processedSources = getPlayableSources(processedSources, finalIsp, finalProvince);

          if (province) {
            processedSources = processedSources.filter(source => source.province === String(province));
          }

          // Default: exclude inactive and unknown/checking sources if status is not explicitly asked for
          if (!status) {
            processedSources = processedSources.filter(source => source.status === "active");
          } else if (status) {
            processedSources = processedSources.filter(source => source.status === String(status));
          }

          // Prioritize active, RTSP protocol, and lowest latency
          processedSources = sortSourcesForExport(processedSources);

          // 限制每个频道最大输出数量 (Limit max sources per channel)
          const sourcesToExport = processedSources.slice(0, maxPerChannel);
          sourcesToExport.forEach(bestSource => {
            if (count >= maxLimit) return;

            const channelDisplayName = channel.name;
            let logoUrl = resolveChannelLogo(channel.logo || "");
            if (logoUrl && versionString) {
              logoUrl += (logoUrl.includes("?") ? "&v=" : "?v=") + versionString;
            }
            
            playlistRows.push(
              `#EXTINF:-1 tvg-id="${channel.epgId}" tvg-name="${channel.name}" tvg-logo="${logoUrl}" group-title="${groupName}",${channelDisplayName}`
            );
            playlistRows.push(bestSource.url);
            count++;
          });
        });
      });
      return playlistRows.join("\n");
    });

    if (req.headers["if-none-match"] === etag) {
      recordClientAccess(req, "m3u", "/api/export/m3u", 304, {
        province: finalProvince,
        isp: finalIsp
      });
      return res.status(304).end();
    }

    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="iptv_custom.m3u"');
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("ETag", etag);
    res.setHeader("X-Client-IP", resolvedClientIp || "");
    res.setHeader("X-Client-ISP", encodeURIComponent(targetIsp || ""));
    res.setHeader("X-Client-Province", encodeURIComponent(targetProvince || ""));
    const m3uDebugHeader = `\n# [Debug Info] Client IP: ${resolvedClientIp || "N/A"} | Detected ISP: ${targetIsp || "None"} | Detected Province: ${targetProvince || "None"}`;
    const firstLineEnd = content.indexOf("\n");

    recordClientAccess(req, "m3u", "/api/export/m3u", 200, {
      province: finalProvince,
      isp: finalIsp,
      responseBytes: Buffer.byteLength(content, "utf-8")
    });

    if (firstLineEnd !== -1) {
      res.send(content.slice(0, firstLineEnd) + m3uDebugHeader + content.slice(firstLineEnd));
    } else {
      res.send(content + m3uDebugHeader);
    }
  });

  // TXT (TVBox compatible) format
  app.get("/api/export/txt", async (req, res) => {
    const { category, isp, province, status, limit, maxPerChannel: queryMaxPerChannel, ip, clientIp } = req.query;

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

    const finalIsp = isp ? String(isp) : targetIsp;
    const finalProvince = province ? String(province) : targetProvince;

    const cacheParams = {
      format: "txt" as const,
      category: category ? String(category) : undefined,
      isp: finalIsp || undefined,
      province: finalProvince || undefined,
      status: status ? String(status) : undefined,
      limit: limit ? String(limit) : undefined,
      maxPerChannel: queryMaxPerChannel ? String(queryMaxPerChannel) : undefined
    };

    const { content, etag } = getOrGeneratePlaylistExport(cacheParams, () => {
      const { formattedTime, versionId } = getBuildVersionInfo();
      const exportMap = new Map<string, string[]>();

      let count = 0;
      const maxLimit = limit ? Number(limit) : Infinity;
      const maxPerChannel = queryMaxPerChannel ? Number(queryMaxPerChannel) : 15;

      const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
      orderedGroups.forEach((group) => {
        if (group.isolated) return;
        channels.forEach((channel) => {
          if (channel.isolated) return;
          const isInGroup = channel.groupIds.includes(group.id);
          const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
          if (!isInGroup && !isFallback) return;
          const gId = group.id;
          const groupName = group.name;

          if (category && groupName !== String(category) && gId !== String(category)) return;

          let processedSources = channel.sources;

          processedSources = getPlayableSources(processedSources, finalIsp, finalProvince);

          if (province) {
            processedSources = processedSources.filter(source => source.province === String(province));
          }

          // Default: exclude inactive and unknown/checking sources if status is not explicitly asked for
          if (!status) {
            processedSources = processedSources.filter(source => source.status === "active");
          } else if (status) {
            processedSources = processedSources.filter(source => source.status === String(status));
          }

          // Prioritize active, RTSP protocol, and lowest latency
          processedSources = sortSourcesForExport(processedSources);

          // 限制每个频道最大输出数量 (Limit max sources per channel)
          const sourcesToExport = processedSources.slice(0, maxPerChannel);
          sourcesToExport.forEach(bestSource => {
            if (count >= maxLimit) return;

            const catName = groupName;
            if (!exportMap.has(catName)) {
              exportMap.set(catName, []);
            }

            const channelDisplayStr = `${channel.name},${bestSource.url}`;
            
            exportMap.get(catName)!.push(channelDisplayStr);
            count++;
          });
        });
      });

      const fileRows: string[] = [
        `# Playlist Version: v${versionId}`,
        `# Generated At: ${formattedTime}`,
        ""
      ];
      exportMap.forEach((lines, catName) => {
        fileRows.push(`${catName},#genre`);
        fileRows.push(...lines);
        fileRows.push(""); // empty spacing
      });
      return fileRows.join("\n");
    });

    if (req.headers["if-none-match"] === etag) {
      recordClientAccess(req, "txt", "/api/export/txt", 304, {
        province: finalProvince,
        isp: finalIsp
      });
      return res.status(304).end();
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="iptv_custom.txt"');
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("ETag", etag);
    res.setHeader("X-Client-IP", resolvedClientIp || "");
    res.setHeader("X-Client-ISP", encodeURIComponent(targetIsp || ""));
    res.setHeader("X-Client-Province", encodeURIComponent(targetProvince || ""));

    recordClientAccess(req, "txt", "/api/export/txt", 200, {
      province: finalProvince,
      isp: finalIsp,
      responseBytes: Buffer.byteLength(content, "utf-8")
    });

    res.send(content);
  });

  app.get("/api/play/:channelName" , async (req, res) => {
    try {
      const channelName = req.params.channelName;
      const { isp, province } = req.query;
      
      let targetProvince = province ? String(province) : "";
      let targetIsp = isp ? String(isp) : "";
      
      // Auto detect client IP Geo if params are missing
      let resolvedClientIp = "";
      if (!province && !isp) {
        if (typeof req.query.ip === "string" && req.query.ip) {
          resolvedClientIp = req.query.ip;
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
        }
      }
      
      // Normalize search
      const normalizedQuery = normalizeChannelName(channelName);
      const channel = channels.find(c => 
        normalizeChannelName(c.name) === normalizedQuery || 
        c.alias.some(a => normalizeChannelName(a) === normalizedQuery)
      );

      if (!channel || channel.isolated || !channel.sources || channel.sources.length === 0) {
        recordClientAccess(req, "play", `/api/play/${channelName}`, 404, { province: targetProvince, isp: targetIsp });
        return res.status(404).send("Channel not found or isolated");
      }
      
      // Filter out isolated sources & filter by ISP via existing helper
      let processedSources = getPlayableSources(channel.sources, targetIsp, targetProvince);
      processedSources = processedSources.filter(s => s.status === "active");
      
      // Prioritize active, RTSP protocol, and lowest latency
      processedSources = sortSourcesForExport(processedSources);

      if (processedSources.length === 0) {
        // Fallback to channel sources just in case ISP filtering was too aggressive
        processedSources = sortSourcesForExport(channel.sources.filter(s => !s.isolated && s.status === "active"));
      }
      
      if (processedSources.length === 0) {
        recordClientAccess(req, "play", `/api/play/${channelName}`, 404, { province: targetProvince, isp: targetIsp });
        return res.status(404).send("No valid non-isolated sources available");
      }
      
      recordClientAccess(req, "play", `/api/play/${channelName}`, 200, { province: targetProvince, isp: targetIsp });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(processedSources[0].url);
      
    } catch (e: any) {
      res.status(500).send("Error generating play URL: " + e.message);
    }
  });

  // Dynamic EPG XML TV interface
  // Returns generic valid XMLTV layout for connected players matching epgIds
  app.get("/api/export/epg.xml", (req, res) => {
    try {
      const { xml, etag } = getOrGenerateIntegratedEpgXml();
      if (req.headers["if-none-match"] === etag) {
        recordClientAccess(req, "epg_xml", "/api/export/epg.xml", 304);
        return res.status(304).end();
      }
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("ETag", etag);

      recordClientAccess(req, "epg_xml", "/api/export/epg.xml", 200, {
        responseBytes: Buffer.byteLength(xml, "utf-8")
      });

      res.send(xml);
    } catch (err: any) {
      console.error("[EPG EXPORT ERROR]", err);
      res.status(500).send("Error generating EPG XML");
    }
  });

  // Compressed XML.GZ EPG feed with file cache and 304 Not Modified support
  app.get("/api/export/epg.xml.gz", (req, res) => {
    try {
      const { gz, etag } = getOrGenerateIntegratedEpgXml();
      if (req.headers["if-none-match"] === etag) {
        recordClientAccess(req, "epg_gz", "/api/export/epg.xml.gz", 304);
        return res.status(304).end();
      }
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", 'attachment; filename="epg.xml.gz"');
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("ETag", etag);

      recordClientAccess(req, "epg_gz", "/api/export/epg.xml.gz", 200, {
        responseBytes: gz ? gz.length : 0
      });

      res.end(gz);
    } catch (err: any) {
      console.error("[EPG GZIP EXPORT ERROR]", err);
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
    const { failThreshold, action = "isolate" } = req.body || {};
    const threshold = parseInt(failThreshold as string) || 0;

    let affectedCount = 0;
    let restoredRtspCount = 0;

    channels.forEach((channel) => {
      if (action === "delete") {
        const initialCount = channel.sources.length;
        channel.sources = channel.sources.filter((s) => {
          const isRtspOrIntranet = isPrivateOrIntranetUrl(s.url);
          if (isRtspOrIntranet) {
            const isExplicitlyTimeout = s.latency !== undefined && s.latency >= 9999;
            if (!isExplicitlyTimeout) return true; // Keep RTSP/Intranet
          }

          const isInvalid = s.status === "inactive" || (s.latency !== undefined && s.latency >= 9999);
          if (isInvalid) {
            if (threshold > 0) {
              const failures = (s.testCount || 0) - (s.successCount || 0);
              if (failures < threshold && s.latency !== 9999 && s.status !== "inactive") {
                return true; // Keep if failures haven't met threshold
              }
            }
            return false; // Physical delete
          }
          return true;
        });
        affectedCount += (initialCount - channel.sources.length);
      } else {
        // Soft Isolate
        channel.sources.forEach((s) => {
          const isRtspOrIntranet = isPrivateOrIntranetUrl(s.url);

          if (isRtspOrIntranet) {
            const isExplicitlyTimeout = s.latency !== undefined && s.latency >= 9999;
            
            if (!isExplicitlyTimeout) {
              if (s.isolated) {
                s.isolated = false;
                restoredRtspCount++;
              }
              if (s.status === "inactive") {
                s.status = "active";
              }
              return; // Skip isolating RTSP / Intranet streams
            }
          }

          const isInvalid = s.status === "inactive" || (s.latency !== undefined && s.latency >= 9999);

          if (isInvalid && !s.isolated) {
            if (threshold > 0) {
              const failures = (s.testCount || 0) - (s.successCount || 0);
              if (failures < threshold && s.latency !== 9999 && s.status !== "inactive") {
                return; // Skip isolating if it hasn't failed enough times
              }
            }
            s.isolated = true;
            s.status = "inactive";
            affectedCount++;
          }
        });
      }
    });

    saveData();
    let msg = action === "delete"
      ? `成功彻底物理删除了 ${affectedCount} 个失效直播源`
      : `成功软隔离 (隐藏) ${affectedCount} 个失效直播源`;
    if (restoredRtspCount > 0) {
      msg += `，并自动恢复防卡死解隔离了 ${restoredRtspCount} 个 RTSP/内网源`;
    }
    res.json({ success: true, message: msg });
  });

  // Backup Parsing & Normalization Helper Functions
  function parseM3uToBackup(text: string) {
    const lines = text.split(/\r?\n/);
    const channelsMap = new Map<string, any>();
    const groupsMap = new Map<string, any>();
    
    let currentTitle = "";
    let currentGroup = "未分类";
    let currentLogo = "";
    let currentEpgId = "";

    const commitChannel = (title: string, group: string, logo: string, epgId: string, url?: string) => {
      if (!title || title === "未知频道") return;
      const groupKey = group || "未分类";
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, { id: `g_m3u_${groupsMap.size + 1}`, name: groupKey, isolated: false });
      }
      const grp = groupsMap.get(groupKey)!;

      if (!channelsMap.has(title)) {
        channelsMap.set(title, {
          id: `ch_m3u_${channelsMap.size + 1}_${Date.now()}`,
          name: title,
          logo: logo,
          groupIds: [grp.id],
          alias: [],
          epgId: epgId,
          isolated: false,
          sources: []
        });
      }
      const ch = channelsMap.get(title)!;
      if (url) {
        ch.sources.push({
          id: `src_m3u_${ch.sources.length + 1}_${Date.now()}`,
          url,
          status: "active",
          isolated: false
        });
      }
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("#EXTINF:")) {
        if (currentTitle) {
          commitChannel(currentTitle, currentGroup, currentLogo, currentEpgId);
          currentTitle = "";
        }
        const groupMatch = trimmed.match(/group-title="([^"]+)"/i);
        const logoMatch = trimmed.match(/tvg-logo="([^"]+)"/i);
        const epgMatch = trimmed.match(/tvg-id="([^"]+)"/i);
        const commaIdx = trimmed.indexOf(",");
        
        currentGroup = groupMatch ? groupMatch[1] : "未分类";
        currentLogo = logoMatch ? logoMatch[1] : "";
        currentEpgId = epgMatch ? epgMatch[1] : "";
        currentTitle = commaIdx !== -1 ? trimmed.substring(commaIdx + 1).trim() : "";
      } else if (trimmed.includes(",#genre")) {
        if (currentTitle) {
          commitChannel(currentTitle, currentGroup, currentLogo, currentEpgId);
          currentTitle = "";
        }
        const parts = trimmed.split(",");
        currentGroup = parts[0].trim() || "未分类";
      } else if (trimmed.includes("http://") || trimmed.includes("https://") || trimmed.includes("rtsp://") || trimmed.includes("rtmp://")) {
        let url = trimmed;
        let name = currentTitle;
        if (!name && trimmed.includes(",")) {
          const parts = trimmed.split(",");
          name = parts[0].trim();
          url = parts[1].trim();
        }
        if (!name) name = "未知频道";

        commitChannel(name, currentGroup, currentLogo, currentEpgId, url);
        currentTitle = "";
      }
    });

    if (currentTitle) {
      commitChannel(currentTitle, currentGroup, currentLogo, currentEpgId);
      currentTitle = "";
    }

    return {
      channels: Array.from(channelsMap.values()),
      groups: Array.from(groupsMap.values()),
      syncConfigs: [],
      epgSources: []
    };
  }

  function parseAndNormalizeBackup(rawInput: any): any {
    let parsed: any = null;

    if (Buffer.isBuffer(rawInput) || rawInput instanceof Uint8Array) {
      if (rawInput.length >= 2 && rawInput[0] === 0x1f && rawInput[1] === 0x8b) {
        try {
          const uncompressed = zlib.gunzipSync(rawInput);
          return parseAndNormalizeBackup(uncompressed.toString("utf-8"));
        } catch (e) {
          return parseAndNormalizeBackup(rawInput.toString("utf-8"));
        }
      } else {
        return parseAndNormalizeBackup(rawInput.toString("utf-8"));
      }
    }

    if (typeof rawInput === "string") {
      const trimmed = rawInput.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("#") && trimmed.length > 20) {
        try {
          const decoded = Buffer.from(trimmed, "base64");
          if (decoded.length >= 2 && decoded[0] === 0x1f && decoded[1] === 0x8b) {
            const uncompressed = zlib.gunzipSync(decoded);
            return parseAndNormalizeBackup(uncompressed.toString("utf-8"));
          }
        } catch (e) {}
      }

      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        if (trimmed.includes("#EXTM3U") || trimmed.includes("#EXTINF") || trimmed.includes(",http")) {
          return parseM3uToBackup(trimmed);
        }
        throw new Error("备份文件解析失败：既不是有效的 JSON 格式，也不是可解析的 M3U/TXT 播放列表");
      }
    } else if (typeof rawInput === "object" && rawInput !== null) {
      parsed = rawInput;
    }

    if (!parsed) {
      throw new Error("无效的备份文件内容");
    }

    if (parsed.data && typeof parsed.data === "object") parsed = parsed.data;
    else if (parsed.backup && typeof parsed.backup === "object") parsed = parsed.backup;
    else if (parsed.result && typeof parsed.result === "object") parsed = parsed.result;
    else if (parsed.content && typeof parsed.content === "object") parsed = parsed.content;

    if (Array.isArray(parsed)) {
      const channels: any[] = [];
      const groups: any[] = [{ id: "g_imported", name: "导入备份", isolated: false }];
      parsed.forEach((item, idx) => {
        if (item && typeof item === "object") {
          const chId = item.id || `ch_imp_${idx}_${Date.now()}`;
          const chName = toSimplifiedChinese(item.name || item.title || `频道 ${idx + 1}`);
          const chAlias = Array.isArray(item.alias)
            ? item.alias.map((a: string) => toSimplifiedChinese(a))
            : [];
          let sources: any[] = [];
          if (Array.isArray(item.sources)) {
            sources = item.sources;
          } else if (item.url) {
            sources = [{ id: `src_imp_${idx}_1`, url: item.url, status: "active", isolated: false }];
          }
          channels.push({
            id: chId,
            name: chName,
            logo: item.logo || "",
            groupIds: item.groupIds || ["g_imported"],
            alias: chAlias,
            epgId: item.epgId || "",
            isolated: !!item.isolated,
            sources
          });
        }
      });
      return { channels, groups, syncConfigs: [], epgSources: [] };
    }

    const resultObj: any = {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      syncConfigs: Array.isArray(parsed.syncConfigs) ? parsed.syncConfigs : [],
      epgSources: Array.isArray(parsed.epgSources) ? parsed.epgSources : [],
    };

    if (parsed.adminPassword !== undefined) resultObj.adminPassword = parsed.adminPassword;
    if (parsed.githubProxy !== undefined) resultObj.githubProxy = parsed.githubProxy;
    if (parsed.autoCreateChannel !== undefined) resultObj.autoCreateChannel = parsed.autoCreateChannel;
    if (parsed.cronJobs && Array.isArray(parsed.cronJobs)) resultObj.cronJobs = parsed.cronJobs;

    if (Array.isArray(parsed.carouselProxies)) resultObj.carouselProxies = parsed.carouselProxies;
    if (Array.isArray(parsed.deletedCarouselProxies)) resultObj.deletedCarouselProxies = parsed.deletedCarouselProxies;
    if (Array.isArray(parsed.carouselChannels)) resultObj.carouselChannels = parsed.carouselChannels;
    if (Array.isArray(parsed.carouselDiscoveryRules)) resultObj.carouselDiscoveryRules = parsed.carouselDiscoveryRules;
    if (Array.isArray(parsed.carouselDisabledRules)) resultObj.carouselDisabledRules = parsed.carouselDisabledRules;

    if (
      resultObj.channels.length === 0 &&
      resultObj.groups.length === 0 &&
      resultObj.syncConfigs.length === 0 &&
      resultObj.epgSources.length === 0 &&
      (!resultObj.carouselChannels || resultObj.carouselChannels.length === 0) &&
      (!resultObj.carouselProxies || resultObj.carouselProxies.length === 0)
    ) {
      throw new Error("备份文件中未包含任何可识别的频道、分组、订阅源、EPG 或轮播代理数据节点");
    }

    return resultObj;
  }

  // DB Manual Backup & Restore APIs
  app.get("/api/backups", (req, res) => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        return res.json({ success: true, backups: [] });
      }
      const files = fs.readdirSync(DATA_DIR);
      const backupFiles = files
        .filter((f) => f.startsWith("iptv_data_backup_") && (f.endsWith(".json") || f.endsWith(".json.gz")));
      
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
          let content = "";
          if (filename.endsWith(".json.gz")) {
             content = zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf-8");
          } else {
             content = fs.readFileSync(filePath, "utf-8");
          }
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
      
      // Sort newest first based on actual file modification time
      backups.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      
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
      const filename = `iptv_data_backup_manual_${timestamp}.json.gz`;
      const filePath = path.join(DATA_DIR, filename);
      
      const cronJobsData = db.prepare("SELECT * FROM cron_jobs").all();
      const backupContent = {
        groups,
        channels,
        syncConfigs,
        epgSources,
        cronJobs: cronJobsData,
        carouselProxies: db.prepare("SELECT * FROM carousel_proxies").all(),
        deletedCarouselProxies: db.prepare("SELECT * FROM deleted_carousel_proxies").all(),
        carouselChannels: db.prepare("SELECT * FROM carousel_channels").all(),
        carouselDiscoveryRules: db.prepare("SELECT * FROM carousel_discovery_rules").all(),
        carouselDisabledRules: db.prepare("SELECT * FROM carousel_disabled_rules").all(),
        adminPassword,
        githubProxy,
        autoCreateChannel,
        backupMeta: {
          tag: safeTag,
          createdAt: now.toISOString(),
          type: "manual"
        }
      };
      
      fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(JSON.stringify(backupContent, null, 2), "utf-8")));
      res.json({ success: true, message: "备份已成功创建", filename, tag: safeTag });
    } catch (err: any) {
      res.status(500).json({ error: "创建备份失败: " + err.message });
    }
  });

  app.post("/api/backups/restore", (req, res) => {
    try {
      const { filename, content } = req.body;
      
      // Save current database as prior backup to prevent accidental loss
      const autoBackupName = `iptv_data_backup_before_restore_${Date.now()}.json.gz`;
      try {
        const priorBackupJson = {
          groups,
          channels,
          syncConfigs,
          epgSources,
          carouselProxies: db.prepare("SELECT * FROM carousel_proxies").all(),
          deletedCarouselProxies: db.prepare("SELECT * FROM deleted_carousel_proxies").all(),
          carouselChannels: db.prepare("SELECT * FROM carousel_channels").all(),
          carouselDiscoveryRules: db.prepare("SELECT * FROM carousel_discovery_rules").all(),
          carouselDisabledRules: db.prepare("SELECT * FROM carousel_disabled_rules").all(),
          adminPassword,
          githubProxy,
        };
        fs.writeFileSync(path.join(DATA_DIR, autoBackupName), zlib.gzipSync(Buffer.from(JSON.stringify(priorBackupJson, null, 2), "utf-8")));
      } catch (backupErr) {
        console.error("[Restore Backup] Failed to write safety prior backup:", backupErr);
      }

      let parsedBackupData: any = null;

      if (content) {
        try {
          parsedBackupData = parseAndNormalizeBackup(content);
        } catch (e: any) {
          return res.status(400).json({ error: "备份文件解析失败: " + e.message });
        }
      } else if (filename) {
        const safeFilename = path.basename(filename);
        const filePath = path.join(DATA_DIR, safeFilename);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: "未找到指定的备份文件: " + safeFilename });
        }
        try {
          let rawData: Buffer | string = "";
          if (filePath.endsWith(".json.gz")) {
            rawData = zlib.gunzipSync(fs.readFileSync(filePath));
          } else {
            rawData = fs.readFileSync(filePath, "utf-8");
          }
          parsedBackupData = parseAndNormalizeBackup(rawData);
        } catch (e: any) {
          return res.status(500).json({ error: "解析本地备份文件失败: " + e.message });
        }
      } else {
        return res.status(400).json({ error: "参数错误: filename 或者是备份内容 (content) 不能为空" });
      }

      fs.writeFileSync(DATA_FILE, JSON.stringify(parsedBackupData, null, 2), "utf-8");
      loadData();
      saveDataSync(); // Force immediate persistence to SQLite

      const chCount = parsedBackupData.channels ? parsedBackupData.channels.length : 0;
      const grpCount = parsedBackupData.groups ? parsedBackupData.groups.length : 0;

      return res.json({
        success: true,
        message: `成功完成恢复！共载入 ${chCount} 个频道和 ${grpCount} 个分组。原有数据已自动为您归档为：${autoBackupName}`,
        autoBackupName,
        channelCount: chCount,
        groupCount: grpCount
      });
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
    preGenerateIspPlaylists();
    console.log(`Server loaded with ${channels.length} channels, running on http://localhost:${PORT}`);
  });
}

startServer();
