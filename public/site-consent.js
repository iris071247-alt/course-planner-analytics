/* Privacy-gated analytics integration. Loaded externally on preview and production. */
(() => {
  "use strict";
  const scriptUrl = document.currentScript?.src;
  if (!scriptUrl) throw new Error("Consent script URL unavailable");
  const ANALYTICS = new URL(scriptUrl).origin;
  const isPreview = location.hostname === "course-preview-preview.up.railway.app";
  const CONSENT_KEY = isPreview ? "course_planner_preview_analytics_consent_v2" : "course_planner_analytics_consent_v2";
  let choice = "";
  let loading = false;
  let queued = [];
  try { choice = localStorage.getItem(CONSENT_KEY) || ""; } catch {}
  function record(type) {
    if (choice !== "yes") return;
    if (window.CourseAnalytics && typeof window.CourseAnalytics.track === "function") {
      window.CourseAnalytics.track(type);
    } else if (queued.length < 20) {
      queued.push(type);
    }
  }
  function activate() {
    if (loading || choice !== "yes") return;
    loading = true;
    const script = document.createElement("script");
    script.id = "cp-preview-tracker-script";
    script.src = ANALYTICS + "/tracker.js";
    script.async = true;
    script.onload = () => {
      const events = queued.splice(0);
      events.forEach(record);
      document.dispatchEvent(new CustomEvent("cp-preview-analytics-ready"));
    };
    script.onerror = () => {
      loading = false;
      console.warn("Preview analytics tracker unavailable");
    };
    document.head.appendChild(script);
  }
  function setChoice(value) {
    const was = choice;
    choice = value;
    try { localStorage.setItem(CONSENT_KEY, value); } catch {}
    document.querySelector("#cp-preview-consent")?.remove();
    if (value === "yes") activate();
    else if (was === "yes") location.reload();
  }
  function showChoice() {
    document.querySelector("#cp-preview-consent")?.remove();
    const panel = document.createElement("aside");
    panel.id = "cp-preview-consent";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "匿名访客统计选择");
    const title = document.createElement("strong");
    title.textContent = isPreview ? "匿名访客统计 · 测试预览" : "匿名访客统计选择";
    const copy = document.createElement("p");
    copy.textContent = "是否同意匿名统计页面浏览与选课功能使用？同意后会在本地保存随机访客标识，并发送访问及操作事件，不采集姓名、学号或课程明细。可随时撤回同意；拒绝不影响选课。";
    const yes = document.createElement("button");
    yes.textContent = "同意匿名统计";
    yes.id = "cp-preview-accept";
    yes.onclick = () => setChoice("yes");
    const no = document.createElement("button");
    no.textContent = "暂不参与";
    no.id = "cp-preview-decline";
    no.onclick = () => setChoice("no");
    panel.append(title,copy,yes,no);
    document.body.append(panel);
  }
  if (isPreview) {
    const badge = document.createElement("div");
    badge.id = "cp-preview-badge";
    badge.textContent = "独立测试预览版 · 不影响正式站点";
    document.body.append(badge);
  }
  const settings = document.createElement("button");
  settings.id = "cp-preview-settings";
  settings.textContent = "统计隐私设置";
  settings.onclick = showChoice;
  document.body.append(settings);
  if (choice === "yes") activate();
  else if (choice !== "no") showChoice();

  // Only count interactions, not outcomes. For exports, clicks are attempts;
  // a successful download cannot be inferred from a click event.
  const map = Object.freeze({
    "manual-entry":"manual_select","startpick":"manual_select",
    "assist-run":"assistant_generate",
    "assist-preview":"timetable_preview",
    "add":"course_added",
    "export-xlsx":"export_attempt","export-csv":"export_attempt",
    "export-html":"export_attempt",
    "assist-export-html":"export_attempt","assist-export-csv":"export_attempt",
    "survey-confirm":"questionnaire_confirm"
  });
  document.addEventListener("click", event => {
    if (choice !== "yes") return;
    const el = event.target.closest?.("[data-act]");
    if (el) {
      const action = el.getAttribute("data-act") || "";
      if (map[action]) record(map[action]);
      if (action === "page" && el.getAttribute("data-v") === "assistant") record("assistant_open");
      if (action === "page" && el.getAttribute("data-v") === "table") record("timetable_preview");
    }
    const a = event.target.closest?.("a[href]");
    if (a && a.href.startsWith("https://v.wjx.cn/")) record("questionnaire_click");
  }, { capture:true });
  Object.defineProperty(window,"CoursePreviewAnalytics",{
    value:Object.freeze({ status:()=>({consent:choice,trackerLoaded:!!window.CourseAnalytics}) }),
    configurable:false
  });
})();
