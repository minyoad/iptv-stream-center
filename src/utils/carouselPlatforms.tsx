import React from "react";

export interface CarouselPlatformOption {
  value: string;
  label: string;
  shortLabel: string;
  badgeClass: string;
}

export const PRESET_CAROUSEL_PLATFORMS: CarouselPlatformOption[] = [
  { value: "yy", label: "YY 直播 (yy)", shortLabel: "YY 直播", badgeClass: "bg-amber-100 text-amber-800 border-amber-200" },
  { value: "douyu", label: "斗鱼直播 (douyu)", shortLabel: "斗鱼", badgeClass: "bg-orange-100 text-orange-800 border-orange-200" },
  { value: "huya", label: "虎牙直播 (huya)", shortLabel: "虎牙", badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  { value: "bilibili", label: "B站直播 (bilibili)", shortLabel: "B站", badgeClass: "bg-sky-100 text-sky-800 border-sky-200" },
  { value: "kuaishou", label: "快手直播 (kuaishou)", shortLabel: "快手", badgeClass: "bg-rose-100 text-rose-800 border-rose-200" },
  { value: "douyin", label: "抖音直播 (douyin)", shortLabel: "抖音", badgeClass: "bg-slate-800 text-white border-slate-700" },
  { value: "cntv", label: "央视/CNTV (cntv)", shortLabel: "央视", badgeClass: "bg-red-100 text-red-800 border-red-200" },
  { value: "migu", label: "咪咕直播 (migu)", shortLabel: "咪咕", badgeClass: "bg-blue-100 text-blue-800 border-blue-200" },
  { value: "iptv", label: "IPTV通用 (iptv)", shortLabel: "IPTV", badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200" },
];

export const getPlatformInfo = (platform: string) => {
  const norm = (platform || "").toLowerCase().trim();
  const found = PRESET_CAROUSEL_PLATFORMS.find(p => p.value.toLowerCase() === norm);
  if (found) return found;
  return {
    value: norm || "custom",
    label: `${norm.toUpperCase()} (自定义)`,
    shortLabel: norm.toUpperCase(),
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200"
  };
};

export const getPlatformBadge = (platform: string) => {
  const info = getPlatformInfo(platform);
  return (
    <span className={`font-bold px-2.5 py-1 rounded-md text-xs border ${info.badgeClass}`}>
      {info.shortLabel} {platform ? `(${platform})` : ''}
    </span>
  );
};
