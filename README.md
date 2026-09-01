# 🔐 PrivacyGuard AI

> **A privacy-first browser AI agent that detects and redacts sensitive information locally before sending sanitized context to an LLM.**

PrivacyGuard AI is a browser-based AI assistant designed around a simple principle:

**AI should be helpful without requiring users to expose sensitive information.**

The system captures screen context, detects personally identifiable information (PII) locally using computer vision, OCR, and pattern matching, redacts sensitive content according to configurable privacy policies, and sends only sanitized context to an LLM for task assistance.

![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4.svg)

---

## ✨ Why PrivacyGuard AI?

Modern AI agents can understand screens, documents, and web applications, but sending raw screen data to cloud-based models can expose sensitive information such as:

* Email addresses
* Phone numbers
* Aadhaar numbers
* Credit card numbers
* Password fields
* Faces
* URLs

PrivacyGuard AI introduces a **privacy layer between the user's screen and the AI model**.

Instead of:

```text
User Screen → Cloud LLM
```

PrivacyGuard AI uses:

```text
User Screen
     ↓
Local PII Detection
     ↓
Local Redaction
     ↓
Sanitized Context
     ↓
LLM
     ↓
AI Response
```

This allows the AI agent to work with useful context while minimizing exposure of sensitive information.

---

# 🚀 Key Features

### 🔒 Local Privacy Processing

Sensitive information is detected and redacted locally inside the browser before communication with the LLM.

### 👁️ Computer Vision

Uses **YOLOv8 with ONNX Runtime Web** for visual detection, including face detection and other supported visual elements.

### 📜 OCR-Based Detection

Uses **Tesseract.js** to extract text from screenshots and identify sensitive information.

### 🧩 Pattern-Based PII Detection

Regex-based detection supports common sensitive data patterns such as:

* Email addresses
* Phone numbers
* Credit card numbers
* Aadhaar numbers
* URLs
* Password fields

### ⚙️ Configurable Privacy Policies

Privacy rules can be customized according to the application's requirements.

### 🤖 AI Agent

After sanitization, the processed context can be sent to an LLM for task understanding and intelligent responses.

### 🧪 Mock Mode

The backend can run without an LLM API key using simulated responses, making local development and demonstrations easier.

---

# 🏗️ System Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    Chrome Extension                         │
│                     Manifest V3                              │
│                                                              │
│     Screen Capture → PII Detection → Redaction              │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Local AI Processing                       │
│                                                              │
│     YOLOv8 / ONNX        Tesseract.js       Regex            │
│     Computer Vision      OCR                PII Detection    │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
                    Sanitized Context
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                     FastAPI Backend                          │
│                       localhost:8000                         │
│                                                              │
│              Agent Controller + Task Planner                │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                       LLM Provider                           │
│                       OpenRouter API                         │
│                                                              │
│                    Mock Mode Available                       │
└──────────────────────────────────────────────────────────────┘
```

---

# 🧠 Privacy Pipeline

The core processing pipeline follows these stages:

```text
1. Capture
   ↓
2. Analyze Screen
   ↓
3. Detect Sensitive Information
   ↓
4. Apply Privacy Policies
   ↓
5. Redact PII
   ↓
6. Generate Sanitized Context
   ↓
7. Send Sanitized Context to LLM
   ↓
8. Return AI Response
```

The important security boundary is between **local processing** and **LLM communication**.

Raw sensitive information should not be required by the LLM for supported workflows.

---

# 🎯 Supported PII Detection

| Data Type       | Detection Method         |
| --------------- | ------------------------ |
| Email           | Regex                    |
| Phone Number    | Regex                    |
| Aadhaar Number  | Pattern Matching         |
| Credit Card     | Regex / Pattern Matching |
| Password Fields | DOM / Pattern Detection  |
| Faces           | YOLOv8                   |
| URLs            | Regex                    |

---

# 🛠️ Tech Stack

## Frontend / Browser

* React
* TypeScript
* Vite
* Chrome Extension Manifest V3
* ONNX Runtime Web
* Tesseract.js

## AI / Computer Vision

* YOLOv8
* ONNX
* OCR
* Regex-based PII detection

## Backend

* Python
* FastAPI
* Uvicorn
* Pydantic
* HTTPX
* Python-dotenv

## LLM

* OpenRouter API
* Configurable LLM model
* Mock mode for development

---

# 📁 Project Structure

```text
browser-agent/
│
├── README.md
├── setup.md
├── LICENSE
│
├── yolov8n.onnx
├── yolov8n.pt
│
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env.example
│   │
│   └── agent/
│       ├── __init__.py
│       ├── controller.py
│       ├── llm.py
│       ├── planner.py
│       │
│       └── schemas/
│           ├── agent.py
│           └── __init__.py
│
└── extension/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── build-yolo.js
    ├── manifest.json
    ├── popup.html
    ├── offscreen.html
    │
    └── src/
        ├── agent/
        │   └── api.ts
        │
        ├── background/
        │   └── serviceWorker.ts
        │
        ├── content/
        │   └── contentScript.ts
        │
        ├── privacy/
        │   ├── piiDetector.ts
        │   ├── policies.ts
        │   └── sanitizer.ts
        │
        ├── vision/
        │   ├── detector.ts
        │   ├── ortConfig.ts
        │   ├── preprocessing.ts
        │   └── types.ts
        │
        ├── ocr/
        │   └── ocr.ts
        │
        ├── popup/
        │   ├── App.tsx
        │   ├── main.tsx
        │   └── styles.css
        │
        ├── offscreen/
        │   └── main.ts
        │
        ├── page/
        │   └── yolo-page.ts
        │
        └── utils/
            └── context.ts
```

---

# 🚀 Getting Started

## Prerequisites

Make sure you have:

* Python 3.10+
* Node.js 18+
* Google Chrome or another Chromium-based browser
* OpenRouter API key *(optional)*

---

## 1. Clone the Repository

```bash
git clone <your-repository-url>
cd browser-agent
```

---

# 2. Start the Backend

Navigate to the backend:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv venv
```

### Windows

```bash
venv\Scripts\activate
```

### macOS / Linux

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 3. Configure Environment Variables

Create:

```text
backend/.env
```

Add:

```env
LLM_API_KEY=your_openrouter_api_key_here
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=meta-llama/llama-3.1-8b-instruct:free

DEBUG=False
LOG_LEVEL=INFO
```

> **No API key? No problem.**
>
> PrivacyGuard AI supports mock mode for local development and testing.

---

## 4. Run the Backend

```bash
uvicorn main:app --reload --port 8000
```

The backend will be available at:

```text
http://localhost:8000
```

Check the health endpoint:

```bash
curl http://localhost:8000/health
```

Example response:

```json
{
  "status": "healthy",
  "llm_configured": true,
  "mode": "live"
}
```

---

# 5. Build the Chrome Extension

Open another terminal:

```bash
cd extension
```

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

The production extension will be generated in:

```text
extension/dist/
```

For development:

```bash
npm run dev
```

---

# 6. Load the Extension

Open Chrome and navigate to:

```text
chrome://extensions/
```

Then:

1. Enable **Developer mode**
2. Click **Load unpacked**
3. Select:

```text
extension/dist/
```

4. Pin PrivacyGuard AI to the browser toolbar.

---

# 🔌 API

## `POST /agent/analyze`

Analyzes a task using sanitized screen context.

### Request

```json
{
  "task": "What are the login credentials on this screen?",
  "screen_context": "Screenshot description with redacted PII",
  "detected_elements": [
    {
      "type": "password",
      "confidence": 0.95,
      "description": "[REDACTED]"
    }
  ]
}
```

### Response

```json
{
  "response": "I can see a login form, but sensitive fields are redacted for privacy.",
  "approved": false,
  "confidence": 0.85
}
```

---

## `GET /health`

Returns backend health and LLM configuration status.

Example:

```json
{
  "status": "healthy",
  "llm_configured": true,
  "mode": "live"
}
```

---

# 🔐 Privacy & Security

PrivacyGuard AI is designed around **privacy-by-design** principles.

### Local Processing

PII detection is performed on the client side.

### Data Sanitization

Sensitive information is redacted before LLM communication.

### User-Controlled Policies

Users can configure which categories of information should be detected and redacted.

### Open Source

The implementation can be inspected and audited by developers.

### Offline Detection

The YOLOv8 and OCR components are designed to perform their respective detection tasks locally without requiring an internet connection.

> **Important:** PrivacyGuard AI reduces exposure of sensitive information, but no software can guarantee perfect PII detection or complete privacy. Detection accuracy should be evaluated for the specific deployment environment.

---

# ⚙️ Custom Privacy Policies

Privacy rules are defined in:

```text
extension/src/privacy/policies.ts
```

Supported privacy types include:

```typescript
export type PrivacyType =
  | "email"
  | "phone"
  | "card"
  | "password"
  | "aadhaar"
  | "face"
  | "url";
```

This allows the privacy layer to be extended with additional sensitive-data categories.

---

# 🧪 Development

### Backend

```bash
cd backend

pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

### Extension

```bash
cd extension

npm install

npm run dev
```

Production build:

```bash
npm run build
```

---

# 🧩 Development Workflow

```text
Backend
   │
   ├── FastAPI
   ├── Agent Controller
   ├── Task Planner
   └── LLM Integration
   │
   ▼
Chrome Extension
   │
   ├── Screen Context
   ├── OCR
   ├── YOLOv8
   ├── PII Detection
   └── Sanitization
   │
   ▼
Sanitized Context
   │
   ▼
LLM
   │
   ▼
Agent Response
```

---

# 🤝 Contributing

Contributions are welcome.

### Development Process

```bash
# Fork the repository

# Create a feature branch
git checkout -b feature/amazing-feature

# Commit your changes
git commit -m "Add amazing feature"

# Push the branch
git push origin feature/amazing-feature
```

Then open a Pull Request.

---

# 📦 Dependencies

## Backend

* FastAPI
* Uvicorn
* Pydantic
* Python-dotenv
* HTTPX

## Extension

* React
* React DOM
* TypeScript
* Vite
* ONNX Runtime Web
* esbuild
* Tesseract.js

---

# 📄 License

This project is licensed under the **MIT License**.

See the `LICENSE` file for details.

---

# 📚 Resources

* Chrome Extension Manifest V3
* YOLOv8 ONNX
* Tesseract.js
* FastAPI
* OpenRouter API

---

# 👨‍💻 Project Goal

PrivacyGuard AI explores how **AI agents, computer vision, OCR, and privacy-preserving computation** can work together to build safer AI-powered browser automation.

The long-term goal is to make AI agents capable of understanding and assisting with complex browser workflows **without unnecessarily exposing sensitive user information**.

---

⭐ If you find this project interesting, consider giving the repository a star.
