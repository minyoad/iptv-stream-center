import React, { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Search, Link as LinkIcon, Save, RefreshCw, Wand2, CheckSquare, X } from "lucide-react";

export const CarouselChannelView = ({ fetchData, channelsData = [] }: { fetchData: () => void, channelsData?: any[] }) => {
  const [channels, setChannels] = useState<any[]>([]);
  const [unregistered, setUnregistered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", channelId: "", platform: "yy", originalId: "" });
  const [activeTab, setActiveTab] = useState<"registry" | "unregistered" | "rules">("registry");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "platform">("platform");
  const [rules, setRules] = useState<any[]>([]);
  const [ruleForm, setRuleForm] = useState({ platform: "yy", keyword: "" });
  const [applying, setApplying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRegistryIds, setSelectedRegistryIds] = useState<string[]>([]);
  const [selectedUnregIds, setSelectedUnregIds] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
        const [res1, res2, res3] = await Promise.all([
          fetch("/api/carousel-channels"),
          fetch("/api/carousel-channels-unregistered"),
          fetch("/api/carousel-discovery-rules")
        ]);
        setChannels(await res1.json());
        setUnregistered(await res2.json());
        setRules(await res3.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const saveChannel = async () => {
    if (!form.name || !form.platform || !form.originalId) return alert("Please fill all fields");
    const existing = channelsData?.find(c => c.name === form.name);
    const payload = { ...form, channelId: existing ? existing.id : "" };
    try {
      if (editingId) {
        await fetch(`/api/carousel-channels/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        await fetch("/api/carousel-channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      setEditingId(null);
      setForm({ name: "", channelId: "", platform: "yy", originalId: "" });
      setIsModalOpen(false);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteChannel = async (id: string) => {
    try {
      await fetch(`/api/carousel-channels/${id}`, { method: "DELETE" });
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const saveRule = async () => {
    if (!ruleForm.platform || !ruleForm.keyword) return alert("Please fill all fields");
    try {
      await fetch("/api/carousel-discovery-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleForm)
      });
      setRuleForm({ platform: "yy", keyword: "" });
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteRule = async (id: string) => {
    try {
      await fetch(`/api/carousel-discovery-rules/${id}`, { method: "DELETE" });
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleBatchDeleteRegistry = async () => {
    if (selectedRegistryIds.length === 0) return;
    try {
      await fetch('/api/carousel-channels/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRegistryIds })
      });
      setSelectedRegistryIds([]);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleBatchCreateUnregistered = async () => {
    if (selectedUnregIds.length === 0) return;
    const itemsToCreate = unregistered
      .filter(u => selectedUnregIds.includes(`${u.platform}_${u.originalId}`))
      .map(u => ({
         name: u.sampleNames[0] || `${u.platform}_${u.originalId}`,
         platform: u.platform,
         originalId: u.originalId
      }));
    try {
      await fetch('/api/carousel-channels/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToCreate })
      });
      setSelectedUnregIds([]);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const applyToExisting = async () => {
    setApplying(true);
    try {
      const res = await fetch("/api/carousel-channels-apply", { method: "POST", headers: { "Content-Type": "application/json" }});
      const data = await res.json();
      alert(`成功整理了 ${data.updatedCount} 个直播源！`);
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setApplying(false);
    }
  };

  const toggleSelectRegistry = (id: string) => {
    setSelectedRegistryIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleSelectAllRegistry = () => {
    if (selectedRegistryIds.length === channels.length && channels.length > 0) {
      setSelectedRegistryIds([]);
    } else {
      setSelectedRegistryIds(channels.map(c => c.id));
    }
  };

  const toggleSelectUnreg = (key: string) => {
    setSelectedUnregIds(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]);
  };
  const toggleSelectAllUnreg = () => {
    if (selectedUnregIds.length === unregistered.length && unregistered.length > 0) {
      setSelectedUnregIds([]);
    } else {
      setSelectedUnregIds(unregistered.map(u => `${u.platform}_${u.originalId}`));
    }
  };

  

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="text-base font-bold text-slate-800 flex items-center">
            <LinkIcon className="w-5 h-5 mr-2 text-indigo-500" />
            轮播频道映射管理
          </h2>
          <div className="flex gap-2">
            <button 
              onClick={applyToExisting}
              disabled={applying}
              className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-bold hover:bg-emerald-100 flex items-center"
            >
              {applying ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1.5" />}
              根据映射自动整理所有频道
            </button>
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button 
                 onClick={() => setActiveTab("registry")}
                 className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${activeTab === "registry" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                 映射列表
              </button>
              <button 
                 onClick={() => setActiveTab("unregistered")}
                 className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${activeTab === "unregistered" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                 未识别项发现 ({activeTab === "unregistered" ? unregistered.length : '?'})
              </button>
              <button 
                 onClick={() => setActiveTab("rules")}
                 className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${activeTab === "rules" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                 特征发现规则
              </button>
            </div>
          </div>
        </div>

        {activeTab === "rules" ? (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex items-end gap-3">
                <div className="w-48">
                  <label className="block text-xs font-bold text-slate-500 mb-1">平台标识</label>
                  <select 
                    value={ruleForm.platform} 
                    onChange={e => setRuleForm({...ruleForm, platform: e.target.value})}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"
                  >
                    <option value="yy">YY 直播 (yy)</option>
                    <option value="douyu">斗鱼 (douyu)</option>
                    <option value="huya">虎牙 (huya)</option>
                    <option value="bilibili">B站 (bilibili)</option>
                  </select>
                </div>
                <div className="w-64">
                  <label className="block text-xs font-bold text-slate-500 mb-1">URL 特征关键词</label>
                  <input 
                    type="text" 
                    value={ruleForm.keyword}
                    onChange={e => setRuleForm({...ruleForm, keyword: e.target.value})}
                    placeholder="例如: /yy/ 或 dy.php"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <button 
                  onClick={saveRule}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  添加发现规则
                </button>
             </div>
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                   <tr>
                      <th className="px-4 py-3 w-32">平台</th>
                      <th className="px-4 py-3">识别特征 (URL 包含该关键词即触发)</th>
                      <th className="px-4 py-3 text-right">操作</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {rules.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                         <td className="px-4 py-3">
                            <span className="font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded uppercase text-xs">
                               {r.platform}
                            </span>
                         </td>
                         <td className="px-4 py-3 font-mono font-bold text-indigo-600">
                            {r.keyword}
                         </td>
                         <td className="px-4 py-3 text-right">
                            <button onClick={() => deleteRule(r.id)} className="p-1.5 text-slate-400 hover:text-rose-600 transition">
                               <Trash2 className="w-4 h-4" />
                            </button>
                         </td>
                      </tr>
                   ))}
                   {rules.length === 0 && (
                     <tr><td colSpan={3} className="text-center py-8 text-slate-400">暂无特征发现规则</td></tr>
                   )}
                </tbody>
             </table>
          </div>
        ) : activeTab === "registry" ? (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索频道名称、平台、或直播间 ID..."
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button 
                  onClick={() => {
                    setEditingId(null);
                    setForm({ name: "", channelId: "", platform: "yy", originalId: "" });
                    setIsModalOpen(true);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center shadow-sm transition"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  添加映射
                </button>
             </div>
             
             {selectedRegistryIds.length > 0 && (
               <div className="bg-indigo-50 border-b border-indigo-100 p-3 px-4 flex justify-between items-center">
                 <span className="text-sm font-bold text-indigo-700">已选择 {selectedRegistryIds.length} 个映射</span>
                 <button 
                   onClick={handleBatchDeleteRegistry}
                   className="px-3 py-1.5 bg-rose-100 text-rose-600 hover:bg-rose-200 rounded text-xs font-bold transition flex items-center"
                 >
                   <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                   批量删除
                 </button>
               </div>
             )}
             
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                   <tr>
                      <th className="px-4 py-3 w-10">
                        <input 
                           type="checkbox" 
                           checked={selectedRegistryIds.length === channels.length && channels.length > 0}
                           onChange={toggleSelectAllRegistry}
                           className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="px-4 py-3">统一频道名</th>
                      <th className="px-4 py-3">平台</th>
                      <th className="px-4 py-3">直播间 ID</th>
                      <th className="px-4 py-3 text-right">操作</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {channels
                       .filter(p => (p.name || "").toLowerCase().includes(searchQuery.toLowerCase()) || p.originalId.includes(searchQuery) || p.platform.includes(searchQuery))
                       .sort((a, b) => sortKey === "name" ? (a.name || "").localeCompare(b.name || "") : a.platform.localeCompare(b.platform))
                       .map(p => (
                      <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${selectedRegistryIds.includes(p.id) ? 'bg-indigo-50/50' : ''}`}>
                         <td className="px-4 py-3">
                           <input 
                              type="checkbox" 
                              checked={selectedRegistryIds.includes(p.id)}
                              onChange={() => toggleSelectRegistry(p.id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                           />
                         </td>
                         <td className="px-4 py-3 font-bold text-slate-800">
                            {p.name}
                         </td>
                         <td className="px-4 py-3">
                            <span className="font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded uppercase text-xs">
                               {p.platform}
                            </span>
                         </td>
                         <td className="px-4 py-3 text-xs font-mono text-slate-600">
                            {p.originalId}
                         </td>
                         <td className="px-4 py-3 text-right">
                            <button onClick={() => {
                               setEditingId(p.id);
                               setForm({ name: p.name || "", channelId: p.channelId || "", platform: p.platform, originalId: p.originalId });
                               setIsModalOpen(true);
                            }} className="p-1.5 text-slate-400 hover:text-indigo-600 transition">
                               <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteChannel(p.id)} className="p-1.5 text-slate-400 hover:text-rose-600 transition ml-2">
                               <Trash2 className="w-4 h-4" />
                            </button>
                         </td>
                      </tr>
                   ))}
                   {channels.length === 0 && (
                     <tr><td colSpan={5} className="text-center py-8 text-slate-400">暂无映射数据</td></tr>
                   )}
                </tbody>
             </table>
          </div>
        ) : (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-amber-50 text-amber-700 text-sm font-semibold border-b border-amber-100 flex items-center">
                <Search className="w-4 h-4 mr-2 shrink-0" />
                我们在你当前导入的直播源中，发现以下未配置映射的轮播直播间 (平台+ID)。你可以为它们命名，将杂乱的同源频道统一管理。
             </div>
             
             {selectedUnregIds.length > 0 && (
               <div className="bg-indigo-50 border-b border-indigo-100 p-3 px-4 flex justify-between items-center">
                 <span className="text-sm font-bold text-indigo-700">已选择 {selectedUnregIds.length} 个未识别项</span>
                 <button 
                   onClick={handleBatchCreateUnregistered}
                   className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-xs font-bold transition flex items-center shadow-sm"
                 >
                   <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                   一键批量注册 (使用首个常用名)
                 </button>
               </div>
             )}
             
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                   <tr>
                      <th className="px-4 py-3 w-10">
                        <input 
                           type="checkbox" 
                           checked={selectedUnregIds.length === unregistered.length && unregistered.length > 0}
                           onChange={toggleSelectAllUnreg}
                           className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="px-4 py-3 w-1/5">平台 & ID</th>
                      <th className="px-4 py-3">当前检测到的凌乱频道名</th>
                      <th className="px-4 py-3 w-1/4">操作</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {unregistered.map((item, i) => {
                      const key = `${item.platform}_${item.originalId}`;
                      const isSelected = selectedUnregIds.includes(key);
                      return (
                      <tr key={key} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                         <td className="px-4 py-3">
                           <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => toggleSelectUnreg(key)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                           />
                         </td>
                         <td className="px-4 py-3">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded uppercase text-xs">
                                 {item.platform}
                              </span>
                              <span className="text-xs font-mono font-bold text-slate-600 bg-indigo-50 px-2 py-1 rounded">
                                {item.originalId}
                              </span>
                            </div>
                         </td>
                         <td className="px-4 py-3 text-xs text-slate-500">
                            <div className="flex flex-wrap gap-1.5">
                              {item.sampleNames.map((n: string) => (
                                 <span key={n} className="bg-slate-100 px-2 py-1 rounded-md">{n}</span>
                              ))}
                            </div>
                         </td>
                         <td className="px-4 py-3">
                            <button 
                               onClick={() => {
                                  setActiveTab("registry");
                                  setForm({ name: item.sampleNames[0] || "", channelId: "", platform: item.platform, originalId: item.originalId });
                                  setIsModalOpen(true);
                               }}
                               className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded text-xs font-bold hover:bg-indigo-100"
                            >
                               独立编辑映射
                            </button>
                         </td>
                      </tr>
                   )})}
                   {unregistered.length === 0 && (
                     <tr><td colSpan={4} className="text-center py-8 text-slate-400">目前没有未识别的杂乱轮播源</td></tr>
                   )}
                </tbody>
             </table>
          </div>
        )}
        
              </div>
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
               <h3 className="font-bold text-slate-800">{editingId ? "编辑映射" : "添加映射"}</h3>
               <button 
                 onClick={() => {
                   setIsModalOpen(false);
                   setEditingId(null);
                   setForm({ name: "", channelId: "", platform: "yy", originalId: "" });
                 }} 
                 className="text-slate-400 hover:text-slate-600 transition"
               >
                 <X className="w-5 h-5" />
               </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">统一频道名称</label>
                <input 
                  type="text" 
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  placeholder="输入新名称，或选择已有频道"
                  list="channel-suggestions"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <datalist id="channel-suggestions">
                  {channelsData?.map(c => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">平台</label>
                <select 
                  value={form.platform} 
                  onChange={e => setForm({...form, platform: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="yy">YY 直播</option>
                  <option value="douyu">斗鱼</option>
                  <option value="huya">虎牙</option>
                  <option value="bilibili">B站</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">直播间 ID</label>
                <input 
                  type="text" 
                  value={form.originalId}
                  onChange={e => setForm({...form, originalId: e.target.value})}
                  placeholder="例如: 12345"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
               <button 
                 onClick={() => {
                   setIsModalOpen(false);
                   setEditingId(null);
                   setForm({ name: "", channelId: "", platform: "yy", originalId: "" });
                 }} 
                 className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-300 transition"
               >
                 取消
               </button>
               <button 
                 onClick={saveChannel}
                 className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center transition"
               >
                 <Save className="w-4 h-4 mr-1.5" />
                 保存
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
