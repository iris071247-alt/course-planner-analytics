import express from "express";
import { createHash } from "node:crypto";

const app = express();
const LIVE_URL = "https://course-planner-publish-production.up.railway.app/";
const ANALYTICS_URL = process.env.PREVIEW_ANALYTICS_URL;
if (!ANALYTICS_URL?.startsWith("https://")) throw new Error("PREVIEW_ANALYTICS_URL is required");
const ORIGIN = new URL(ANALYTICS_URL).origin;
const port = Number(process.env.PORT || 8080);
let cache = null, cachedAt = 0;
const cacheMs = 180000;

async function loadProductionHtml() {
  if (cache && Date.now() - cachedAt < cacheMs) return cache;
  try {
    const resp = await fetch(LIVE_URL, { headers: { "Accept": "text/html" }, signal: AbortSignal.timeout(16000) });
    if (!resp.ok || !resp.headers.get("content-type")?.includes("text/html")) throw new Error("Production did not send valid HTML");
    const productionAddon = '<link rel="stylesheet" href="https://course-analytics-production-974e741c.up.railway.app/site-consent.css"><script defer src="https://course-analytics-production-974e741c.up.railway.app/site-consent.js"></script>';
    const text = (await resp.text()).replace(productionAddon, "");
    if (text.length < 200000 || !/^<!doctype html>/i.test(text.trimStart()) || !text.includes("BUILT_CURRENT_SPRING") || !text.includes("hbAMlCk")) throw new Error("Unexpected production HTML signature");
    const closingBody = text.toLowerCase().lastIndexOf("</body>");
    if (closingBody < text.length - 1500 || closingBody < 10000) throw new Error("Unable to find final closing body tag");
    const html = text.slice(0, closingBody) +
      '<link rel="stylesheet" href="' + ORIGIN + '/site-consent.css">' +
      '<script defer src="' + ORIGIN + '/site-consent.js"></script>' +
      text.slice(closingBody);
    cache = { html, sourceHash: createHash("sha256").update(text).digest("hex"), sourceBytes: Buffer.byteLength(text), previewBytes: Buffer.byteLength(html) };
    cachedAt = Date.now();
    return cache;
  } catch (error) {
    if (cache) return cache;
    throw error;
  }
}
app.disable("x-powered-by");
app.get("/health", (req,res) => res.type("text/plain").send("ok"));
app.get("/preview-info", async (req,res) => {
  try {
    const c = await loadProductionHtml();
    res.set("Cache-Control", "no-store").json({ preview: true, source: LIVE_URL, sourceSha256: c.sourceHash, sourceBytes: c.sourceBytes, previewBytes: c.previewBytes, analyticsOrigin: ORIGIN, generatedAt: new Date(cachedAt).toISOString() });
  } catch (e) { res.status(503).json({ error: "preview source unavailable", detail: String(e.message).slice(0,150) }); }
});
app.get("/preview-consent.js", (req,res) => res.type("text/javascript").set("Cache-Control","no-store").send(CONSENT.replaceAll("__PREVIEW_ANALYTICS_URL__",ORIGIN)));
app.get("/preview-consent.css", (req,res) => res.type("text/css").set("Cache-Control","no-store").send(CSS));
app.get(["/","/index.html"], async (req,res) => {
  try {
    const c = await loadProductionHtml();
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy":"strict-origin-when-cross-origin" });
    res.type("text/html; charset=utf-8").send(c.html);
  } catch (e) { res.status(503).type("text/plain").send("Preview unavailable: " + e.message); }
});
app.listen(port,"0.0.0.0",()=>console.log("Course planner isolated preview listening on",port));
const CONSENT = await (await import("node:fs/promises")).readFile(new URL("./public/preview-consent.js",import.meta.url),"utf8");
const CSS = await (await import("node:fs/promises")).readFile(new URL("./public/preview-consent.css",import.meta.url),"utf8");
