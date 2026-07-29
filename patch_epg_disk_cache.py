import re

with open("server.ts", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add EPG_EXPORT_XML_PATH and EPG_EXPORT_GZ_PATH constants
old_cache_decl = """// In-Memory cache for loaded EPG configurations to avoid reading from disk on every route hit
const loadedEpgCaches: Record<string, EpgCacheIndexed> = {};

let integratedEpgXmlCache: string | null = null;
let integratedEpgXmlGzCache: Buffer | null = null;
let integratedEpgCacheTime = 0;

function invalidateIntegratedEpgCache() {
  integratedEpgXmlCache = null;
  integratedEpgXmlGzCache = null;
  integratedEpgCacheTime = 0;
}"""

new_cache_decl = """// Disk cache paths for exported EPG feeds
const EPG_EXPORT_XML_PATH = path.join(DATA_DIR, "epg_export.xml");
const EPG_EXPORT_GZ_PATH = path.join(DATA_DIR, "epg_export.xml.gz");

// In-Memory cache for loaded EPG configurations to avoid reading from disk on every route hit
const loadedEpgCaches: Record<string, EpgCacheIndexed> = {};

let integratedEpgXmlCache: string | null = null;
let integratedEpgXmlGzCache: Buffer | null = null;
let integratedEpgCacheTime = 0;
let integratedEpgEtag = "";

function invalidateIntegratedEpgCache() {
  integratedEpgXmlCache = null;
  integratedEpgXmlGzCache = null;
  integratedEpgCacheTime = 0;
  integratedEpgEtag = "";
  try {
    if (fs.existsSync(EPG_EXPORT_XML_PATH)) fs.unlinkSync(EPG_EXPORT_XML_PATH);
    if (fs.existsSync(EPG_EXPORT_GZ_PATH)) fs.unlinkSync(EPG_EXPORT_GZ_PATH);
  } catch (_) {}
}"""

if old_cache_decl in content:
    content = content.replace(old_cache_decl, new_cache_decl)
    print("Cache decl replaced successfully.")
else:
    print("WARN: Cache decl not found!")

# 2. Update getOrGenerateIntegratedEpgXml function
old_gen_func = """function getOrGenerateIntegratedEpgXml(): { xml: string; gz: Buffer } {
  const now = Date.now();
  if (integratedEpgXmlCache && integratedEpgXmlGzCache && (now - integratedEpgCacheTime < 15 * 60 * 1000)) {
    return { xml: integratedEpgXmlCache, gz: integratedEpgXmlGzCache };
  }"""

new_gen_func = """function getOrGenerateIntegratedEpgXml(): { xml: string; gz: Buffer; etag: string } {
  const now = Date.now();

  // 1. Check in-memory cache (15 mins TTL)
  if (
    integratedEpgXmlCache &&
    integratedEpgXmlGzCache &&
    integratedEpgEtag &&
    now - integratedEpgCacheTime < 15 * 60 * 1000
  ) {
    return { xml: integratedEpgXmlCache, gz: integratedEpgXmlGzCache, etag: integratedEpgEtag };
  }

  // 2. Check disk file cache (30 mins TTL)
  try {
    if (fs.existsSync(EPG_EXPORT_XML_PATH) && fs.existsSync(EPG_EXPORT_GZ_PATH)) {
      const stats = fs.statSync(EPG_EXPORT_GZ_PATH);
      if (now - stats.mtimeMs < 30 * 60 * 1000) {
        const xml = fs.readFileSync(EPG_EXPORT_XML_PATH, "utf-8");
        const gz = fs.readFileSync(EPG_EXPORT_GZ_PATH);
        const etag = `W/"epg-${Math.floor(stats.mtimeMs)}-${stats.size}"`;

        integratedEpgXmlCache = xml;
        integratedEpgXmlGzCache = gz;
        integratedEpgCacheTime = stats.mtimeMs;
        integratedEpgEtag = etag;

        return { xml, gz, etag };
      }
    }
  } catch (e) {
    console.warn("[EPG DISK CACHE LOAD WARN]", e);
  }"""

if old_gen_func in content:
    content = content.replace(old_gen_func, new_gen_func)
    print("Gen func top replaced successfully.")
else:
    print("WARN: Gen func top not found!")

# Replace return at end of getOrGenerateIntegratedEpgXml
old_gen_return = """  integratedEpgXmlCache = fullXml;
  integratedEpgXmlGzCache = gzBuffer;
  integratedEpgCacheTime = Date.now();

  return { xml: fullXml, gz: gzBuffer };
}"""

new_gen_return = """  const etag = `W/"epg-${now}-${gzBuffer.length}"`;

  integratedEpgXmlCache = fullXml;
  integratedEpgXmlGzCache = gzBuffer;
  integratedEpgCacheTime = now;
  integratedEpgEtag = etag;

  // Persist to disk file cache
  try {
    fs.writeFileSync(EPG_EXPORT_XML_PATH, fullXml, "utf-8");
    fs.writeFileSync(EPG_EXPORT_GZ_PATH, gzBuffer);
  } catch (err) {
    console.error("[EPG DISK CACHE WRITE ERROR]", err);
  }

  return { xml: fullXml, gz: gzBuffer, etag };
}"""

if old_gen_return in content:
    content = content.replace(old_gen_return, new_gen_return)
    print("Gen func return replaced successfully.")
else:
    print("WARN: Gen func return not found!")

# 3. Replace the export route handlers
# Use regex to find app.get("/api/export/epg.xml", ...) up to end of gz route
route_pattern = re.compile(r'// Dynamic EPG XML TV interface.*?(?=\s*// Clean-up and optimization APIs|\s*app\.post\("/api/cleanup)', re.DOTALL)

new_routes = """// Dynamic EPG XML TV interface
  // Returns generic valid XMLTV layout for connected players matching epgIds
  app.get("/api/export/epg.xml", (req, res) => {
    try {
      const { xml, etag } = getOrGenerateIntegratedEpgXml();
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.setHeader("ETag", etag);
      res.send(xml);
    } catch (err: any) {
      console.error("[EPG EXPORT ERROR]", err);
      res.status(500).send("Error generating EPG XML");
    }
  });

  // Compressed XML.GZ EPG feed with file cache and 304 Not Modified support
  app.get("/api/export/epg.xml.gz", (req, res) => {
    try {
      const { gz, etag } = getOrGenerateIntegratedEpgXml();
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", 'attachment; filename="epg.xml.gz"');
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.setHeader("ETag", etag);
      res.end(gz);
    } catch (err: any) {
      console.error("[EPG GZIP EXPORT ERROR]", err);
      res.status(500).send("Internal Server Error during compression");
    }
  });

  """

if route_pattern.search(content):
    content = route_pattern.sub(new_routes, content)
    print("Routes replaced via regex successfully.")
else:
    print("WARN: Export route pattern not found!")

with open("server.ts", "w", encoding="utf-8") as f:
    f.write(content)
print("Patch script finished.")
