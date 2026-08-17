export interface CarouselProxy {
  id: string;
  platform: string; // 'yy' | 'douyu' | 'huya' | 'other'
  urlTemplate: string; // e.g. http://11.xmyxc.cn/api/php/yy.php?id={}
  status: "active" | "inactive" | "unknown";
}

export interface IpGeoApi {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  failCount?: number;
}

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
  isolated?: boolean;
  sources: LiveSource[];
}

export interface SyncConfig {
  id: string;
  name: string;
  url: string;
  type: "m3u" | "txt";
  lastSynced?: string;
  status: "success" | "failed" | "never";
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
  status: "success" | "failed" | "never";
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
  }[];
}

export interface EpgProgram {
  time: string;
  title: string;
}

export interface EpgGuide {
  channelId: string;
  channelName: string;
  date: string;
  epgId: string;
  isSimulated?: boolean;
  programs: EpgProgram[];
}
