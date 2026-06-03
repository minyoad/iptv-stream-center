export interface LiveSource {
  id: string;
  url: string;
  province: string;
  isp: string;
  status: "active" | "inactive" | "unknown" | "checking";
  latency?: number;
  lastChecked?: string;
  clientIspReported?: string;
  clientProvinceReported?: string;
}

export interface Group {
  id: string;
  name: string;
}

export interface Channel {
  id: string;
  name: string;
  logo: string;
  groupIds: string[];
  alias: string[];
  epgId: string;
  sources: LiveSource[];
}

export interface SyncConfig {
  id: string;
  name: string;
  url: string;
  type: "m3u" | "txt";
  autoSync: boolean;
  syncInterval: number; // in hours
  lastSynced?: string;
  status: "success" | "failed" | "never";
  message?: string;
  disabled?: boolean;
  consecutiveFailures?: number;
  contentHash?: string;
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
  results: {
    id: string;
    channelId: string;
    url: string;
    status: "active" | "inactive";
    latency?: number;
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
