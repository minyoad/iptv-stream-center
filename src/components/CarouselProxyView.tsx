import React, { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Check, AlertCircle, RefreshCw, X, PlayCircle, Settings, Search , Download } from "lucide-react";
import { authFetch as fetch } from "../utils/api";

export const CarouselProxyView = ({ fetchData }: { fetchData: () => void }) => {
  const [proxies, setProxies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ platform: "yy", urlTemplate: "", status: "active" });
  const [testMode, setTestMode] = useState(false);
  const [testForm, setTestForm] = useState({ platform: "yy", originalId: "" });
  const [testResults, setTestResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"platform" | "urlTemplate">("platform");
  
  const [testing, setTesting] = useState(false);
  const [presets, setPresets] = useState<any>({});
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetForm, setPresetForm] = useState("");

  useEffect(() => {
    loadData();
    fetchSettings();
  }, []);

  const loadData = async () => {
    try {
      const res = await fetch("/api/carousel-proxies");
      const data = await res.json();
      setProxies(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setProxies([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.carouselProxyPresets) {
        setPresets(data.carouselProxyPresets);
      }
    } catch(e) {
      console.error(e);
    }
  };

  const savePresets = async () => {
    try {
      let parsed = JSON.parse(presetForm);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carouselProxyPresets: parsed })
      });
      const data = await res.json();
      if (data.carouselProxyPresets) {
        setPresets(data.carouselProxyPresets);
      }
      setIsPresetModalOpen(false);
    } catch(e) {
      alert("JSON 格式错误，请检查！\n" + e.message);
    }
  };

  const saveProxy = async () => {
    if (!form.urlTemplate) return alert("Please enter a URL template");
    try {
      if (editingId) {
        await fetch(`/api/carousel-proxies/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form)
        });
      } else {
        await fetch("/api/carousel-proxies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form)
        });
      }
      setEditingId(null);
      setForm({ platform: "yy", urlTemplate: "", status: "active" });
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteProxy = async (id: string) => {
    try {
      await fetch(`/api/carousel-proxies/${id}`, { method: "DELETE" });
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTest = async () => {
    if (!testForm.originalId) return alert("请输入测试用的直播间 ID");
    setTesting(true);
    setTestResults([]);
    try {
      const res = await fetch("/api/carousel/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testForm)
      });
      const data = await res.json();
      setTestResults(data.results || []);
    } catch(e) {
      console.error(e);
    } finally {
      setTesting(false);
    }
  };

  

  
    return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-base font-bold text-slate-800 flex items-center">
            <RefreshCw className="w-5 h-5 mr-2 text-indigo-500" />
            轮播直播源代理管理
          </h2>
          <button 
             onClick={() => setTestMode(!testMode)}
             className={`px-4 py-2 rounded-lg text-sm font-bold transition ${testMode ? 'bg-slate-200 text-slate-700' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
          >
             {testMode ? "返回管理" : "代理可用性批量测试"}
          </button>
        </div>

        {testMode ? (
          <div className="p-6">
             <div className="flex gap-4 mb-6">
                <div className="w-48">
                  <label className="block text-xs font-bold text-slate-500 mb-1">所属平台</label>
                  <select 
                    value={testForm.platform} 
                    onChange={e => setTestForm({...testForm, platform: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="yy">YY 直播</option>
                    <option value="douyu">斗鱼 直播</option>
                    <option value="huya">虎牙 直播</option>
                    <option value="bilibili">B站</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 mb-1">直播间 ID</label>
                  <input 
                    type="text" 
                    value={testForm.originalId}
                    onChange={e => setTestForm({...testForm, originalId: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="例如: 12345"
                  />
                </div>
             </div>

             <div className="flex gap-2 items-center mb-6 overflow-x-auto pb-2">
                <span className="text-xs font-bold text-slate-400 whitespace-nowrap">快速填入预设 ID进行测试：</span>
                {(presets[testForm.platform] || []).map((preset: any, idx: number) => (
                  <button key={idx} onClick={() => setTestForm({...testForm, originalId: preset.id})} className="px-2 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded text-xs font-bold transition whitespace-nowrap">
                    {preset.name}({preset.id})
                  </button>
                ))}
                {(presets[testForm.platform] || []).length === 0 && <span className="text-xs text-slate-400">暂无预设</span>}
                
                <button onClick={() => {
                   setPresetForm(JSON.stringify(presets, null, 2));
                   setIsPresetModalOpen(true);
                }} className="ml-auto p-1.5 text-slate-400 hover:text-indigo-600 transition shrink-0" title="配置预设ID">
                   <Settings className="w-4 h-4" />
                </button>
             </div>
             
             <button 
               onClick={handleTest}
               disabled={testing}
               className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 flex items-center shadow-sm disabled:opacity-50"
             >
               {testing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
               {testing ? "正在逐个检测代理..." : "开始批量检测"}
             </button>

             {testResults.length > 0 && (
               <div className="mt-8">
                  <h3 className="font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">检测报告</h3>
                  <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-200">
                     <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100 text-slate-500 font-bold text-xs">
                           <tr>
                              <th className="px-4 py-3">代理 URL</th>
                              <th className="px-4 py-3">响应状态</th>
                              <th className="px-4 py-3 text-right">延迟</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                           {testResults.map((r, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                 <td className="px-4 py-3 font-mono text-xs break-all">{r.url}</td>
                                 <td className="px-4 py-3">
                                    {r.status === 'active' 
                                      ? <span className="inline-flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded"><Check className="w-3 h-3 mr-1" />可用</span>
                                      : <span className="inline-flex items-center text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded"><AlertCircle className="w-3 h-3 mr-1" />失效</span>
                                    }
                                 </td>
                                 <td className="px-4 py-3 text-right font-mono text-xs">
                                    {r.latency ? `${r.latency}ms` : '-'}
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </div>
             )}
          </div>
        ) : (
          <div className="p-0">
             <div className="p-4 bg-white border-b border-slate-100 flex flex-wrap items-center gap-4 justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" placeholder="搜索代理URL或平台..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white transition" />
                  </div>
                  <select value={sortKey} onChange={e => setSortKey(e.target.value as any)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold">
                    <option value="platform">按平台排序</option>
                    <option value="urlTemplate">按URL排序</option>
                  </select>
                </div>
                
                
                <button
                   onClick={async () => {
                     setTesting(true);
                     try {
                        const res = await fetch("/api/carousel/test-all", { method: "POST" });
                        const data = await res.json();
                        if (data.success) {
                           alert(`检测完成，共检测了 ${data.count} 个代理。`);
                           fetchData();
                        } else {
                           alert(data.error || "检测失败");
                        }
                     } catch(e) {
                        alert("检测请求失败");
                     } finally {
                        setTesting(false);
                     }
                  }}
                  disabled={testing}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center shadow-sm disabled:opacity-50"
                >
                  {testing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  {testing ? "正在自动检测..." : "一键批量测活"}
                </button>
             </div>
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                   <tr>
                      <th className="px-4 py-3">平台</th>
                      <th className="px-4 py-3">代理模板 ({}为频道ID)</th>
                      <th className="px-4 py-3">状态</th>
                      <th className="px-4 py-3 text-right">操作</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {(Array.isArray(proxies) ? proxies : [])
                       .filter(p => (p.urlTemplate || "").toLowerCase().includes(searchQuery.toLowerCase()) || (p.platform || "").includes(searchQuery))
                       .sort((a, b) => sortKey === "urlTemplate" ? (a.urlTemplate || "").localeCompare(b.urlTemplate || "") : (a.platform || "").localeCompare(b.platform || ""))
                       .map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                         <td className="px-4 py-3">
                            <span className="font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded uppercase text-xs">
                               {p.platform}
                            </span>
                         </td>
                         <td className="px-4 py-3 text-xs font-mono text-slate-600 break-all max-w-sm">
                            {p.urlTemplate}
                         </td>
                         <td className="px-4 py-3 text-xs font-bold">
                            {p.status === 'active' 
                               ? <span className="inline-flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded"><Check className="w-3 h-3 mr-1" />可用</span>
                               : <span className="inline-flex items-center text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded"><AlertCircle className="w-3 h-3 mr-1" />失效</span>
                            }
                         </td>
                         <td className="px-4 py-3 text-right">
                            <button onClick={() => {
                               setEditingId(p.id);
                               setForm({ platform: p.platform, urlTemplate: p.urlTemplate, status: p.status });
                            }} className="p-1.5 text-slate-400 hover:text-indigo-600 transition">
                               <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteProxy(p.id)} className="p-1.5 text-slate-400 hover:text-rose-600 transition ml-2">
                               <Trash2 className="w-4 h-4" />
                            </button>
                         </td>
                      </tr>
                   ))}
                   {proxies.length === 0 && (
                     <tr><td colSpan={4} className="text-center py-8 text-slate-400">暂无代理数据</td></tr>
                   )}
                </tbody>
             </table>
             <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <label className="block text-xs font-bold text-slate-500 mb-1">平台</label>
                  <select 
                    value={form.platform} 
                    onChange={e => setForm({...form, platform: e.target.value})}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="yy">YY</option>
                    <option value="douyu">斗鱼</option>
                    <option value="huya">虎牙</option>
                    <option value="bilibili">B站</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-bold text-slate-500 mb-1">代理模板 URL (使用 {'{}'} 代替 ID)</label>
                  <input 
                    type="text" 
                    value={form.urlTemplate}
                    onChange={e => setForm({...form, urlTemplate: e.target.value})}
                    placeholder="例如: https://lunbo.freetv.top/yy/{}"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <button 
                  onClick={saveProxy}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center shrink-0"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  {editingId ? "保存修改" : "添加代理模板"}
                </button>
                {editingId && (
                  <button onClick={() => {
                     setEditingId(null);
                     setForm({ platform: "yy", urlTemplate: "", status: "active" });
                  }} className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-300 shrink-0">
                    取消
                  </button>
                )}
             </div>
          </div>
        )}
      </div>

      {isPresetModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
               <h3 className="font-bold text-slate-800">配置测试预设 ID (JSON 格式)</h3>
               <button onClick={() => setIsPresetModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition">
                 <X className="w-5 h-5" />
               </button>
            </div>
            <div className="p-4">
               <textarea 
                 value={presetForm} 
                 onChange={e => setPresetForm(e.target.value)}
                 className="w-full h-64 bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-mono focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                 spellCheck={false}
               />
               <p className="text-xs text-slate-500 mt-2">请按照严格的 JSON 格式填写预设，键为平台标识 (yy, douyu, huya, bilibili 等)。</p>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
               <button onClick={() => setIsPresetModalOpen(false)} className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-300 transition">
                 取消
               </button>
               <button onClick={savePresets} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 transition">
                 保存配置
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
