<div align="center">

# 🎭 Aria 3D — 3D Avatar AI Voice Companion & Document Intelligence

**Interactive 3D Avatar. Real-Time Voice Synthesis. Intelligent Multimodal AI.**  
*A next-generation 3D VTuber AI companion powered by Groq LLM API pools, Edge TTS voice synthesis, YouTube transcript extraction, PDF parsing, and email dispatch.*

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/dakshgoyal1812/DNIK)
[![VRM 3D Avatar](https://img.shields.io/badge/Avatar-Three.js_|_VRM_2.0-8b5cf6?style=for-the-badge)](https://github.com/dakshgoyal1812/DNIK)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

<br/>

> **Aria 3D** brings conversational AI into three dimensions. Featuring a realistic 3D anime avatar (`Aria 2.0.vrm`), expressive natural speech synthesis (`msedge-tts`), document reading, video comprehension, and autonomous tool calling.

<br/>

</div>

---

## ✨ Features

- 💃 **Interactive 3D VRM Avatar**: Full 3D animated companion rendered with Three.js and `@pixiv/three-vrm` with eye-blinking, mouth lip-sync, and idle gestures.
- 🎙️ **Natural Voice Synthesis (Edge TTS)**: High-fidelity natural voice powered by Microsoft Edge neural TTS engine (`msedge-tts`).
- ⚡ **Ultra-Fast LLM Inference**: Multi-key load balancing across Groq API pools for instant responses.
- 📄 **PDF & Document Parsing**: Upload PDFs for instant multi-page summarization and semantic Q&A (`pdf-parse`).
- 📹 **YouTube Video Analyzer**: Extract and analyze YouTube video transcripts (`youtube-transcript`) for rapid learning.
- 📧 **Automated Email Dispatch**: Integrated email forwarding and notifications via Nodemailer.

---

## 🛠️ Tech Stack

- **3D Graphics & Physics**: Three.js, `@pixiv/three-vrm`, WebGL, VRM 2.0 Avatar
- **Speech Engine**: Microsoft Edge Neural TTS (`msedge-tts`), Web Speech Recognition
- **Backend**: Node.js, Express / Vanilla HTTP, Zlib compression
- **Document & Video Tools**: `pdf-parse`, `youtube-transcript`, `nodemailer`
- **Inference**: Groq Cloud LLMs (Llama 3, Mixtral) with automatic API key rotation
- **Deployment**: Render (`render.yaml`)

---

## 🗂️ Project Structure

```bash
DNIK/
├── Aria 2.0.vrm        # 3D VRM Avatar model asset
├── server.js           # Node.js backend server, API pool manager & tool execution
├── package.json        # Dependencies & start scripts
├── render.yaml         # Render cloud deployment config
├── public/
│   ├── index.html      # 3D WebGL canvas & dashboard UI
│   └── app.js          # Client-side 3D model loader & audio lip-sync
└── data/               # Persistent storage & cache
```

---

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/dakshgoyal1812/DNIK.git
cd DNIK
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure API Keys
Set your Groq API key in your environment or in `server.js`:
```bash
export GROQ_API_KEYS="your_groq_api_key_here"
```

### 4. Start Aria
```bash
npm start
```
Open **`http://localhost:3000`** in your browser to interact with Aria 3D!

---

## 👨‍💻 Author

**Daksh Goyal**  
* GitHub: [@dakshgoyal1812](https://github.com/dakshgoyal1812)  
* Portfolio: [my-cv-rosy-psi.vercel.app](https://my-cv-rosy-psi.vercel.app)
