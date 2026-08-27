import React, { useState, useEffect } from "react";
import {
  Bot,
  Sparkles,
  Key,
  Globe,
  Cpu,
  Sliders,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Zap,
  Info,
  ShieldCheck,
  Check,
  ChevronDown,
  Image as ImageIcon,
  RotateCcw
} from "lucide-react";
import { LogoCdnSource } from "../types";
import { SortableLogoCdnList, DEFAULT_LOGO_CDN_SOURCES } from "./SortableLogoCdnList";

export interface AiConfigData {
  provider: "siliconflow" | "zhipu" | "deepseek" | "aliyun" | "moonshot" | "custom" | "gemini" | "builtin";
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  hasApiKey?: boolean;
  logoBaseFan?: string;
  logoBase112?: string;
  logoSources?: LogoCdnSource[];
}

interface AiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showFeedback: (type: "success" | "error" | "info", msg: string) => void;
  onConfigSaved?: () => void;
}

export const AI_PROVIDERS = [
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow - 推荐国内大模型)",
    tag: "推荐 · 送2000万Tokens · 免费模型",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    models: [
      { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen2.5-7B-Instruct", isFree: true, desc: "阿里通义千问 7B，免算力/永久免费" },
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek-V3", isFree: false, desc: "671B 顶级大模型，推理与分类极强" },
      { id: "THUDM/glm-4-9b-chat", name: "GLM-4-9B-Chat", isFree: true, desc: "智谱开源 9B 模型，免算力/免费" },
      { id: "internlm/internlm2_5-7b-chat", name: "InternLM2.5-7B-Chat", isFree: true, desc: "书生浦语 7B，免算力/免费" },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek-R1", isFree: false, desc: "深度长链思维推理模型" }
    ],
    helpUrl: "https://cloud.siliconflow.cn/account/ak",
    helpText: "国内知名模型托管平台，新用户注册即赠免费额度。Qwen2.5-7B 与 GLM-4-9B 均免算力费用。"
  },
  {
    id: "zhipu",
    name: "智谱 AI (GLM 开放平台)",
    tag: "官方永久免费 · 极速响应",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    models: [
      { id: "glm-4-flash", name: "glm-4-flash", isFree: true, desc: "智谱官方永久免费模型，响应超快" },
      { id: "glm-4-air", name: "glm-4-air", isFree: false, desc: "高性价比轻量级大模型" },
      { id: "glm-4-plus", name: "glm-4-plus", isFree: false, desc: "智谱旗舰级大模型" }
    ],
    helpUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    helpText: "清华智谱开放平台，glm-4-flash 官方永久免费且无需充值即可调用。"
  },
  {
    id: "deepseek",
    name: "DeepSeek (深度求索官方)",
    tag: "顶尖性价比 · 中文理解第一梯队",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: [
      { id: "deepseek-chat", name: "deepseek-chat (DeepSeek-V3)", isFree: false, desc: "最新 DeepSeek-V3 模型，极具性价比" },
      { id: "deepseek-reasoner", name: "deepseek-reasoner (DeepSeek-R1)", isFree: false, desc: "R1 深度逻辑推理模型" }
    ],
    helpUrl: "https://platform.deepseek.com/api_keys",
    helpText: "DeepSeek 官方 API 接口，对频道名称分析和别名推导极其敏锐。"
  },
  {
    id: "aliyun",
    name: "阿里通义千问 (DashScope 百炼)",
    tag: "阿里云官方 · 稳定可靠",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-turbo",
    models: [
      { id: "qwen-turbo", name: "qwen-turbo", isFree: false, desc: "百炼高速经济模型" },
      { id: "qwen-plus", name: "qwen-plus", isFree: false, desc: "百炼增强型通用模型" },
      { id: "qwen-max", name: "qwen-max", isFree: false, desc: "百炼超大规模旗舰大模型" }
    ],
    helpUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    helpText: "阿里云百炼大模型开放平台，支持 OpenAI 兼容 API 规范。"
  },
  {
    id: "moonshot",
    name: "月之暗面 (Kimi / Moonshot)",
    tag: "Kimi 官方 · 擅长精细语义",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    models: [
      { id: "moonshot-v1-8k", name: "moonshot-v1-8k", isFree: false, desc: "Kimi 官方 8K 语义模型" },
      { id: "moonshot-v1-32k", name: "moonshot-v1-32k", isFree: false, desc: "Kimi 官方 32K 模型" }
    ],
    helpUrl: "https://platform.moonshot.cn/console/api-keys",
    helpText: "月之暗面 Kimi 官方开放平台，中文理解和影视资讯知识储备全面。"
  },
  {
    id: "custom",
    name: "自定义兼容接口 / 本地 Ollama",
    tag: "OneAPI / NewAPI / 本地私有化",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen2.5:7b",
    models: [
      { id: "qwen2.5:7b", name: "qwen2.5:7b (Ollama 本地)", isFree: true, desc: "本地通过 Ollama 部署的模型" },
      { id: "custom", name: "自定义模型 ID", isFree: true, desc: "自行填入模型 ID" }
    ],
    helpUrl: "",
    helpText: "支持第三方聚合代理服务、自建反代以及本地 Ollama / vLLM / LMStudio 等。"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    tag: "全球领先 · 支持 JSON Schema",
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-3.7-flash",
    models: [
      { id: "gemini-3.7-flash", name: "gemini-3.7-flash", isFree: false, desc: "高速高精度模型" },
      { id: "gemini-3.1-flash-lite", name: "gemini-3.1-flash-lite", isFree: false, desc: "超低延迟极速模型" }
    ],
    helpUrl: "https://aistudio.google.com/apikey",
    helpText: "系统环境变量中的 GEMINI_API_KEY 可自动激活 Gemini 系列模型。"
  },
  {
    id: "builtin",
    name: "内置免配置智能规则引擎 (无需 API Key)",
    tag: "100% 离线 · 免配置 · 秒级推导",
    baseUrl: "",
    defaultModel: "builtin-engine",
    models: [
      { id: "builtin-engine", name: "内置 IPTV 权威台标与频道知识库", isFree: true, desc: "基于数十万条频道库与规则秒级推导" }
    ],
    helpUrl: "",
    helpText: "完全在本地运行，无需任何外网大模型或 API Key，即刻开箱即用。"
  }
];

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({
  isOpen,
  onClose,
  showFeedback,
  onConfigSaved
}) => {
  const [provider, setProvider] = useState<string>("siliconflow");
  const [apiKey, setApiKey] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("https://api.siliconflow.cn/v1");
  const [model, setModel] = useState<string>("Qwen/Qwen2.5-7B-Instruct");
  const [temperature, setTemperature] = useState<number>(0.1);
  const [logoSources, setLogoSources] = useState<LogoCdnSource[]>(DEFAULT_LOGO_CDN_SOURCES);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [hasStoredKey, setHasStoredKey] = useState<boolean>(false);
  const [savedConfig, setSavedConfig] = useState<{
    provider: string;
    hasApiKey: boolean;
    maskedApiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
  } | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  const getAuthHeaders = (): Record<string, string> => {
    const pwd = localStorage.getItem("iptv_admin_password") || "";
    return {
      "Content-Type": "application/json",
      ...(pwd ? { "x-admin-password": pwd } : {})
    };
  };

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ai/config", { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok && data.success && data.config) {
        const currentSaved = {
          provider: data.config.provider || "siliconflow",
          hasApiKey: Boolean(data.config.hasApiKey),
          maskedApiKey: data.config.maskedApiKey || "",
          baseUrl: data.config.baseUrl || "https://api.siliconflow.cn/v1",
          model: data.config.model || "Qwen/Qwen2.5-7B-Instruct",
          temperature: typeof data.config.temperature === "number" ? data.config.temperature : 0.1
        };
        setSavedConfig(currentSaved);

        setProvider(currentSaved.provider);
        setBaseUrl(currentSaved.baseUrl);
        setModel(currentSaved.model);
        setTemperature(currentSaved.temperature);
        if (Array.isArray(data.config.logoSources) && data.config.logoSources.length > 0) {
          setLogoSources(data.config.logoSources);
        } else {
          const fan = data.config.logoBaseFan || "https://live.fanmingming.com/tv";
          const epg112 = data.config.logoBase112 || "https://epg.112114.xyz/logo";
          setLogoSources([
            {
              id: "fanmingming",
              name: "Fanmingming 官方台标库 (主流央视/卫视/港澳)",
              url: fan,
              type: "fanmingming",
              enabled: true,
              notes: "适配 CCTV-1~17、各大卫视与港澳频道"
            },
            {
              id: "epg112114",
              name: "112114 官方台标库 (地方台/港台/通用备用库)",
              url: epg112,
              type: "epg112114",
              enabled: true,
              notes: "适配地方台、港澳台与特色频道"
            }
          ]);
        }
        setHasStoredKey(currentSaved.hasApiKey);
        setApiKey(currentSaved.maskedApiKey);
      }
    } catch (err) {
      console.error("Failed to load AI config:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (newProviderId: string) => {
    setProvider(newProviderId);
    const preset = AI_PROVIDERS.find((p) => p.id === newProviderId);
    if (preset) {
      if (savedConfig && newProviderId === savedConfig.provider) {
        setBaseUrl(savedConfig.baseUrl || preset.baseUrl);
        setModel(savedConfig.model || preset.defaultModel);
        setHasStoredKey(savedConfig.hasApiKey);
        setApiKey(savedConfig.maskedApiKey || "");
      } else {
        setBaseUrl(preset.baseUrl);
        setModel(preset.defaultModel);
        setHasStoredKey(false);
        setApiKey("");
      }
    }
    setTestResult(null);
  };

  const [syncingLogos, setSyncingLogos] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const firstEnabled = logoSources.find(s => s.enabled && s.url?.trim());
      const activeFan = logoSources.find(s => s.enabled && (s.type === "fanmingming" || s.id === "fanmingming"))?.url || firstEnabled?.url || "";
      const active112 = logoSources.find(s => s.enabled && (s.type === "epg112114" || s.id === "epg112114" || s.type === "custom"))?.url || firstEnabled?.url || "";

      const payload = {
        provider,
        apiKey: apiKey.includes("****") ? undefined : apiKey, // If masked, don't overwrite with mask
        baseUrl,
        model,
        temperature,
        logoSources,
        logoBaseFan: activeFan.trim(),
        logoBase112: active112.trim()
      };

      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback("success", "AI 与官方台标库配置已成功保存！");
        if (onConfigSaved) onConfigSaved();
        onClose();
      } else {
        showFeedback("error", data.error || "保存失败");
      }
    } catch (err: any) {
      showFeedback("error", "网络连接异常，无法保存 AI 配置");
    } finally {
      setSaving(false);
    }
  };

  const handleBatchSyncCdnLogos = async () => {
    setSyncingLogos(true);
    try {
      const firstEnabled = logoSources.find(s => s.enabled && s.url?.trim());
      const activeFan = logoSources.find(s => s.enabled && (s.type === "fanmingming" || s.id === "fanmingming"))?.url || firstEnabled?.url || "";
      const active112 = logoSources.find(s => s.enabled && (s.type === "epg112114" || s.id === "epg112114" || s.type === "custom"))?.url || firstEnabled?.url || "";

      // Save config first
      await fetch("/api/ai/config", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          provider,
          apiKey: apiKey.includes("****") ? undefined : apiKey,
          baseUrl,
          model,
          temperature,
          logoSources,
          logoBaseFan: activeFan.trim(),
          logoBase112: active112.trim()
        })
      });

      const res = await fetch("/api/channels/batch-sync-cdn-logos", {
        method: "POST",
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback("success", data.message || `已成功同步至 ${data.updatedCount} 个频道！`);
        if (onConfigSaved) onConfigSaved();
      } else {
        showFeedback("error", data.error || "同步失败");
      }
    } catch (err: any) {
      showFeedback("error", "网络连接异常，同步台标 CDN 失败");
    } finally {
      setSyncingLogos(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = {
        provider,
        apiKey: apiKey.includes("****") ? undefined : apiKey,
        baseUrl,
        model,
        temperature
      };

      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message || (data.success ? "测试通过" : data.error || "连接失败"),
        latencyMs: data.latencyMs
      });
      if (data.success) {
        showFeedback("success", `AI 连通性测试成功 (${data.latencyMs}ms)`);
      } else {
        showFeedback("error", data.message || "测试失败");
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: "测试请求异常: " + (err.message || err)
      });
      showFeedback("error", "AI 接口请求超时或不可达");
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  const currentProviderConfig = AI_PROVIDERS.find((p) => p.id === provider) || AI_PROVIDERS[0];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans animate-fade-in">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl border border-slate-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-indigo-50/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-800">AI 辅助与国内大模型配置</h3>
                <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                  支持国内模型
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                用于频道元数据推导、台标与别名推荐、智能整理与批量标准化
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
            <span className="text-xs font-semibold">正在读取 AI 配置...</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Provider Selection */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Bot className="w-4 h-4 text-indigo-600" />
                  选择 AI 模型供应商 (AI Provider)
                </span>
                {currentProviderConfig.helpUrl && (
                  <a
                    href={currentProviderConfig.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold"
                  >
                    <span>获取 API Key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AI_PROVIDERS.map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleProviderChange(p.id)}
                      className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-500/20"
                          : "border-slate-200 bg-slate-50/60 hover:bg-slate-100/70 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                              isSelected ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"
                            }`}
                          >
                            {isSelected && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                          </div>
                          <span className="text-xs font-bold text-slate-800">{p.name.split(" ")[0]}</span>
                        </div>
                        {p.tag.includes("免费") && (
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-bold">
                            🆓 免费
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1 pl-5 line-clamp-1">{p.tag}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Provider Help Notice */}
            {currentProviderConfig.helpText && (
              <div className="bg-indigo-50/40 border border-indigo-100/70 rounded-xl p-3 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-[11px] text-indigo-900/80 leading-relaxed font-medium">
                  {currentProviderConfig.helpText}
                </div>
              </div>
            )}

            {/* API Key (if not builtin) */}
            {provider !== "builtin" && provider !== "gemini" && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Key className="w-4 h-4 text-indigo-600" />
                    API Key (密钥) *
                  </span>
                  {hasStoredKey && (
                    <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      已配置密钥 (无需修改请保持星号，将继续使用已存密钥)
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasStoredKey ? "已配置密钥 (无需修改请保持原样，或输入新密钥替换)" : "请输入 API Key..."}
                    className="w-full text-xs p-2.5 pr-14 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-indigo-600 font-bold px-1.5 py-0.5 hover:bg-slate-200/50 rounded cursor-pointer"
                  >
                    {showApiKey ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>
            )}

            {/* Base URL (if custom or standard) */}
            {provider !== "builtin" && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  接口 Base URL
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono text-slate-800"
                />
              </div>
            )}

            {/* Model Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-indigo-600" />
                模型名称 (Model)
              </label>
              {currentProviderConfig.models && currentProviderConfig.models.length > 0 && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {currentProviderConfig.models.map((m) => {
                      const isSelected = model === m.id;
                      return (
                        <button
                          type="button"
                          key={m.id}
                          onClick={() => setModel(m.id)}
                          className={`p-2 text-left rounded-xl border text-xs transition cursor-pointer flex flex-col ${
                            isSelected
                              ? "border-indigo-500 bg-indigo-50 text-indigo-900 font-bold shadow-2xs"
                              : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium"
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="truncate">{m.name}</span>
                            {m.isFree && (
                              <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-bold">
                                免费
                              </span>
                            )}
                          </div>
                          {m.desc && <span className="text-[10px] text-slate-400 font-normal mt-0.5">{m.desc}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="或手动输入任意模型 ID，如 Qwen/Qwen2.5-7B-Instruct"
                    className="w-full text-xs p-2 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono text-slate-800 mt-1"
                  />
                </div>
              )}
            </div>

            {/* Official Logo Library Configuration Section */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4 text-emerald-600" />
                  <span>官方台标库 CDN 根地址配置</span>
                </label>
              </div>

              <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-3">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  内置知识库与 AI 自动补全频道 Logo 时引用的基础 CDN 源。支持修改标题、拖拽调整解析优先级、启用/禁用及添加自建镜像源。
                </p>

                <SortableLogoCdnList
                  logoSources={logoSources}
                  setLogoSources={setLogoSources}
                />

                <div className="pt-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-200/70">
                  <span className="text-[11px] text-slate-500">
                    💡 保存后，系统在页面展示及导出 M3U/EPG 订阅时将自动映射为当前生效的 CDN 地址。
                  </span>
                  <button
                    type="button"
                    onClick={handleBatchSyncCdnLogos}
                    disabled={syncingLogos || saving}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 transition-colors shrink-0 disabled:opacity-50"
                    title="立即将当前启用的台标 CDN 根地址永久同步重写到现有频道数据库中"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingLogos ? "animate-spin" : ""}`} />
                    {syncingLogos ? "正在同步..." : "一键同步至所有已有频道"}
                  </button>
                </div>
              </div>
            </div>

            {/* Test result feedback banner */}
            {testResult && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-semibold ${
                  testResult.success
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-rose-50 border-rose-200 text-rose-900"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span>{testResult.message}</span>
                    {testResult.latencyMs !== undefined && (
                      <span className="font-mono text-[10px] bg-white/70 px-1.5 py-0.2 rounded border">
                        {testResult.latencyMs}ms
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing || saving}
                className="w-full sm:w-1/3 py-2.5 px-3 border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
              >
                {testing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>测试中...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>一键测试连通性</span>
                  </>
                )}
              </button>

              <button
                type="submit"
                disabled={saving || testing}
                className="w-full sm:w-2/3 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>正在保存...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>保存 AI 模型配置</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
