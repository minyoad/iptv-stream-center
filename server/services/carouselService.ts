import crypto from "crypto";
import { getDb } from "../db/sqlite";
import { PRESET_KNOWN_RULES, PRESET_DISABLED_RULES } from "../constants";
import { groups, channels, loadData, saveData, saveDataSync } from "../store";

let discoveryRulesCache: any[] | null = null;
let disabledRulesCache: any[] | null = null;

export function seedDisabledRules(overwrite = false) {
  const db = getDb();
  if (overwrite) {
    db.prepare('DELETE FROM carousel_disabled_rules').run();
  }
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rules: typeof PRESET_DISABLED_RULES) => {
    let count = 0;
    for (const rule of rules) {
      const info = insertStmt.run(
        crypto.randomUUID(),
        rule.pattern,
        rule.type || 'contains',
        rule.platform || '',
        rule.description || '',
        rule.enabled !== undefined ? (rule.enabled ? 1 : 0) : 1
      );
      if (info.changes > 0) count++;
    }
    return count;
  });
  const added = insertMany(PRESET_DISABLED_RULES);
  disabledRulesCache = null;
  return added;
}

export function getDisabledRules() {
  const db = getDb();
  if (!disabledRulesCache) {
    const count = (db.prepare('SELECT COUNT(*) as count FROM carousel_disabled_rules').get() as any).count;
    if (count === 0) {
      seedDisabledRules(false);
    }
    disabledRulesCache = db.prepare('SELECT * FROM carousel_disabled_rules ORDER BY createdAt DESC').all() as any[];
  }
  return disabledRulesCache;
}

export function invalidateDisabledRulesCache() {
  disabledRulesCache = null;
}

export function invalidateDiscoveryRulesCache() {
  discoveryRulesCache = null;
}

export function isUrlBlockedByDisabledRules(url: string, platform?: string): boolean {
  if (!url || typeof url !== 'string') return true;
  const urlLower = url.toLowerCase();

  // Always block miguvideo as core hard rule
  if (urlLower.includes("miguvideo")) return true;

  try {
    const rules = getDisabledRules();
    for (const rule of rules) {
      if (rule.enabled !== 1 && rule.enabled !== true) continue;
      if (rule.platform && platform && rule.platform.toLowerCase() !== platform.toLowerCase()) {
        continue;
      }
      const pat = (rule.pattern || '').trim();
      if (!pat) continue;
      const patLower = pat.toLowerCase();

      if (rule.type === 'regex') {
        try {
          const reg = new RegExp(pat, 'i');
          if (reg.test(url)) return true;
        } catch (e) {}
      } else if (rule.type === 'prefix') {
        if (urlLower.startsWith(patLower)) return true;
      } else if (rule.type === 'domain') {
        try {
          let host = "";
          if (url.startsWith("http://") || url.startsWith("https://")) {
            host = new URL(url).hostname.toLowerCase();
          } else {
            host = url.split("/")[0].split(":")[0].toLowerCase();
          }
          if (host === patLower || host.endsWith("." + patLower) || host.includes(patLower)) {
            return true;
          }
        } catch (e) {
          if (urlLower.includes(patLower)) return true;
        }
      } else {
        if (urlLower.includes(patLower)) return true;
      }
    }
  } catch (e) {}

  return false;
}

export function cleanupBlockedCarouselProxies(): number {
  const db = getDb();
  let count = 0;
  try {
    const resMigu = db.prepare(`
      DELETE FROM carousel_proxies 
      WHERE urlTemplate LIKE '%miguvideo%' 
         OR urlTemplate LIKE '%lz-cdn%' 
         OR urlTemplate LIKE '%lzcdn%' 
         OR urlTemplate LIKE '%ffzy%' 
         OR urlTemplate LIKE '%bfzy%'
         OR urlTemplate LIKE '%/202%'
         OR urlTemplate LIKE '%/203%'
    `).run();
    count += resMigu.changes;

    const allProxies = db.prepare('SELECT id, platform, urlTemplate FROM carousel_proxies').all() as any[];
    for (const p of allProxies) {
      if (isUrlBlockedByDisabledRules(p.urlTemplate, p.platform)) {
        const r = db.prepare('DELETE FROM carousel_proxies WHERE id = ?').run(p.id);
        count += r.changes;
      }
    }
  } catch (e) {
    console.error("Failed to cleanup blocked carousel proxies:", e);
  }
  return count;
}

export function seedKnownRules(overwrite = false) {
  const db = getDb();
  if (overwrite) {
    db.prepare('DELETE FROM carousel_discovery_rules').run();
  } else {
    db.prepare("DELETE FROM carousel_discovery_rules WHERE platform = 'cntv' OR keyword = 'yy.m3u8' OR keyword LIKE 'regex:^https?://%'").run();
  }
  const insertStmt = db.prepare('INSERT OR IGNORE INTO carousel_discovery_rules (id, platform, keyword, enabled) VALUES (?, ?, ?, 1)');
  const insertMany = db.transaction((rules: typeof PRESET_KNOWN_RULES) => {
    let count = 0;
    for (const rule of rules) {
      const info = insertStmt.run(crypto.randomUUID(), rule.platform, rule.keyword);
      if (info.changes > 0) count++;
    }
    return count;
  });
  const addedCount = insertMany(PRESET_KNOWN_RULES);
  discoveryRulesCache = null;
  return addedCount;
}

export function getDiscoveryRules(includeDisabled = false) {
  const db = getDb();
  if (!discoveryRulesCache) {
    try {
      discoveryRulesCache = db.prepare('SELECT * FROM carousel_discovery_rules').all();
    } catch (e) {
      discoveryRulesCache = [];
    }
  }
  if (includeDisabled) {
    return discoveryRulesCache || [];
  }
  return (discoveryRulesCache || []).filter((r: any) => r.enabled === 1 || r.enabled === true || r.enabled === undefined || r.enabled === null);
}

export function normalizePlatform(platform: string): string {
  if (!platform || typeof platform !== 'string') return '';
  const p = platform.trim().toLowerCase();
  if (p === 'cctv' || p === 'cntv' || p === 'cctv_live' || p === 'cntv_live') return 'cntv';
  if (p === 'migu' || p === 'mg' || p === 'migu_live' || p === 'miguvideo') return 'migu';
  if (p === 'douyu' || p === 'dy') return 'douyu';
  if (p === 'huya' || p === 'hy') return 'huya';
  if (p === 'bilibili' || p === 'bili' || p === 'bstation') return 'bilibili';
  if (p === 'kuaishou' || p === 'ks') return 'kuaishou';
  if (p === 'douyin' || p === 'dyin' || p === 'tiktok') return 'douyin';
  if (p === 'yy') return 'yy';
  return p;
}

export function formatProxyUrl(urlTemplate: string, originalId: string): string {
  if (!urlTemplate || !originalId) return '';
  return urlTemplate
    .trim()
    .replace(/\{\s*(?:id|roomid|channelid|cid|originalid)?\s*\}/gi, originalId)
    .replace(/\$id/gi, originalId)
    .replace(/\$1/g, originalId)
    .replace(/%s/g, originalId);
}

export function removeSourcesForProxyTemplates(templates: { platform?: string; urlTemplate: string }[]) {
  const db = getDb();
  if (!templates || templates.length === 0) return 0;
  let removedCount = 0;
  
  for (const t of templates) {
    if (!t || !t.urlTemplate) continue;
    const normalizedTpl = t.urlTemplate.trim().replace(/\{\s*(?:id|roomid|channelid|cid|originalid)?\s*\}|\$id|\$1|%s/gi, '{}');
    const parts = normalizedTpl.split('{}');
    const prefix = parts[0] || '';
    const suffix = parts[1] !== undefined ? parts[1] : '';

    // 1. Remove from in-memory channels
    for (const ch of channels) {
      if (ch.sources && ch.sources.length > 0) {
        const initLen = ch.sources.length;
        ch.sources = ch.sources.filter((s: any) => {
          if (!s || !s.url) return true;
          if (suffix) {
            if (s.url.startsWith(prefix) && s.url.endsWith(suffix)) return false;
          } else {
            if (s.url.startsWith(prefix)) return false;
          }
          return true;
        });
        removedCount += (initLen - ch.sources.length);
      }
    }

    // 2. Remove from SQLite sources table
    try {
      if (prefix) {
        if (suffix) {
          const res = db.prepare("DELETE FROM sources WHERE url LIKE ? AND url LIKE ?").run(`${prefix}%`, `%${suffix}`);
          removedCount += res.changes;
        } else {
          const res = db.prepare("DELETE FROM sources WHERE url LIKE ?").run(`${prefix}%`);
          removedCount += res.changes;
        }
      }
    } catch (e) {
      console.error("Error deleting sources from SQLite for proxy template:", e);
    }
  }

  saveData(true);
  return removedCount;
}

export function matchesRuleKeyword(url: string, keyword: string, platform?: string): boolean {
  if (!url || !keyword) return false;
  if (isUrlBlockedByDisabledRules(url, platform)) {
    return false;
  }

  if (keyword.startsWith("regex:") || keyword.includes("\\d") || keyword.includes(".*") || keyword.includes("[") || keyword.includes("^") || keyword.includes("$")) {
    try {
      const pattern = keyword.startsWith("regex:") ? keyword.slice(6) : keyword;
      return new RegExp(pattern, "i").test(url);
    } catch (e) {}
  }
  return url.includes(keyword);
}

export function extractCarouselPlatformAndId(url: string): { platform: string | null; originalId: string | null; template: string | null } {
  if (!url || typeof url !== 'string') return { platform: null, originalId: null, template: null };

  if (isUrlBlockedByDisabledRules(url)) {
    return { platform: null, originalId: null, template: null };
  }

  let platform: string | null = null;
  const rules = getDiscoveryRules(false);
  for (const rule of rules) {
    if (matchesRuleKeyword(url, rule.keyword, rule.platform)) {
      platform = rule.platform;
      break;
    }
  }

  if (!platform) {
    if (/[?&/](?:migu|mg)[_./?]/i.test(url) || /\/migu\b/i.test(url) || /migu\.php/i.test(url) || /:\d+\/+[1-9]\d{7,9}/.test(url)) {
      platform = "migu";
    } else if (/[?&/](?:yy)[_./?]/i.test(url) || /yy\.php/i.test(url)) {
      platform = "yy";
    } else if (/[?&/](?:douyu)[_./?]/i.test(url) || /douyu\.php/i.test(url)) {
      platform = "douyu";
    } else if (/[?&/](?:huya)[_./?]/i.test(url) || /huya\.php/i.test(url)) {
      platform = "huya";
    } else if (/[?&/](?:bilibili|bili)[_./?]/i.test(url) || /bilibili\.php/i.test(url)) {
      platform = "bilibili";
    } else if (/[?&/](?:kuaishou|ks)[_./?]/i.test(url) || /kuaishou\.php/i.test(url)) {
      platform = "kuaishou";
    } else if (/[?&/](?:douyin|dyin)[_./?]/i.test(url) || /douyin\.php/i.test(url)) {
      platform = "douyin";
    } else if (/[?&/](?:cntv)[_./?]/i.test(url) || /cntv\.php/i.test(url)) {
      platform = "cntv";
    }
  }

  if (!platform) return { platform: null, originalId: null, template: null };

  let originalId: string | null = null;
  let template: string | null = null;

  if (platform === 'migu') {
    const qMatch = url.match(/[?&](?:id|cid|rid|channelId|roomId)=(\d{6,12})/i);
    if (qMatch) {
      originalId = qMatch[1];
      template = url.replace(new RegExp(`([?&](?:id|cid|rid|channelId|roomId)=)${originalId}`, 'i'), '$1{}');
    }

    if (!originalId) {
      const pathMatch = url.match(/\/(?:migu|mg|migu_live)\/(\d{6,12})(?:(?:\/|\.m3u8|\.flv)[^?#]*)?(?:\?.*)?$/i);
      if (pathMatch) {
        originalId = pathMatch[1];
        template = url.replace(new RegExp(`(/+(?:migu|mg|migu_live)/+)${originalId}`, 'i'), '$1{}');
      }
    }

    if (!originalId) {
      const rootMatch = url.match(/:\d+\/+([1-9]\d{7,9})(?:(?:\/|\.m3u8|\.flv)[^?#]*)?(?:\?.*)?$/i);
      if (rootMatch) {
        originalId = rootMatch[1];
        template = url.replace(new RegExp(`(:\\d+/+)${originalId}`, 'i'), '$1{}');
      }
    }

    if (!originalId && /[?&/](?:migu|mg)[_./?]/i.test(url)) {
      const numMatch = url.match(/\b([1-9]\d{7,9})\b/);
      if (numMatch) {
        originalId = numMatch[1];
        template = url.replace(originalId, '{}');
      }
    }

    if (originalId) {
      if (/^cctv|^cgtn/i.test(originalId)) {
        platform = 'cntv';
      } else if (!/^\d{6,12}$/.test(originalId)) {
        platform = null;
        originalId = null;
        template = null;
      }
    } else {
      platform = null;
    }
  } else {
    const match1 = url.match(/[?&](?:id|cid|rid|channelId|roomId)=([a-zA-Z0-9_-]+)/i);
    if (match1) {
      originalId = match1[1];
      template = url.replace(new RegExp(`([?&](?:id|cid|rid|channelId|roomId)=)${originalId}`, 'i'), '$1{}');
    }

    if (!originalId) {
      const match2 = url.match(/\/(?:yy|douyu|huya|bilibili|bili|kuaishou|ks|douyin|cntv)\/([a-zA-Z0-9_-]+)(?:(?:\/|\.m3u8|\.flv)[^?#]*)?(?:\?.*)?$/i);
      if (match2) {
        originalId = match2[1];
        template = url.replace(new RegExp(`(/+(?:yy|douyu|huya|bilibili|bili|kuaishou|ks|douyin|cntv)/+)${originalId}`, 'i'), '$1{}');
      }
    }

    if (!originalId) {
      const match3 = url.match(/\/([a-zA-Z0-9_-]+)(?:\.flv|\.m3u8)?(?:\?.*)?\/?$/i);
      if (match3 && match3[1] && !/^(?:index|live|playlist|video|chunk|stream|stream\d+|1|\d)$/i.test(match3[1])) {
        originalId = match3[1];
        template = url.replace(new RegExp(`(/+)${originalId}(?=[/.?#]|$)`, 'i'), '$1{}');
      }
    }
  }

  if (template && !template.includes('{}')) {
    template = null;
  }

  return { platform, originalId, template };
}

export function parseCarouselUrl(url: string) {
  const { platform, originalId } = extractCarouselPlatformAndId(url);
  return { platform, originalId };
}

export function isCarouselSource(s: any, channel?: any): boolean {
  if (!s || !s.url) return false;
  const url = String(s.url);
  const parsed = parseCarouselUrl(url);
  if (parsed && parsed.platform) return true;
  if (/\/(?:migu|mg|cntv|cctv|douyu|huya|bilibili|bili|yy|kuaishou|ks|douyin)\//i.test(url)) return true;
  if (url.includes("@carousel:")) return true;

  if (channel && channel.groupIds && Array.isArray(channel.groupIds)) {
    const isCarouselGroup = channel.groupIds.some((gId: string) => {
      if (gId === "g_carousel") return true;
      const g = (groups || []).find((grp: any) => grp.id === gId);
      return g && g.name && g.name.includes("轮播");
    });
    if (isCarouselGroup) return true;
  }
  return false;
}

const knownCarouselProxies = new Set<string>();
const knownDeletedCarouselProxies = new Set<string>();
let carouselProxiesCached = false;

function ensureCarouselProxiesCache() {
  const db = getDb();
  if (carouselProxiesCached) return;
  try {
    const proxies = db.prepare('SELECT urlTemplate FROM carousel_proxies').all() as any[];
    for (const p of proxies) {
      if (p.urlTemplate) knownCarouselProxies.add(p.urlTemplate);
    }
    const deleted = db.prepare('SELECT urlTemplate FROM deleted_carousel_proxies').all() as any[];
    for (const d of deleted) {
      if (d.urlTemplate) knownDeletedCarouselProxies.add(d.urlTemplate);
    }
    carouselProxiesCached = true;
  } catch (e) {}
}

export function detectAndRegisterCarouselProxy(url: string, ignoreDeletedCheck = false) {
  const db = getDb();
  try {
    if (!url || typeof url !== 'string') return;
    if (isUrlBlockedByDisabledRules(url)) return;
    const { platform, template } = extractCarouselPlatformAndId(url);

    if (platform && template && template.includes('{}') && !isUrlBlockedByDisabledRules(template, platform)) {
      ensureCarouselProxiesCache();
      if (!ignoreDeletedCheck) {
        if (knownDeletedCarouselProxies.has(template)) return;
      } else {
        if (knownDeletedCarouselProxies.has(template)) {
          knownDeletedCarouselProxies.delete(template);
          try {
            db.prepare('DELETE FROM deleted_carousel_proxies WHERE urlTemplate = ?').run(template);
          } catch (e) {}
        }
      }

      if (knownCarouselProxies.has(template)) return;

      knownCarouselProxies.add(template);
      try {
        db.prepare('INSERT INTO carousel_proxies (id, platform, urlTemplate, status) VALUES (?, ?, ?, ?)').run(
          crypto.randomUUID(),
          platform,
          template,
          'active'
        );
      } catch (e) {}
    }
  } catch (e) {
    console.error('Error detecting carousel proxy:', e);
  }
}

export function scanAndRegisterAllCarouselProxies(forceReScan = false): number {
  const db = getDb();
  try {
    cleanupBlockedCarouselProxies();
    if (forceReScan) {
      try {
        db.prepare('DELETE FROM deleted_carousel_proxies').run();
      } catch (e) {}
    }
    let addedCount = 0;
    const allSources = db.prepare(`
      SELECT s.url 
      FROM sources s 
      LEFT JOIN channels c ON s.channelId = c.id 
      WHERE (s.isolated = 0 OR s.isolated IS NULL) 
        AND (c.isolated = 0 OR c.isolated IS NULL)
    `).all() as any[];
    for (const row of allSources) {
      if (row.url && !isUrlBlockedByDisabledRules(row.url)) {
        const prevCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
        detectAndRegisterCarouselProxy(row.url, forceReScan);
        const newCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
        if (newCount > prevCount) {
          addedCount += (newCount - prevCount);
        }
      }
    }
    return addedCount;
  } catch (e) {
    console.error('Error scanning carousel proxies from sources:', e);
    return 0;
  }
}

export function syncCarouselSources(): { createdCount: number; updatedCount: number; removedCount: number; totalCount: number; channelsCount: number; activeProxiesCount: number; totalProxiesCount: number } {
  const db = getDb();
  let createdCount = 0;
  let updatedCount = 0;
  let removedCount = 0;
  let totalCount = 0;

  const allProxies = db.prepare("SELECT * FROM carousel_proxies").all() as any[];
  const carouselChannels = db.prepare("SELECT * FROM carousel_channels").all() as any[];
  const enabledDiscoveryRules = getDiscoveryRules(false);
  const enabledPlatforms = new Set(enabledDiscoveryRules.map((r: any) => normalizePlatform(r.platform)));
  const hasDiscoveryRules = (db.prepare('SELECT COUNT(*) as count FROM carousel_discovery_rules').get() as any).count > 0;

  let carouselGroup = groups.find(g => g.name === "轮播频道");
  if (!carouselGroup) {
    carouselGroup = {
      id: "g_carousel",
      name: "轮播频道"
    };
    groups.push(carouselGroup);
    try {
      const gExists = db.prepare("SELECT id FROM groups WHERE id = ?").get(carouselGroup.id);
      if (!gExists) {
        db.prepare("INSERT INTO groups (id, name) VALUES (?, ?)").run(carouselGroup.id, carouselGroup.name);
      }
    } catch (e) {}
  }

  const activeProxiesByPlatform = new Map<string, string[]>();
  let totalActiveProxies = 0;

  for (const proxy of allProxies) {
    if (!proxy.urlTemplate) continue;
    const normPlat = normalizePlatform(proxy.platform);
    const isBlocked = (hasDiscoveryRules && !enabledPlatforms.has(normPlat)) || isUrlBlockedByDisabledRules(proxy.urlTemplate, proxy.platform);
    
    if (proxy.status === 'active' && !isBlocked) {
      totalActiveProxies++;
      if (!activeProxiesByPlatform.has(normPlat)) {
        activeProxiesByPlatform.set(normPlat, []);
      }
      const list = activeProxiesByPlatform.get(normPlat)!;
      const tpl = proxy.urlTemplate.trim();
      if (!list.includes(tpl)) {
        list.push(tpl);
      }
    }
  }

  const channelMappingsMap = new Map<string, { channel: any; mappings: { platform: string; originalId: string }[] }>();

  for (const cc of carouselChannels) {
    if (!cc.name || !cc.platform || !cc.originalId) continue;
    const normPlat = normalizePlatform(cc.platform);
    const origId = String(cc.originalId).trim();

    let dbChannel = db.prepare("SELECT * FROM channels WHERE id = ?").get(cc.channelId) as any;
    if (!dbChannel && cc.name) {
      dbChannel = db.prepare("SELECT * FROM channels WHERE name = ?").get(cc.name) as any;
      if (dbChannel) {
        db.prepare("UPDATE carousel_channels SET channelId = ? WHERE id = ?").run(dbChannel.id, cc.id);
      }
    }
    if (!dbChannel) {
      const nid = crypto.randomUUID();
      const defaultGroupIds = JSON.stringify([carouselGroup.id]);
      dbChannel = { id: nid, name: cc.name, groupIds: defaultGroupIds, alias: '[]', logo: '', epgId: '' };
      db.prepare("INSERT INTO channels (id, name, logo, groupIds, alias, epgId) VALUES (?, ?, ?, ?, ?, ?)").run(
        dbChannel.id, dbChannel.name, dbChannel.logo, dbChannel.groupIds, dbChannel.alias, dbChannel.epgId
      );
      db.prepare("UPDATE carousel_channels SET channelId = ? WHERE id = ?").run(dbChannel.id, cc.id);
    } else {
      if (dbChannel.name && dbChannel.name !== cc.name) {
        db.prepare("UPDATE carousel_channels SET name = ? WHERE id = ?").run(dbChannel.name, cc.id);
        cc.name = dbChannel.name;
      }
      try {
        let gIds = JSON.parse(dbChannel.groupIds || "[]");
        if (!Array.isArray(gIds) || gIds.length === 0) {
          gIds = [carouselGroup.id];
          db.prepare("UPDATE channels SET groupIds = ? WHERE id = ?").run(JSON.stringify(gIds), dbChannel.id);
        }
      } catch (e) {}
    }

    if (!channelMappingsMap.has(dbChannel.id)) {
      channelMappingsMap.set(dbChannel.id, { channel: dbChannel, mappings: [] });
    }
    const chEntry = channelMappingsMap.get(dbChannel.id)!;
    if (!chEntry.mappings.some(m => m.platform === normPlat && m.originalId === origId)) {
      chEntry.mappings.push({ platform: normPlat, originalId: origId });
    }
  }

  const deleteSourceStmt = db.prepare("DELETE FROM sources WHERE id = ?");
  const insertSourceStmt = db.prepare("INSERT INTO sources (id, channelId, url, province, isp, status, isolated) VALUES (?, ?, ?, ?, ?, ?, ?)");

  const disabledOrFailedUrls = new Set<string>();
  const allSourcesInDb = db.prepare("SELECT id, channelId, url, status, isolated, latency FROM sources").all() as any[];
  for (const src of allSourcesInDb) {
    if (!src.url) {
      deleteSourceStmt.run(src.id);
      removedCount++;
      continue;
    }
    const parsed = parseCarouselUrl(src.url);
    const isCarousel = !!parsed.platform || /\/(?:migu|mg|cntv|cctv|douyu|huya|bilibili|bili|yy|kuaishou|ks|douyin)\//i.test(src.url);

    if (isCarousel) {
      const isIsolated = src.isolated === 1 || src.isolated === true || src.isolated === '1';
      const isInvalid = src.status === 'inactive' || src.status === 'disabled' || src.status === 'error' || src.status === 'failed' || src.latency === 9999 || src.latency === -1;

      if (isIsolated || isInvalid) {
        if (src.channelId && src.url) {
          disabledOrFailedUrls.add(`${src.channelId}:${src.url}`);
        }
        deleteSourceStmt.run(src.id);
        removedCount++;
      }
    }
  }

  for (const [channelId, { channel, mappings }] of channelMappingsMap.entries()) {
    const expectedCarouselUrls = new Set<string>();

    for (const mapping of mappings) {
      const activeTemplates = activeProxiesByPlatform.get(mapping.platform) || [];
      for (const tpl of activeTemplates) {
        const targetUrl = formatProxyUrl(tpl, mapping.originalId);
        if (targetUrl) {
          expectedCarouselUrls.add(targetUrl);
        }
      }
    }

    const existingSources = db.prepare("SELECT id, url, status, isolated FROM sources WHERE channelId = ?").all(channelId) as any[];
    const satisfiedUrls = new Set<string>();

    for (const src of existingSources) {
      if (!src.url) {
        deleteSourceStmt.run(src.id);
        removedCount++;
        continue;
      }

      const parsed = parseCarouselUrl(src.url);
      const isCarouselStream = !!parsed.platform || /\/(?:migu|mg|cntv|cctv|douyu|huya|bilibili|bili|yy|kuaishou|ks|douyin)\//i.test(src.url);

      if (isCarouselStream) {
        const isIsolated = src.isolated === 1 || src.isolated === true || src.isolated === '1';
        const isInvalid = src.status === 'inactive' || src.status === 'disabled' || src.status === 'error' || src.status === 'failed';

        if (!isIsolated && !isInvalid && expectedCarouselUrls.has(src.url) && !satisfiedUrls.has(src.url)) {
          satisfiedUrls.add(src.url);
          totalCount++;
        } else {
          deleteSourceStmt.run(src.id);
          removedCount++;
        }
      }
    }

    for (const expectedUrl of expectedCarouselUrls) {
      const key = `${channelId}:${expectedUrl}`;
      if (!satisfiedUrls.has(expectedUrl) && !disabledOrFailedUrls.has(key)) {
        insertSourceStmt.run(crypto.randomUUID(), channelId, expectedUrl, '', '', 'active', 0);
        satisfiedUrls.add(expectedUrl);
        createdCount++;
        totalCount++;
      }
    }
  }

  db.exec("DELETE FROM sources WHERE rowid NOT IN (SELECT MIN(rowid) FROM sources GROUP BY channelId, url)");
  db.exec("DELETE FROM channels WHERE id NOT IN (SELECT DISTINCT channelId FROM sources) AND id NOT IN (SELECT DISTINCT channelId FROM carousel_channels)");

  loadData();
  saveDataSync();

  return {
    createdCount,
    updatedCount,
    removedCount,
    totalCount,
    channelsCount: channelMappingsMap.size,
    activeProxiesCount: totalActiveProxies,
    totalProxiesCount: allProxies.length
  };
}
