import { useState, useEffect, useCallback } from "react";
import type { Detection } from "../vision/types";
import type { OCRDetection } from "../ocr/ocr";
import type { SensitiveRegion } from "../privacy/piiDetector";
import type { PrivacyPolicy, PrivacyAction } from "../privacy/policies";
import type { AgentResponse } from "../agent/api";
import type { SanitizedContext } from "../utils/context";
import { detect } from "../vision/detector";
import { initializeOCR, detectText } from "../ocr/ocr";
import { detectSensitiveRegions } from "../privacy/piiDetector";
import { redactImage } from "../privacy/sanitizer";
import { getPrivacyPolicy, savePrivacyPolicy } from "../privacy/policies";
import { buildSanitizedContext } from "../utils/context";
import { analyzeWithAgent } from "../agent/api";

type Tab = "dashboard" | "settings" | "activity";

interface AuditEntry {
  time: string;
  message: string;
}

interface Stats {
  faces: number;
  emails: number;
  phones: number;
  creditCards: number;
  passwords: number;
  aadhaar: number;
  rawSent: number;
  sanitizedSent: number;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [hostname, setHostname] = useState("");
  const [status, setStatus] = useState("Idle");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [sanitizedScreenshot, setSanitizedScreenshot] = useState<string | null>(null);
  const [visionDetections, setVisionDetections] = useState<Detection[]>([]);
  const [ocrDetections, setOcrDetections] = useState<OCRDetection[]>([]);
  const [sensitiveRegions, setSensitiveRegions] = useState<SensitiveRegion[]>([]);
  const [stats, setStats] = useState<Stats>({
    faces: 0, emails: 0, phones: 0, creditCards: 0, passwords: 0, aadhaar: 0,
    rawSent: 0, sanitizedSent: 0,
  });
  const [policy, setPolicy] = useState<PrivacyPolicy>({
    face: "blur", email: "mask", phone: "mask",
    credit_card: "redact", password: "redact", aadhaar: "mask",
  });
  const [aiEnabled, setAiEnabled] = useState(true);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [agentTask, setAgentTask] = useState("Help me fill this form");
  const [agentResponse, setAgentResponse] = useState<AgentResponse | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [sanitizedContext, setSanitizedContext] = useState<SanitizedContext | null>(null);

  const addAudit = useCallback((message: string) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setAuditLog((prev) => [{ time, message }, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    getPrivacyPolicy().then((p) => setPolicy(p));
    chrome.runtime.sendMessage({ action: "getTabInfo" }, (response) => {
      if (response?.success) {
        setHostname(response.hostname);
      }
    });
  }, []);

  const updateStats = (regions: SensitiveRegion[]) => {
    setStats((prev) => ({
      ...prev,
      faces: regions.filter((r) => r.type === "face").length,
      emails: regions.filter((r) => r.type === "email").length,
      phones: regions.filter((r) => r.type === "phone").length,
      creditCards: regions.filter((r) => r.type === "credit_card").length,
      passwords: regions.filter((r) => r.type === "password").length,
      aadhaar: regions.filter((r) => r.type === "aadhaar").length,
    }));
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
      setStatus("Running YOLO detection...");

      let yoloResults: Detection[] = [];
      try {
        console.log("[PG] Starting YOLO detection...");
        yoloResults = await detect(response.image);
        console.log("[PG] YOLO results:", yoloResults.length, yoloResults);
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
        console.log("[PG] OCR results:", ocrResults.length, ocrResults);
        setOcrDetections(ocrResults);
        addAudit(`OCR detected ${ocrResults.length} text regions`);
      } catch (err) {
        console.error("[PG] OCR failed:", err);
        addAudit("OCR failed, continuing...");
      }

      setStatus("Analyzing privacy...");

      console.log("[PG] Running detectSensitiveRegions with", ocrResults.length, "OCR and", yoloResults.length, "vision results");
      const regions = detectSensitiveRegions(
        ocrResults,
        yoloResults
      );
      console.log("[PG] Final sensitive regions:", regions.length);
      setSensitiveRegions(regions);
      updateStats(regions);
      addAudit(`${regions.length} sensitive regions detected`);

      if (regions.length > 0) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const img = new Image();
          img.src = response.image;
          await new Promise<void>((res) => { img.onload = () => res(); });
          const screenshotW = img.width;
          const screenshotH = img.height;
          console.log("[PG] Screenshot dimensions:", screenshotW, "x", screenshotH);

          const overlayRegions = regions.map((r) => {
            if (r.source === "vision") {
              const scaleX = screenshotW / 640;
              const scaleY = screenshotH / 640;
              return {
                x: r.x * scaleX,
                y: r.y * scaleY,
                width: r.width * scaleX,
                height: r.height * scaleY,
                type: r.type,
                text: r.text || "",
              };
            }
            return { x: r.x, y: r.y, width: r.width, height: r.height, type: r.type, text: r.text || "" };
          });

          console.log("[PG] Sending", overlayRegions.length, "regions to overlay");
          for (const r of overlayRegions) {
            console.log(`[PG]   overlay: ${r.type} at (${Math.round(r.x)},${Math.round(r.y)}) ${Math.round(r.width)}x${Math.round(r.height)}`);
          }

          chrome.tabs.sendMessage(tab.id, {
            action: "renderOverlay",
            regions: overlayRegions,
          });
        }
      }

      const counts = {
        email: regions.filter((r) => r.type === "email").length,
        phone: regions.filter((r) => r.type === "phone").length,
        password: regions.filter((r) => r.type === "password").length,
        credit_card: regions.filter((r) => r.type === "credit_card").length,
        aadhaar: regions.filter((r) => r.type === "aadhaar").length,
        face: regions.filter((r) => r.type === "face").length,
      };

      if (counts.email > 0) addAudit(`${counts.email} email(s) detected`);
      if (counts.phone > 0) addAudit(`${counts.phone} phone number(s) detected`);
      if (counts.password > 0) addAudit(`${counts.password} password field(s) detected`);
      if (counts.credit_card > 0) addAudit(`${counts.credit_card} credit card(s) detected`);
      if (counts.aadhaar > 0) addAudit(`${counts.aadhaar} Aadhaar number(s) detected`);
      if (counts.face > 0) addAudit(`${counts.face} face(s) detected`);

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

      sensitiveRegions.forEach((region) => {
        const action = policy[region.type];
        if (action === "blur") addAudit(`${region.type} blurred`);
        else if (action === "mask") addAudit(`${region.type} masked`);
        else if (action === "redact") addAudit(`${region.type} redacted`);
      });

      const allOcrTexts = ocrDetections
        .map((r) => r.text)
        .filter((t) => t && t.length > 0);

      const ctx = buildSanitizedContext(agentTask, sensitiveRegions, sanitized, allOcrTexts);
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

    setStats((prev) => ({ ...prev, sanitizedSent: prev.sanitizedSent + 1 }));
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

  const handlePolicyChange = (key: keyof PrivacyPolicy, value: PrivacyAction) => {
    setPolicy((prev) => ({ ...prev, [key]: value }));
  };

  const handleSavePolicy = async () => {
    await savePrivacyPolicy(policy);
    addAudit("Privacy policy saved");
    setStatus("Policy saved.");
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
      ? Math.max(
          50,
          100 - sensitiveRegions.length * 3
        )
      : 100;

  const counts = {
    face: sensitiveRegions.filter((r) => r.type === "face").length,
    email: sensitiveRegions.filter((r) => r.type === "email").length,
    phone: sensitiveRegions.filter((r) => r.type === "phone").length,
    credit_card: sensitiveRegions.filter((r) => r.type === "credit_card").length,
    password: sensitiveRegions.filter((r) => r.type === "password").length,
    aadhaar: sensitiveRegions.filter((r) => r.type === "aadhaar").length,
  };

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
        <button
          className={`tab ${tab === "dashboard" ? "active" : ""}`}
          onClick={() => setTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={`tab ${tab === "settings" ? "active" : ""}`}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
        <button
          className={`tab ${tab === "activity" ? "active" : ""}`}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
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
                if (imgSrc) {
                  chrome.tabs.create({ url: imgSrc });
                }
              }}
              style={{ cursor: sanitizedScreenshot ? "pointer" : "default" }}
            >
              <div className="preview-label">
                {sanitizedScreenshot ? "Sanitized Image (click to open full size)" : "Screen Preview"}
              </div>
              <img
                src={sanitizedScreenshot || screenshot}
                alt="Screenshot"
                className="preview-image"
              />
              {sanitizedScreenshot && (
                <div className="sanitized-badge">Sanitized</div>
              )}
            </div>
          )}

          {(sensitiveRegions.length > 0 || screenshot) && (
            <div className="stats-card">
              <div className="stats-title">Sensitive Data</div>
              <div className="stats-grid">
                {counts.face > 0 && (
                  <div className="stat-row">
                    <span>&#128100; Faces</span>
                    <span className="stat-count">{counts.face}</span>
                  </div>
                )}
                {counts.email > 0 && (
                  <div className="stat-row">
                    <span>&#9993; Emails</span>
                    <span className="stat-count">{counts.email}</span>
                  </div>
                )}
                {counts.phone > 0 && (
                  <div className="stat-row">
                    <span>&#9742; Phones</span>
                    <span className="stat-count">{counts.phone}</span>
                  </div>
                )}
                {counts.credit_card > 0 && (
                  <div className="stat-row">
                    <span>&#128179; Cards</span>
                    <span className="stat-count">{counts.credit_card}</span>
                  </div>
                )}
                {counts.password > 0 && (
                  <div className="stat-row">
                    <span>&#128274; Passwords</span>
                    <span className="stat-count">{counts.password}</span>
                  </div>
                )}
                {counts.aadhaar > 0 && (
                  <div className="stat-row">
                    <span>&#128196; Aadhaar</span>
                    <span className="stat-count">{counts.aadhaar}</span>
                  </div>
                )}
                {sensitiveRegions.length === 0 && screenshot && (
                  <div className="stat-row">
                    <span>No sensitive data detected</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {screenshot && (
            <div className="score-card">
              <div className="score-label">Privacy Score</div>
              <div className="score-bar-container">
                <div
                  className="score-bar"
                  style={{ width: `${privacyScore}%` }}
                ></div>
              </div>
              <div className="score-value">{privacyScore}%</div>
              <div className="score-checks">
                <span>&#10003; Local Processing</span>
                <span>&#10003; Raw Data Protected</span>
              </div>
            </div>
          )}

          <div className="actions">
            <button
              className="btn-primary"
              onClick={handleCapture}
              disabled={status.includes("Running") || status.includes("Capturing")}
            >
              Capture &amp; Analyze
            </button>
            <button
              className="btn-secondary"
              onClick={handleSanitize}
              disabled={!screenshot}
            >
              Sanitize Screen
            </button>
          </div>

          <div className="status-bar">{status}</div>

          {screenshot && (
            <div className="agent-section">
              <div className="agent-title">AI Agent</div>
              <input
                type="text"
                className="agent-input"
                value={agentTask}
                onChange={(e) => setAgentTask(e.target.value)}
                placeholder="Describe your task..."
              />
              <button
                className="btn-ai"
                onClick={handleAnalyzeWithAI}
                disabled={agentLoading || !sanitizedContext || !aiEnabled}
              >
                {agentLoading ? "Analyzing..." : "Analyze with AI"}
              </button>

              {agentError && (
                <div className="agent-error">{agentError}</div>
              )}

              {agentResponse && (
                <div className="agent-result">
                  <div className="agent-result-title">AI Suggested Action</div>
                  <div className="agent-action">
                    <strong>Action:</strong> {agentResponse.action}
                  </div>
                  {Object.keys(agentResponse.fields).length > 0 && (
                    <div className="agent-fields">
                      {Object.entries(agentResponse.fields).map(([key, val]) => (
                        <div key={key} className="agent-field">
                          {key} &rarr; {val}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="agent-explanation">
                    {agentResponse.explanation}
                  </div>
                  {agentResponse.requires_confirmation && (
                    <div className="agent-warning">
                      &#9888; Requires confirmation
                    </div>
                  )}
                  <div className="agent-buttons">
                    <button className="btn-approve" onClick={handleApprove}>
                      Approve
                    </button>
                    <button className="btn-reject" onClick={handleReject}>
                      Reject
                    </button>
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
            {(
              [
                ["face", "Face"],
                ["email", "Email"],
                ["phone", "Phone"],
                ["credit_card", "Credit Card"],
                ["password", "Password"],
                ["aadhaar", "Aadhaar"],
              ] as const
            ).map(([key, label]) => (
              <div className="policy-row" key={key}>
                <label>{label}</label>
                <select
                  value={policy[key]}
                  onChange={(e) =>
                    handlePolicyChange(key, e.target.value as PrivacyAction)
                  }
                >
                  <option value="blur">Blur</option>
                  <option value="mask">Mask</option>
                  <option value="redact">Redact</option>
                  <option value="allow">Allow</option>
                </select>
              </div>
            ))}
            <button className="btn-save" onClick={handleSavePolicy}>
              Save Policy
            </button>
          </div>

          <div className="settings-section">
            <div className="settings-title">AI Access</div>
            <div className="policy-row">
              <label>Enable AI Backend</label>
              <button
                className={`toggle-btn ${aiEnabled ? "" : "off"}`}
                onClick={toggleAiAccess}
              >
                {aiEnabled ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          <div className="stats-section">
            <div className="settings-title">Statistics</div>
            <div className="stat-row">
              <span>Raw Screenshots Sent</span>
              <span className="stat-count">{stats.rawSent}</span>
            </div>
            <div className="stat-row">
              <span>Sanitized Screens Sent</span>
              <span className="stat-count">{stats.sanitizedSent}</span>
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
