# PrivacyGuard AI

Privacy-preserving browser AI agent. Captures your screen, detects sensitive data locally, redacts it, then sends only sanitized context to an LLM for task assistance.

## Architecture

```
Chrome Extension (Manifest V3)
    ↓
Real browser tab screenshot
    ↓
Local YOLOv8 (ONNX) + Tesseract.js OCR
    ↓
PII detection (email, phone, card, password, Aadhaar, face)
    ↓
Canvas redaction per user privacy policy
    ↓
Sanitized context (no raw data)
    ↓
FastAPI Backend (localhost:8000)
    ↓
OpenRouter LLM
    ↓
Agent response → User approves/rejects
```

## Prerequisites

- Python 3.10+
- Node.js 18+
- Google Chrome (or Chromium-based browser)
- OpenRouter API key (optional — mock mode works without it)

## 1. Backend Setup

```bash
cd backend

# Create virtual environment (optional but recommended)
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment (optional)
copy .env.example .env
```

Edit `.env` (or set environment variables):

```env
LLM_API_KEY=your_openrouter_api_key
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=meta-llama/llama-3.1-8b-instruct:free
```

> If no API key is set, the backend runs in **mock mode** and returns simulated responses.

Start the backend:

```bash
uvicorn main:app --reload --port 8000
```

Verify it's running:

```
http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "llm_configured": true,
  "mode": "live"
}
```

## 2. Extension Build

```bash
cd extension

# Install dependencies
npm install

# Build for production
npm run build
```

This creates `extension/dist/` containing the loadable Chrome extension.

## 3. Load Extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/dist` folder
5. The PrivacyGuard AI icon appears in your toolbar

## 4. Test the Full Flow

1. Open any webpage (e.g., a login page or form)
2. Click the **PrivacyGuard AI** icon in the toolbar
3. The popup opens showing your current tab's hostname
4. Click **Capture & Analyze**
   - Screenshot captured via Chrome API
   - YOLO runs locally (first run downloads model)
   - OCR runs locally via Tesseract.js
   - Sensitive regions highlighted
5. Review detected sensitive data in the dashboard
6. Click **Sanitize Screen**
   - Image redacted per your privacy policy
   - Sanitized preview shown
7. Enable **AI Access** (Settings tab)
8. Type a task (e.g., "Help me fill this form")
9. Click **Analyze with AI**
   - Sanitized context sent to FastAPI
   - LLM returns structured action
10. Review the suggested action
11. Click **Approve** or **Reject**

## 5. Verify Privacy

Open Chrome DevTools → Network tab while clicking "Analyze with AI".

The request to `localhost:8000/agent/analyze` should contain:

```json
{
  "task": "Help me fill this form",
  "detected_elements": ["email_field", "password_field"],
  "screen_context": "Sensitive regions: 3. Types: email, password."
}
```

It must **NOT** contain:
- Raw screenshot
- Raw OCR text
- Actual email values
- Actual phone numbers
- Actual passwords

## 6. Extension Tabs

| Tab | Description |
|-----|-------------|
| **Dashboard** | Screenshot preview, sensitive data counts, privacy score, AI agent |
| **Settings** | Privacy policy per data type (blur/mask/redact/allow), AI access toggle |
| **Activity** | Audit log of all actions (no sensitive values recorded) |

## 7. Privacy Policy

Configure per data type what happens when detected:

| Data Type | Default | Options |
|-----------|---------|---------|
| Face | Blur | Blur, Mask, Redact, Allow |
| Email | Mask | Blur, Mask, Redact, Allow |
| Phone | Mask | Blur, Mask, Redact, Allow |
| Credit Card | Redact | Blur, Mask, Redact, Allow |
| Password | Redact | Blur, Mask, Redact, Allow |
| Aadhaar | Mask | Blur, Mask, Redact, Allow |

Policy is stored in `chrome.storage.local` and persists across sessions.

## 8. Project Structure

```
browser-agent/
├── backend/
│   ├── main.py                 FastAPI entry point
│   ├── requirements.txt
│   ├── schemas/agent.py        Request/response models
│   └── agent/
│       ├── controller.py       Orchestration
│       ├── llm.py              OpenRouter integration
│       └── planner.py          Safe action validation
│
└── extension/
    ├── manifest.json           Manifest V3
    ├── package.json
    ├── vite.config.ts
    ├── popup.html
    ├── src/
    │   ├── popup/              React UI
    │   ├── background/         Service worker (screenshot capture)
    │   ├── content/            Content script (form detection)
    │   ├── vision/             YOLOv8 ONNX inference
    │   ├── ocr/                Tesseract.js
    │   ├── privacy/            PII detection + sanitization
    │   ├── agent/              Backend API client
    │   └── utils/              Context builder
    ├── public/
    │   ├── model/yolov8n.onnx
    │   └── icons/
    └── dist/                   Build output (load into Chrome)
```

## Troubleshooting

### "Capture failed" on chrome:// or Chrome Web Store pages
Chrome blocks screenshot capture on internal pages. Navigate to a regular webpage first.

### YOLO model fails to load
The ONNX model is served from `extension/dist/model/yolov8n.onnx`. Ensure the build completed and `dist/model/` exists.

### Backend connection refused
Ensure the FastAPI server is running on port 8000:
```bash
cd backend && uvicorn main:app --reload --port 8000
```

### AI returns mock responses
Set your OpenRouter API key in the backend `.env` file:
```env
LLM_API_KEY=sk-or-v1-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=meta-llama/llama-3.1-8b-instruct:free
```

### Build errors
```bash
cd extension
rm -rf node_modules dist
npm install --legacy-peer-deps
npm run build
```

### Rebuild after changes
```bash
cd extension && npm run build
```
Then go to `chrome://extensions` and click the refresh icon on the extension card.

## Notes

- All vision (YOLO) and OCR (Tesseract) processing happens **locally in the browser**
- Screenshots never leave your device
- Only sanitized context is sent to the backend
- The backend never receives raw sensitive values
- The AI access toggle can disable all backend communication
- No automatic browser actions are implemented yet — all actions require user approval
