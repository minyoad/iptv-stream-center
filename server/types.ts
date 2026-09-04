export interface LiveSource {
  id: string;
  url: string;
  province: string;
  isp: string;
  status: "active" | "inactive" | "unknown" | "checking";
  latency?: number;
  resolution?: string;
  lastChecked?: string;
  clientIspReported?: string;
  clientProvinceReported?: string;
  isolated?: boolean;
  testCount?: number;
  successCount?: number;
  diagMsg?: string;
}

export interface Group {
  id: string;
  name: string;
  isolated?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  logo: string;
  groupIds: string[];
  alias: string[];
  epgId: string;
  description?: string;
  sources: LiveSource[];
  isolated?: boolean;
}

export interface SyncConfig {
  id: string;
  name: string;
  url: string;
  type: "m3u" | "txt";
  autoSync?: boolean;
  syncInterval?: number; // working in hours (e.g. 1, 6, 12, 24)
  lastSynced?: string;
  status: "success" | "failed" | "never" | "syncing";
  message?: string;
  disabled?: boolean;
  consecutiveFailures?: number;
  contentHash?: string;
  isp?: string;
  aliasOnly?: boolean;
}

export interface EpgSource {
  id: string;
  name: string;
  url: string;
  active: boolean;
  lastSynced?: string;
  status: "success" | "failed" | "never" | "syncing";
  message?: string;
}

export interface TestStatus {
  status: "idle" | "running";
  total: number;
  checked: number;
  lastDataUpdate?: number;
  results: {
    id: string;
    channelId: string;
    url: string;
    status: "active" | "inactive";
    latency?: number;
    resolution?: string;
    diagMsg?: string;
  }[];
}

export interface IpGeoApi {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  failCount?: number;
}

export interface EpgProgram {
  start: string;
  stop: string;
  title: string;
  desc: string;
}

export interface EpgEntry {
  displayNames: string[];
  programs: EpgProgram[];
}

export interface EpgCacheIndexed {
  raw: Record<string, EpgEntry>;
  idMap: Map<string, EpgEntry>;
  nameMap: Map<string, EpgEntry>;
}

export interface ExportPlaylistCacheItem {
  content: string;
  etag: string;
  mtimeMs: number;
}

export interface DefaultAliasGroup {
  template: string;
  aliases: string[];
}

export interface CarouselDiscoveryRule {
  id: string;
  platform?: string;
  keyword?: string;
  enabled?: boolean | number;
  [key: string]: any;
}

export interface CarouselDisabledRule {
  id: string;
  pattern: string;
  reason?: string;
  enabled?: boolean | number;
  [key: string]: any;
}

export interface CarouselRule {
  id: string;
  platform?: string;
  keyword?: string;
  pattern?: string;
  type?: string;
  description?: string;
  enabled: boolean | number;
}

export interface CarouselProxy {
  id: string;
  platform: string;
  urlTemplate: string;
  status: string;
}

export interface CarouselChannel {
  id: string;
  channelId: string;
  name: string;
  platform: string;
  originalId: string;
}
