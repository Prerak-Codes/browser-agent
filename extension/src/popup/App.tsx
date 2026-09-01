import { useState, useEffect, useCallback } from "react";
import type { Detection } from "../vision/types";
import type { OCRDetection } from "../ocr/ocr";
import type { SensitiveRegion } from "../privacy/piiDetector";
import type { PrivacyPolicy, PrivacyAction, CustomPattern, LifetimeStats } from "../privacy/policies";
import type { AgentResponse } from "../agent/api";
import type { SanitizedContext } from "../utils/context";
import { detect } from "../vision/detector";
import { initializeOCR, detectText } from "../ocr/ocr";
import { detectSensitiveRegions } from "../privacy/piiDetector";
import { redactImage } from "../privacy/sanitizer";
import {
  getPrivacyPolicy, savePrivacyPolicy,
  getCustomPatterns, addCustomPattern, removeCustomPattern,
  getLifetimeStats, updateLifetimeStats,
  saveSessionState, loadSessionState, clearSessionState,
  BUILT_IN_TYPES,
} from "../privacy/policies";
import { buildSanitizedContext } from "../utils/context";
import { analyzeWithAgent } from "../agent/api";

type Tab = "dashboard" | "settings" | "activity";

interface AuditEntry {
  time: string;
  message: string;
}

const LABELS: Record<string, string> = {
  face: "Face",
  email: "Email",
  phone: "Phone",
  credit_card: "Credit Card",
  password: "Password",
  aadhaar: "Aadhaar",
};

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [hostname, setHostname] = useState("");
  const [status, setStatus] = useState("Idle");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [sanitizedScreenshot, setSanitizedScreenshot] = useState<string | null>(null);
  const [visionDetections, setVisionDetections] = useState<Detection[]>([]);
  const [ocrDetections, setOcrDetections] = useState<OCRDetection[]>([]);
  const [sensitiveRegions, setSensitiveRegions] = useState<SensitiveRegion[]>([]);
  const [policy, setPolicy] = useState<PrivacyPolicy>({});
  const [customPatterns, setCustomPatterns] = useState<CustomPattern[]>([]);
  const [newPatternName, setNewPatternName] = useState("");
  const [newPatternRegex, setNewPatternRegex] = useState("");
  const [patternError, setPatternError] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [agentTask, setAgentTask] = useState("Help me apply to this");
  const [agentResponse, setAgentResponse] = useState<AgentResponse | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [sanitizedContext, setSanitizedContext] = useState<SanitizedContext | null>(null);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats>({
    totalCaptures: 0, totalSanitizations: 0, totalSentToLLM: 0, totalSensitiveRegions: 0,
  });

  const addAudit = useCallback((message: string) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setAuditLog((prev) => [{ time, message }, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    getPrivacyPolicy().then((p) => setPolicy(p));
    getCustomPatterns().then((p) => setCustomPatterns(p));
    getLifetimeStats().then((s) => setLifetimeStats(s));
    chrome.runtime.sendMessage({ action: "getTabInfo" }, (response) => {
      if (response?.success) setHostname(response.hostname);
    });

    loadSessionState().then((state) => {
      if (state) {
        if (state.screenshot) setScreenshot(state.screenshot);
        if (state.sanitizedScreenshot) setSanitizedScreenshot(state.sanitizedScreenshot);
        if (state.sensitiveRegionsJson) setSensitiveRegions(JSON.parse(state.sensitiveRegionsJson));
        if (state.ocrDetectionsJson) setOcrDetections(JSON.parse(state.ocrDetectionsJson));
        if (state.visionDetectionsJson) setVisionDetections(JSON.parse(state.visionDetectionsJson));
        addAudit("Session restored");
      }
    });
  }, []);

  const persistSession = useCallback(async () => {
    await saveSessionState({});
  }, []);

  useEffect(() => {
    if (screenshot || sanitizedScreenshot || sensitiveRegions.length > 0) {
      saveSessionState({
        screenshot,
        sanitizedScreenshot,
        sensitiveRegionsJson: JSON.stringify(sensitiveRegions),
        ocrDetectionsJson: JSON.stringify(ocrDetections),
        visionDetectionsJson: JSON.stringify(visionDetections),
      });
    }
  }, [screenshot, sanitizedScreenshot, sensitiveRegions, ocrDetections, visionDetections]);

  const updateLifetime = async (updates: Partial<LifetimeStats>) => {
    await updateLifetimeStats(updates);
    const s = await getLifetimeStats();
    setLifetimeStats(s);
  };

  const handleCapture = async () => {
    setStatus("Capturing screen...");
    setScreenshot(null);
    setSanitizedScreenshot(null);
    setVisionDetections([]);
    setOcrDetections([]);
    setSensitiveRegions([]);
    setSanitizedContext(null);
    setAgentResponse(null);

    chrome.runtime.sendMessage({ action: "capture" }, async (response) => {
      if (!response?.success) {
        setStatus(`Capture failed: ${response?.error || "Unknown error"}`);
        addAudit(`Screen capture failed: ${response?.error || "Unknown error"}`);
        return;
      }

      setScreenshot(response.image);
      addAudit("Screen captured");
      await updateLifetime({ totalCaptures: 1 });
      setStatus("Running YOLO detection...");

      let yoloResults: Detection[] = [];
      try {
        yoloResults = await detect(response.image);
        setVisionDetections(yoloResults);
        addAudit(`YOLO detected ${yoloResults.length} objects`);
      } catch (err) {
        console.error("[PG] YOLO failed:", err);
        setStatus(`YOLO failed: ${err instanceof Error ? err.message : String(err)}`);
        addAudit("YOLO detection failed, continuing with OCR");
      }

      setStatus("Running OCR...");

      let ocrResults: OCRDetection[] = [];
      try {
        await initializeOCR((msg) => setStatus(msg));
        ocrResults = await detectText(response.image, (msg) => setStatus(msg));
        setOcrDetections(ocrResults);
        addAudit(`OCR detected ${ocrResults.length} text regions`);
      } catch (err) {
        console.error("[PG] OCR failed:", err);
        addAudit("OCR failed, continuing...");
      }

      setStatus("Analyzing privacy...");

      const regions = detectSensitiveRegions(ocrResults, yoloResults, customPatterns);
      setSensitiveRegions(regions);
      await updateLifetime({ totalSensitiveRegions: regions.length });
      addAudit(`${regions.length} sensitive regions detected`);

      if (regions.length > 0) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
          const img = new Image();
          img.src = response.image;
          await new Promise<void>((res) => { img.onload = () => res(); });
          const screenshotW = img.width;
          const screenshotH = img.height;

          const overlayRegions = regions.map((r) => {
            if (r.source === "vision") {
              const scaleX = screenshotW / 640;
              const scaleY = screenshotH / 640;
              return {
                x: r.x * scaleX, y: r.y * scaleY,
                width: r.width * scaleX, height: r.height * scaleY,
                type: r.type, text: r.text || "",
              };
            }
            return { x: r.x, y: r.y, width: r.width, height: r.height, type: r.type, text: r.text || "" };
          });

          chrome.tabs.sendMessage(activeTab.id, {
            action: "renderOverlay",
            regions: overlayRegions,
          });
        }
      }

      const typeCounts: Record<string, number> = {};
      for (const r of regions) {
        typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
      }
      for (const [type, count] of Object.entries(typeCounts)) {
        addAudit(`${count} ${type} region(s) detected`);
      }

      if (regions.length > 0) {
        setStatus("Auto-sanitizing sensitive data...");
        try {
          const sanitized = await redactImage(response.image, regions, policy);
          setSanitizedScreenshot(sanitized);
          addAudit("Auto-sanitized sensitive regions");

          const allOcrTexts = ocrResults.map((r) => r.text).filter((t) => t && t.length > 0);
          const ctx = buildSanitizedContext(agentTask, regions, sanitized, allOcrTexts, hostname, ocrResults);
          setSanitizedContext(ctx);
          addAudit("Context ready for AI analysis");
        } catch (err) {
          console.error("[PG] Auto-sanitize failed:", err);
          addAudit("Auto-sanitize failed");
        }
      } else {
        const allOcrTexts = ocrResults.map((r) => r.text).filter((t) => t && t.length > 0);
        const ctx = buildSanitizedContext(agentTask, [], response.image, allOcrTexts, hostname, ocrResults);
        setSanitizedContext(ctx);
        addAudit("No sensitive data — AI analysis ready");
      }

      setStatus("Analysis complete.");
    });
  };

  const handleSanitize = async () => {
    if (!screenshot) {
      setStatus("Nothing to sanitize. Run capture first.");
      return;
    }

    setStatus("Sanitizing screenshot...");

    try {
      let sanitized = screenshot;
      if (sensitiveRegions.length > 0) {
        sanitized = await redactImage(screenshot, sensitiveRegions, policy);
      }
      setSanitizedScreenshot(sanitized);
      addAudit("Screenshot sanitized");
      await updateLifetime({ totalSanitizations: 1 });

      sensitiveRegions.forEach((region) => {
        const action = policy[region.type] || "mask";
        addAudit(`${region.type} ${action}ed`);
      });

      const allOcrTexts = ocrDetections.map((r) => r.text).filter((t) => t && t.length > 0);
      const ctx = buildSanitizedContext(agentTask, sensitiveRegions, sanitized, allOcrTexts, hostname, ocrDetections);
      setSanitizedContext(ctx);

      addAudit("Sanitized context created");

      setStatus("Sanitization complete.");
    } catch (err) {
      console.error("Sanitization failed:", err);
      setStatus("Sanitization failed.");
      addAudit("Sanitization failed");
    }
  };

  const handleAnalyzeWithAI = async () => {
    if (!sanitizedContext) {
      setStatus("Run capture and sanitize first.");
      return;
    }

    if (!aiEnabled) {
      setStatus("AI access is disabled.");
      addAudit("AI access disabled, request blocked");
      return;
    }

    setAgentLoading(true);
    setAgentResponse(null);
    setAgentError(null);
    setStatus("Sending to AI agent...");
    await updateLifetime({ totalSentToLLM: 1 });
    addAudit("Sanitized context sent to agent");

    try {
      const response = await analyzeWithAgent(sanitizedContext);
      setAgentResponse(response);
      setStatus("Agent response received.");
      addAudit(`Agent proposed action: ${response.action}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setAgentError(msg);
      setStatus("Agent request failed.");
      addAudit(`Agent request failed: ${msg}`);
    } finally {
      setAgentLoading(false);
    }
  };

  const handleApprove = () => {
    addAudit("User approved agent action");
    setAgentResponse(null);
  };

  const handleReject = () => {
    addAudit("User rejected agent action");
    setAgentResponse(null);
  };

  const handlePolicyChange = async (key: string, value: PrivacyAction) => {
    const updated = { ...policy, [key]: value };
    setPolicy(updated);
    await savePrivacyPolicy(updated);
    addAudit(`Policy: ${key} → ${value}`);
  };

  const handleSavePolicy = async () => {
    await savePrivacyPolicy(policy);
    addAudit("Privacy policy saved");
    setStatus("Policy saved.");
  };

  const handleAddPattern = async () => {
    setPatternError("");
    if (!newPatternName.trim() || !newPatternRegex.trim()) {
      setPatternError("Name and regex are required.");
      return;
    }
    const ok = await addCustomPattern(newPatternName.trim(), newPatternRegex.trim());
    if (!ok) {
      setPatternError("Invalid regex or name already exists.");
      return;
    }
    const patterns = await getCustomPatterns();
    setCustomPatterns(patterns);
    const p = await getPrivacyPolicy();
    setPolicy(p);
    setNewPatternName("");
    setNewPatternRegex("");
    addAudit(`Custom pattern "${newPatternName}" added`);
    setStatus("Pattern added.");
  };

  const handleRemovePattern = async (name: string) => {
    await removeCustomPattern(name);
    const patterns = await getCustomPatterns();
    setCustomPatterns(patterns);
    const p = await getPrivacyPolicy();
    setPolicy(p);
    addAudit(`Custom pattern "${name}" removed`);
  };

  const toggleAiAccess = () => {
    setAiEnabled((prev) => {
      const next = !prev;
      addAudit(`AI access ${next ? "enabled" : "disabled"}`);
      return next;
    });
  };

  const privacyScore =
    sensitiveRegions.length > 0
      ? Math.max(50, 100 - sensitiveRegions.length * 3)
      : 100;

  const typeCounts: Record<string, number> = {};
  for (const r of sensitiveRegions) {
    typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  }

  const allPolicyKeys = [
    ...BUILT_IN_TYPES,
    ...customPatterns.map((p) => p.name),
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">&#128737;</span>
          <span className="title">PrivacyGuard AI</span>
        </div>
        <div className="header-right">
          <span className={`status-dot ${aiEnabled ? "on" : "off"}`}></span>
          <span className="status-text">{aiEnabled ? "ON" : "OFF"}</span>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>Dashboard</button>
        <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Settings</button>
        <button className={`tab ${tab === "activity" ? "active" : ""}`} onClick={() => setTab("activity")}>Activity</button>
      </nav>

      {tab === "dashboard" && (
        <div className="content">
          <div className="site-info">
            <div className="site-label">Current Website</div>
            <div className="site-name">{hostname || "Unknown"}</div>
            <div className="protection-status">
              {screenshot ? "Protection Active" : "Ready to Protect"}
            </div>
          </div>

          {screenshot && (
            <div
              className="preview-card"
              onClick={() => {
                const imgSrc = sanitizedScreenshot || screenshot;
                if (imgSrc) chrome.tabs.create({ url: imgSrc });
              }}
              style={{ cursor: "pointer" }}
            >
              <div className="preview-label">
                {sanitizedScreenshot ? "Sanitized Image (click to open full size)" : "Screen Preview"}
              </div>
              <img src={sanitizedScreenshot || screenshot} alt="Screenshot" className="preview-image" />
              {sanitizedScreenshot && <div className="sanitized-badge">Sanitized</div>}
            </div>
          )}

          {(sensitiveRegions.length > 0 || screenshot) && (
            <div className="stats-card">
              <div className="stats-title">Sensitive Data</div>
              <div className="stats-grid">
                {Object.entries(typeCounts).map(([type, count]) => (
                  <div className="stat-row" key={type}>
                    <span>{LABELS[type] || type}</span>
                    <span className="stat-count">{count}</span>
                  </div>
                ))}
                {sensitiveRegions.length === 0 && screenshot && (
                  <div className="stat-row"><span>No sensitive data detected</span></div>
                )}
              </div>
            </div>
          )}

          {screenshot && (
            <div className="score-card">
              <div className="score-label">Privacy Score</div>
              <div className="score-bar-container">
                <div className="score-bar" style={{ width: `${privacyScore}%` }}></div>
              </div>
              <div className="score-value">{privacyScore}%</div>
              <div className="score-checks">
                <span>&#10003; Local Processing</span>
                <span>&#10003; Raw Data Protected</span>
              </div>
            </div>
          )}

          <div className="actions">
            <button className="btn-primary" onClick={handleCapture} disabled={status.includes("Running") || status.includes("Capturing")}>
              Capture &amp; Analyze
            </button>
            <button className="btn-secondary" onClick={handleSanitize} disabled={!screenshot}>
              Sanitize Screen
            </button>
          </div>

          <div className="status-bar">{status}</div>

          {screenshot && (
            <div className="agent-section">
              <div className="agent-title">AI Agent</div>
              <input type="text" className="agent-input" value={agentTask} onChange={(e) => setAgentTask(e.target.value)} placeholder="Describe your task..." />
              <button className="btn-ai" onClick={handleAnalyzeWithAI} disabled={agentLoading || !sanitizedContext || !aiEnabled}>
                {agentLoading ? "Analyzing..." : "Analyze with AI"}
              </button>

              {agentError && <div className="agent-error">{agentError}</div>}

              {agentResponse && (
                <div className="agent-result">
                  <div className="agent-result-title">AI Suggested Action</div>
                  <div className="agent-action"><strong>Action:</strong> {agentResponse.action}</div>
                  {agentResponse.target && (
                    <div className="agent-action"><strong>Target:</strong> {agentResponse.target}</div>
                  )}
                  {Object.keys(agentResponse.fields).length > 0 && (
                    <div className="agent-fields">
                      {Object.entries(agentResponse.fields).map(([key, val]) => (
                        <div key={key} className="agent-field">{key} &rarr; {val}</div>
                      ))}
                    </div>
                  )}
                  <div className="agent-explanation">{agentResponse.explanation}</div>
                  {agentResponse.requires_confirmation && (
                    <div className="agent-warning">&#9888; Requires confirmation</div>
                  )}
                  <div className="agent-buttons">
                    <button className="btn-approve" onClick={handleApprove}>Approve</button>
                    <button className="btn-reject" onClick={handleReject}>Reject</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="content">
          <div className="settings-section">
            <div className="settings-title">Privacy Protection</div>
            {allPolicyKeys.map((key) => (
              <div className="policy-row" key={key}>
                <label>{LABELS[key] || key}{customPatterns.some((p) => p.name === key) ? " (custom)" : ""}</label>
                <select value={policy[key] || "mask"} onChange={(e) => handlePolicyChange(key, e.target.value as PrivacyAction)}>
                  <option value="blur">Blur</option>
                  <option value="mask">Mask</option>
                  <option value="redact">Redact</option>
                  <option value="allow">Allow</option>
                </select>
                {customPatterns.some((p) => p.name === key) && (
                  <button className="btn-remove" onClick={() => handleRemovePattern(key)}>x</button>
                )}
              </div>
            ))}
            <button className="btn-save" onClick={handleSavePolicy}>Save Policy</button>
          </div>

          <div className="settings-section">
            <div className="settings-title">Add Custom Pattern</div>
            <div className="custom-pattern-form">
              <input type="text" className="pattern-input" value={newPatternName} onChange={(e) => setNewPatternName(e.target.value)} placeholder="Pattern name (e.g. pan_card)" />
              <input type="text" className="pattern-input" value={newPatternRegex} onChange={(e) => setNewPatternRegex(e.target.value)} placeholder="Regex (e.g. [A-Z]{5}[0-9]{4}[A-Z])" />
              <button className="btn-save" onClick={handleAddPattern}>Add Pattern</button>
              {patternError && <div className="agent-error">{patternError}</div>}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-title">AI Access</div>
            <div className="policy-row">
              <label>Enable AI Backend</label>
              <button className={`toggle-btn ${aiEnabled ? "" : "off"}`} onClick={toggleAiAccess}>
                {aiEnabled ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          <div className="stats-section">
            <div className="settings-title">Lifetime Statistics</div>
            <div className="stat-row">
              <span>Total Captures</span>
              <span className="stat-count">{lifetimeStats.totalCaptures}</span>
            </div>
            <div className="stat-row">
              <span>Total Sanitizations</span>
              <span className="stat-count">{lifetimeStats.totalSanitizations}</span>
            </div>
            <div className="stat-row">
              <span>Sent to LLM (Lifetime)</span>
              <span className="stat-count">{lifetimeStats.totalSentToLLM}</span>
            </div>
            <div className="stat-row">
              <span>Sensitive Regions Found</span>
              <span className="stat-count">{lifetimeStats.totalSensitiveRegions}</span>
            </div>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="content">
          <div className="settings-title">Recent Activity</div>
          {auditLog.length === 0 ? (
            <div className="empty-log">No activity yet. Capture a screen to start.</div>
          ) : (
            <div className="audit-list">
              {auditLog.map((entry, i) => (
                <div className="audit-entry" key={i}>
                  <span className="audit-time">{entry.time}</span>
                  <span className="audit-msg">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
