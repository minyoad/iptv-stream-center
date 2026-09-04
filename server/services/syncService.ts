import crypto from "crypto";
import zlib from "zlib";
import { getDb } from "../db/sqlite";
import { Channel, Group, LiveSource, SyncConfig } from "../types";
import {
  channels,
  groups,
  syncConfigs,
  epgSources,
  autoCreateChannel,
  githubProxy,
  saveData,
  checkAndPerformDailyBackup
} from "../store";
import { fetchBufferWithFallback } from "../utils/network";
import {
  normalizeChannelName,
  findAliasTemplate,
  stripBitrateAndResolution,
  toSimplifiedChinese,
  parseIspAndProvince,
  generateDefaultEpgId
} from "../utils/text";
import {
  parseCarouselUrl,
  detectAndRegisterCarouselProxy,
  isUrlBlockedByDisabledRules,
  syncCarouselSources,
  isCarouselSource
} from "./carouselService";
import {
  testCarouselProxyAvailability,
  runConcurrentTest,
  testStatus
} from "./speedTestService";
import { performEpgSync } from "./epgService";

export class ChannelImportHelper {
  private channels: Channel[];
  private groups: Group[];
  private channelByNorm = new Map<string, Channel>();
  private channelByAliasNorm = new Map<string, Channel>();
  private sourcesByChannelId = new Map<string, Set<string>>();
  private groupByLower = new Map<string, Group>();

  constructor(channels: Channel[], groups: Group[]) {
    this.channels = channels;
    this.groups = groups;

    for (const g of groups) {
      this.groupByLower.set(g.name.toLowerCase().trim(), g);
    }
    for (const c of channels) {
      this.indexChannel(c);
    }
  }

  public indexChannel(c: Channel) {
    const norm = normalizeChannelName(c.name);
    if (norm && !this.channelByNorm.has(norm)) {
      this.channelByNorm.set(norm, c);
    }
    if (c.alias && Array.isArray(c.alias)) {
      for (const a of c.alias) {
        const aNorm = normalizeChannelName(a);
        if (aNorm && !this.channelByAliasNorm.has(aNorm)) {
          this.channelByAliasNorm.set(aNorm, c);
        }
      }
    }
    if (!this.sourcesByChannelId.has(c.id)) {
      const set = new Set<string>();
      if (c.sources && Array.isArray(c.sources)) {
        for (const s of c.sources) {
          if (s.url) set.add(s.url);
        }
      }
      this.sourcesByChannelId.set(c.id, set);
    }
  }

  public resolveGroup(catName: string, autoCreate: boolean): string | null {
    const key = catName.toLowerCase().trim();
    let g = this.groupByLower.get(key);
    if (!g) {
      g = this.groups.find(gr => gr.name.toLowerCase().trim() === key);
      if (g) {
        this.groupByLower.set(key, g);
      }
    }
    if (!g && autoCreate) {
      g = {
        id: "g_" + Math.random().toString(36).substring(2, 10),
        name: catName,
      };
      this.groups.push(g);
      this.groupByLower.set(key, g);
    }
    return g ? g.id : null;
  }

  public findChannel(lookupName: string, stdInfo: { templateName: string; aliases: string[] } | null, carouselKey?: string | null): Channel | null {
    if (carouselKey) {
      for (const c of this.channels) {
        if (c.alias && c.alias.includes(carouselKey)) return c;
      }
    }

    const normLookup = normalizeChannelName(lookupName);
    if (normLookup) {
      const match = this.channelByNorm.get(normLookup) || this.channelByAliasNorm.get(normLookup);
      if (match) return match;
    }

    if (stdInfo && stdInfo.aliases) {
      for (const a of stdInfo.aliases) {
        const aNorm = normalizeChannelName(a);
        if (aNorm) {
          const match = this.channelByNorm.get(aNorm) || this.channelByAliasNorm.get(aNorm);
          if (match) return match;
        }
      }
    }

    return null;
  }

  public addChannel(ch: Channel) {
    this.channels.push(ch);
    this.indexChannel(ch);
  }

  public registerChannelAliases(ch: Channel, newAliases: string[]) {
    if (!ch.alias) ch.alias = [];
    for (const a of newAliases) {
      if (!ch.alias.includes(a)) {
        ch.alias.push(a);
      }
      const aNorm = normalizeChannelName(a);
      if (aNorm && !this.channelByAliasNorm.has(aNorm)) {
        this.channelByAliasNorm.set(aNorm, ch);
      }
    }
  }

  public addSource(
    ch: Channel,
    url: string,
    province: string,
    isp: string,
    resolution?: string
  ): { added: boolean; source?: LiveSource } {
    let set = this.sourcesByChannelId.get(ch.id);
    if (!set) {
      set = new Set<string>();
      this.sourcesByChannelId.set(ch.id, set);
    }

    if (!set.has(url)) {
      set.add(url);
      const newSource: LiveSource = {
        id: "src_" + Math.random().toString(36).substring(2, 10),
        url,
        province,
        isp,
        status: "unknown",
        resolution: resolution || undefined
      };
      if (!ch.sources) ch.sources = [];
      ch.sources.push(newSource);
      return { added: true, source: newSource };
    } else {
      if (isp) {
        const existing = ch.sources.find(s => s.url === url);
        if (existing) existing.isp = isp;
      }
      return { added: false };
    }
  }
}

export async function performSync(config: SyncConfig, force = false): Promise<boolean> {
  const db = getDb();
  try {
    let targetUrl = config.url;
    if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }

    if (githubProxy && (targetUrl.includes("github.com") || targetUrl.includes("githubusercontent.com"))) {
      const proxyPrefix = githubProxy.endsWith("/") ? githubProxy : `${githubProxy}/`;
      targetUrl = `${proxyPrefix}${targetUrl}`;
    }

    console.log(`[SUBSCRIPTION SYNC] Fetching ${config.name} from: ${targetUrl}`);
    const { buffer, isGzipped } = await fetchBufferWithFallback(targetUrl, "IPTV-Manager-Sync-Service");

    let content = "";
    if (isGzipped) {
      try {
        content = zlib.gunzipSync(buffer).toString("utf-8");
      } catch (e) {
        content = buffer.toString("utf-8");
      }
    } else {
      content = buffer.toString("utf-8");
    }

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

    const helper = new ChannelImportHelper(channels, groups);

    if (config.type === "m3u" || content.includes("#EXTM3U")) {
      const lines = content.split(/\r?\n/);
      let currentInfo: {
        name: string;
        logo: string;
        category: string;
        alias: string[];
        epgId: string;
      } | null = null;

      const processM3uItem = (
        info: {
          name: string;
          logo: string;
          category: string;
          alias: string[];
          epgId: string;
        },
        rawUrl?: string
      ) => {
        if (!info || !info.name || info.name === "未知频道") return;

        let url = rawUrl ? rawUrl.split("$")[0].trim() : "";
        const { province, isp: parsedIsp } = parseIspAndProvince(info.name + " " + info.category);
        const isp = config.isp ? config.isp : parsedIsp;

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

        const catNames = (isCarouselM3u ? ["轮播频道"] : info.category.split(/[,;，；]/)).map(s => s.trim()).filter(Boolean);
        if (catNames.length === 0) catNames.push("其它频道");

        const matchedGroupIds: string[] = [];
        for (const catName of catNames) {
          const gid = helper.resolveGroup(catName, autoCreateChannel);
          if (gid) matchedGroupIds.push(gid);
        }

        const stdInfo = findAliasTemplate(info.name);
        const lookupName = stdInfo ? stdInfo.templateName : info.name;

        let channel = helper.findChannel(lookupName, stdInfo, carouselKeyM3u);

        if (!channel) {
          if (!autoCreateChannel || config.aliasOnly) {
            return;
          }
          const channelId = "ch_" + Math.random().toString(36).substring(2, 10);
          const cleanName = stdInfo ? stdInfo.templateName : info.name;
          const cleanAliases = stdInfo 
            ? Array.from(new Set([cleanName, info.name, ...stdInfo.aliases, ...(info.alias || [])]))
            : info.alias;

          channel = {
            id: channelId,
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
          if (info.logo && (!channel.logo || channel.logo.includes("unsplash.com"))) {
            channel.logo = info.logo;
          }
          if (info.epgId) {
            channel.epgId = info.epgId;
          }
        }

        if (config.aliasOnly || !url) {
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
            processM3uItem(currentInfo);
            currentInfo = null;
          }
          const logoMatch = line.match(/tvg-logo="([^"]+)"/) || line.match(/logo="([^"]+)"/);
          const groupMatch = line.match(/group-title="([^"]+)"/);
          const epgMatch = line.match(/tvg-id="([^"]+)"/) || line.match(/epg-id="([^"]+)"/);
          const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
          const aliasMatch = line.match(/tvg-alias="([^"]+)"/) || line.match(/alias="([^"]+)"/) || line.match(/alias-name="([^"]+)"/);
          
          let name = "未知频道";
          const lastQuoteIndex = line.lastIndexOf('"');
          if (lastQuoteIndex !== -1) {
            const commaAfterQuotes = line.indexOf(",", lastQuoteIndex);
            if (commaAfterQuotes !== -1) {
              name = line.substring(commaAfterQuotes + 1).trim();
            } else {
              const commaIndex = line.lastIndexOf(",");
              if (commaIndex !== -1) name = line.substring(commaIndex + 1).trim();
            }
          } else {
            const commaIndex = line.indexOf(",");
            if (commaIndex !== -1) name = line.substring(commaIndex + 1).trim();
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
            category: toSimplifiedChinese(groupMatch ? groupMatch[1] : "其它频道"),
            alias: parsedAliases,
            epgId: epgMatch ? epgMatch[1] : "",
          };
        } else if (line && !line.startsWith("#") && currentInfo) {
          processM3uItem(currentInfo, line);
          currentInfo = null;
        }
      }
      if (currentInfo) {
        processM3uItem(currentInfo);
        currentInfo = null;
      }
    } else {
      const lines = content.split(/\r?\n/);
      let currentCategory = "其它频道";

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

          const { province, isp: parsedIsp } = parseIspAndProvince(nameWithSpecs + " " + currentCategory);
          const isp = config.isp ? config.isp : parsedIsp;
          let name = nameWithSpecs.split("#")[0].trim();
          name = stripBitrateAndResolution(name);

          if (name.includes("线路") || name.includes("盗源狗") || !name) {
            continue;
          }

          const nameParts = name.split(/[,;，；:]/).map(s => toSimplifiedChinese(s.trim())).filter(Boolean);
          if (nameParts.length > 0) {
            name = nameParts[0];
          }

          const catNames = currentCategory.split(/[,;，；]/).map(s => s.trim()).filter(Boolean);
          if (catNames.length === 0) catNames.push("其它频道");

          const matchedGroupIds: string[] = [];
          for (const catName of catNames) {
            const gid = helper.resolveGroup(catName, autoCreateChannel);
            if (gid) matchedGroupIds.push(gid);
          }

          const stdInfo = findAliasTemplate(name);
          const lookupName = stdInfo ? stdInfo.templateName : name;

          let channel = helper.findChannel(lookupName, stdInfo);

          if (!channel) {
            if (!autoCreateChannel || config.aliasOnly) {
              continue;
            }
            const channelId = "ch_" + Math.random().toString(36).substring(2, 10);
            const cleanName = stdInfo ? stdInfo.templateName : name;
            const cleanAliases = stdInfo 
              ? Array.from(new Set([cleanName, ...nameParts, ...stdInfo.aliases]))
              : Array.from(new Set(nameParts));

            channel = {
              id: channelId,
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
            helper.registerChannelAliases(channel, nameParts);
          }

          if (config.aliasOnly) {
            continue;
          }

          for (const url of urls) {
            const addRes = helper.addSource(channel, url, province, isp);
            if (addRes.added) {
              importedSourcesCount++;
              detectAndRegisterCarouselProxy(url);
            } else if (config.isp) {
              detectAndRegisterCarouselProxy(url);
            }
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
      config.message = `连续导入失败 ${config.consecutiveFailures} 次，已自动禁用: ${err.message || err}`;
    } else {
      config.message = `同步失败 (连续第 ${config.consecutiveFailures} 次失败): ${err.message || err}`;
    }
    saveData();
    return false;
  }
}

export function calculateNextRun(startTime: string, intervalMinutes: number, lastRunStr: string | null): string {
  const now = new Date();
  let nextRunTime = new Date();
  
  if (startTime) {
    const [hours, minutes] = startTime.split(':').map(Number);
    nextRunTime.setHours(hours, minutes, 0, 0);
    
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

export async function runCronJob(job: any) {
  const db = getDb();
  const nowStr = new Date().toISOString();
  const nextRun = calculateNextRun(job.startTime, job.intervalMinutes, nowStr);
  db.prepare("UPDATE cron_jobs SET lastRun = ?, nextRun = ? WHERE id = ?").run(nowStr, nextRun, job.id);
  
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
    } else if (job.id === "job_carousel_test") {
      let testedCount = 0;
      let activeCount = 0;
      const proxies = db.prepare('SELECT * FROM carousel_proxies').all() as any[];
      if (proxies.length > 0) {
        for (const proxy of proxies) {
          const plat = (proxy.platform || '').toLowerCase();
          if (isUrlBlockedByDisabledRules(proxy.urlTemplate, plat)) {
            db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', proxy.id);
            continue;
          }

          const testRes = await testCarouselProxyAvailability(proxy);
          const isOk = testRes.available;
          
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run(isOk ? 'active' : 'inactive', proxy.id);
          if (isOk) activeCount++;
          testedCount++;
        }
      }
      const syncStats = syncCarouselSources();
      insertLog.run(logId, job.id, nowStr, "success", `成功检测了 ${testedCount} 个轮播代理（有效: ${activeCount}），并同步生成 ${syncStats.createdCount} 个新源，覆盖 ${syncStats.channelsCount} 个频道`);
    } else if (job.id === "job_server_test") {
      if (testStatus.status === "running") {
        insertLog.run(logId, job.id, nowStr, "failed", "当前已有测速任务在运行，跳过定时测速");
      } else {
        let targetSources: { id: string; channelId: string; url: string }[] = [];
        channels.forEach((channel) => {
          if (channel.isolated) return;
          if (!channel.sources) return;
          channel.sources.forEach((source) => {
            if (source.isolated) return;
            const isCarousel = isCarouselSource(source, channel);
            const specificISPs = ["电信", "联通", "移动", "广电", "铁通"];
            if (!isCarousel && source.isp && specificISPs.includes(source.isp)) return;
            targetSources.push({
              id: source.id,
              channelId: channel.id,
              url: source.url,
            });
          });
        });
        if (targetSources.length > 0) {
          await runConcurrentTest(targetSources, 8);
          insertLog.run(logId, job.id, nowStr, "success", `成功对 ${targetSources.length} 个直播源进行了测速`);
        } else {
          insertLog.run(logId, job.id, nowStr, "success", "没有符合测速条件的直播源");
        }
      }
    } else {
      insertLog.run(logId, job.id, nowStr, "failed", "未知的定时任务 ID");
    }
  } catch (err: any) {
    insertLog.run(logId, job.id, nowStr, "failed", err.message || "执行失败");
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startCronScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    const now = new Date();
    checkAndPerformDailyBackup();

    const db = getDb();
    const jobs = db.prepare("SELECT * FROM cron_jobs WHERE active = 1").all() as any[];
    for (const job of jobs) {
      if (!job.nextRun || new Date(job.nextRun) <= now) {
        console.log(`Starting scheduled cron job: ${job.name}`);
        await runCronJob(job);
      }
    }
  }, 60 * 1000);
}
