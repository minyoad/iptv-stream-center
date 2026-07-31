const sources = [
  { url: "http://otv.chinamobile.com/xxx", isp: "" },
  { url: "http://chinanet.com/xxx", isp: "其它" },
  { url: "http://example.com", isp: "" }
];

const targetIsp = "中国电信";
const normTargetIsp = targetIsp.trim();

sources.filter(src => {
      let srcIsp = (src.isp || "").trim();
      
      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他") {
        const urlLower = (src.url || "").toLowerCase();
        if (urlLower.includes("chinamobile") || urlLower.includes("cmvideo") || urlLower.includes("cmcc") || urlLower.includes(".yd.")) {
          srcIsp = "移动";
        } else if (urlLower.includes("chinanet") || urlLower.includes("ctcc") || urlLower.includes("telecom") || urlLower.includes(".dx.")) {
          srcIsp = "电信";
        } else if (urlLower.includes("unicom") || urlLower.includes("cucc") || urlLower.includes(".lt.")) {
          srcIsp = "联通";
        }
      }

      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他") {
        return true;
      }
      
      const isBGP = srcIsp.toUpperCase().includes("BGP") || srcIsp.toUpperCase().includes("BPG");
      if (isBGP) {
        return true;
      }
      const sIsp = srcIsp.replace("中国", "");
      const tIsp = normTargetIsp.replace("中国", "");
      console.log(`sIsp: ${sIsp}, tIsp: ${tIsp}`);
      if (sIsp.includes(tIsp) || tIsp.includes(sIsp)) {
        return true;
      }
      return false;
});
