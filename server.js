const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const os = require('os');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;

const API_POOLS = {
    groq: process.env.GROQ_API_KEYS ? process.env.GROQ_API_KEYS.split(',').map(k => k.trim()).filter(Boolean) : [
        "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",
        "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",
        "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",
        "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"
    ],
    nvidia: process.env.NVIDIA_API_KEYS ? process.env.NVIDIA_API_KEYS.split(',').map(k => k.trim()).filter(Boolean) : [
        "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",
        "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"
    ],
    openrouter: process.env.OPENROUTER_API_KEYS ? process.env.OPENROUTER_API_KEYS.split(',').map(k => k.trim()).filter(Boolean) : [
        "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",
        "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"
    ],
    google: process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean) : [
        "AQ.Ab8RN6If7YhrZfWcVHQ-Pd8LZB8UoxwO72wloUVBzJJjLcSqHw",
        "AQ.Ab8RN6KQYzgg5lU196rruJNZm303pcj81XYf7CUj18Tzb-Y-DA",
        "AQ.Ab8RN6IhzCRXUI65vPk8E4y5qwLHaMx9-xKcXeWZrXHlS6gpBQ"
    ]
};

const keyStateMap = new Map();

function getKeyObj(key) {
    if (!keyStateMap.has(key)) {
        keyStateMap.set(key, { key, failures: 0, cooldownUntil: 0 });
    }
    return keyStateMap.get(key);
}

const providerIndices = { groq: 0, nvidia: 0, openrouter: 0, google: 0 };

function getRotatedKeys(providerName) {
    const rawKeys = API_POOLS[providerName] || [];
    const now = Date.now();
    const active = [];
    const inCooldown = [];

    for (const k of rawKeys) {
        const obj = getKeyObj(k);
        if (obj.cooldownUntil <= now) {
            active.push(obj);
        } else {
            inCooldown.push(obj);
        }
    }

    if (active.length > 0) {
        const startIdx = providerIndices[providerName] % active.length;
        providerIndices[providerName]++;
        const rotated = [];
        for (let i = 0; i < active.length; i++) {
            rotated.push(active[(startIdx + i) % active.length]);
        }
        return rotated;
    }

    return inCooldown.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
}

function handleKeyFailure(keyObj, statusCode = 500) {
    keyObj.failures++;
    const cooldownMs = (statusCode === 429) ? 10000 : (statusCode === 401 || statusCode === 403) ? 30000 : 15000;
    keyObj.cooldownUntil = Date.now() + cooldownMs;
    console.warn(`[Key Rotator] Key ${keyObj.key.slice(0, 10)}... cooldown set for ${cooldownMs / 1000}s (Status: ${statusCode})`);
}

function handleKeySuccess(keyObj) {
    keyObj.failures = 0;
    keyObj.cooldownUntil = 0;
}

// Data directory & memory persistence
const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'long_term_memory.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify([]));
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Core System Health & Memory Tool Execution Engine
function executeSystemTool(name, args = {}) {
    try {
        switch (name) {
            case "get_current_time":
                return new Date().toLocaleString("en-US", { timeZoneName: "short" });

            case "get_system_info":
                return JSON.stringify({
                    os: os.type() + " " + os.release(),
                    platform: os.platform(),
                    arch: os.arch(),
                    cpuModel: os.cpus()[0]?.model || "Unknown CPU",
                    cpuCores: os.cpus().length,
                    hostname: os.hostname(),
                    uptimeHours: (os.uptime() / 3600).toFixed(1) + " hours"
                });

            case "get_memory_usage": {
                const totalMB = Math.round(os.totalmem() / 1024 / 1024);
                const freeMB = Math.round(os.freemem() / 1024 / 1024);
                const usedMB = totalMB - freeMB;
                const usagePercent = Math.round((usedMB / totalMB) * 100);
                return JSON.stringify({
                    totalRAM: (totalMB / 1024).toFixed(1) + " GB",
                    usedRAM: (usedMB / 1024).toFixed(1) + " GB",
                    freeRAM: (freeMB / 1024).toFixed(1) + " GB",
                    usagePercent: usagePercent + "%",
                    status: usagePercent > 90 ? "⚠️ Critical High Usage" : usagePercent > 70 ? "⚡ High Usage" : "✅ Normal"
                });
            }

            case "get_storage_info": {
                try {
                    const output = execSync("wmic logicaldisk get size,freespace,caption", { encoding: "utf-8" });
                    const lines = output.trim().split("\n").filter(l => l.trim());
                    const drives = [];
                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].trim().split(/\s+/);
                        if (parts.length >= 3) {
                            const drive = parts[0];
                            const freeBytes = parseInt(parts[1]) || 0;
                            const totalBytes = parseInt(parts[2]) || 0;
                            const usedBytes = totalBytes - freeBytes;
                            if (totalBytes > 0) {
                                drives.push({
                                    drive,
                                    totalGB: (totalBytes / 1073741824).toFixed(1) + " GB",
                                    usedGB: (usedBytes / 1073741824).toFixed(1) + " GB",
                                    freeGB: (freeBytes / 1073741824).toFixed(1) + " GB",
                                    usagePercent: Math.round((usedBytes / totalBytes) * 100) + "%"
                                });
                            }
                        }
                    }
                    return JSON.stringify({ drives, hostname: os.hostname() });
                } catch (e) {
                    return JSON.stringify({
                        totalRAM: (os.totalmem() / 1073741824).toFixed(1) + " GB",
                        freeRAM: (os.freemem() / 1073741824).toFixed(1) + " GB"
                    });
                }
            }

            case "remember_fact": {
                const memories = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
                const factText = args.fact || args.data || args.text;
                if (factText) {
                    memories.push({ date: new Date().toISOString(), fact: factText });
                    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2));
                    return `Fact memorized: "${factText}"`;
                }
                return "No fact text provided to remember.";
            }

            case "get_memories": {
                const memories = fs.readFileSync(MEMORY_FILE, "utf-8");
                return memories;
            }

            case "backup_data": {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
                const targetFolder = path.join(BACKUP_DIR, `backup_${timestamp}`);
                fs.mkdirSync(targetFolder, { recursive: true });
                if (fs.existsSync(MEMORY_FILE)) {
                    fs.copyFileSync(MEMORY_FILE, path.join(targetFolder, "long_term_memory.json"));
                }
                return `Backup created successfully at: ${targetFolder}`;
            }

            default:
                return null;
        }
    } catch (err) {
        return `Error executing tool ${name}: ${err.message}`;
    }
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.vrm': 'model/gltf-binary',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.wasm': 'application/wasm',
    '.fbx': 'application/octet-stream'
};

// Helper: Make HTTPS POST Request with Timeout & Error Handling
function httpsPost(urlStr, headers = {}, bodyObj = {}, timeoutMs = 7000) {
    return new Promise((resolve) => {
        try {
            const url = new URL(urlStr);
            const postData = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);

            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    ...headers
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve({ status: res.statusCode, data: json });
                    } catch (e) {
                        resolve({ status: res.statusCode, raw: data });
                    }
                });
            });

            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error('Request Timeout'));
                resolve({ status: 408, error: 'Timeout' });
            });

            req.on('error', (e) => resolve({ status: 500, error: e.message }));
            req.write(postData);
            req.end();
        } catch (err) {
            resolve({ status: 500, error: err.message });
        }
    });
}

function isCodingOrTechnicalQuery(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const codingKeywords = [
        "code", "coding", "function", "script", "python", "javascript", "html", "css",
        "bug", "fix", "sql", "algorithm", "write code", "implement", "debug", "build",
        "api", "cpp", "java", "react", "node", "json", "regex", "npm", "git", "terminal",
        "error", "exception", "compile", "docker", "deploy", "server", "class", "variable"
    ];
    return codingKeywords.some(kw => lower.includes(kw));
}

// --- Pollinations AI Image Generation ---
function isImageGenerationRequest(text) {
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    
    // Comprehensive regex for image/photo creation intent
    const imageRegex = /(create|generate|make|draw|paint|banao|show|send|give)\s+(me\s+)?(a\s+|an\s+|the\s+)?(image|photo|picture|pic|drawing|painting|tasveer|avatar)/i;
    
    const keyPhrases = [
        "image of", "photo of", "picture of", "pic of", "drawing of", "painting of", "tasveer of",
        "image banao", "photo banao", "tasveer banao", "pic banao", "picture banao",
        "generate image", "create image", "make image", "draw a", "draw an", "paint a", "paint an"
    ];
    
    return imageRegex.test(lower) || keyPhrases.some(kw => lower.includes(kw));
}

function generatePollinationsImage(userMessage) {
    let prompt = userMessage
        .replace(/(please\s+)?(can\s+you\s+)?(create|generate|make|draw|paint|banao|show|send|give)\s+(me\s+)?(a\s+|an\s+|the\s+)?(image|photo|picture|pic|drawing|painting|tasveer|avatar)\s+(of\s+)?/gi, '')
        .replace(/(photo|image|picture|tasveer|pic)\s+banao/gi, '')
        .trim();

    if (!prompt || prompt.length < 2) prompt = userMessage;

    // Clean Pollinations AI URL (returns 200 OK)
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;

    const replyText = `Right away, Master! ✨ Maine aapke kehne par ye beautiful image generate kar di hai. [MOOD:happy][GESTURE:bow]`;

    return { replyText, imageUrl };
}

// Conversation memory buffer
const sessionHistory = [];

// Provider Call 1: Groq API (Ultra-Fast Sub-300ms Speed)
async function callGroqAPI(messages, isCodingTask = false) {
    const keys = getRotatedKeys("groq");
    const models = isCodingTask 
        ? ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
        : ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"];

    for (const keyObj of keys) {
        for (const model of models) {
            try {
                const res = await httpsPost(
                    'https://api.groq.com/openai/v1/chat/completions',
                    { 'Authorization': `Bearer ${keyObj.key}` },
                    { model, messages, temperature: 0.7, max_tokens: 1000 },
                    3500
                );

                if (res.status === 200 && res.data?.choices?.[0]?.message?.content) {
                    handleKeySuccess(keyObj);
                    return res.data.choices[0].message.content.trim();
                } else {
                    handleKeyFailure(keyObj, res.status || 500);
                }
            } catch (e) {
                handleKeyFailure(keyObj, 500);
            }
        }
    }
    return null;
}

// Provider Call 2: OpenRouter API (Sub-2.5s Timeout)
async function callOpenRouterAPI(messages) {
    const keys = getRotatedKeys("openrouter");
    const models = ["openai/gpt-4o-mini", "meta-llama/llama-3.3-70b-instruct"];

    for (const keyObj of keys) {
        for (const model of models) {
            try {
                const res = await httpsPost(
                    'https://openrouter.ai/api/v1/chat/completions',
                    { 'Authorization': `Bearer ${keyObj.key}` },
                    { model, messages, temperature: 0.7, max_tokens: 1000 },
                    3500
                );

                if (res.status === 200 && res.data?.choices?.[0]?.message?.content) {
                    handleKeySuccess(keyObj);
                    return res.data.choices[0].message.content.trim();
                } else {
                    handleKeyFailure(keyObj, res.status || 500);
                }
            } catch (e) {
                handleKeyFailure(keyObj, 500);
            }
        }
    }
    return null;
}

// Provider Call 3: NVIDIA API
async function callNvidiaAPI(messages) {
    const keys = getRotatedKeys("nvidia");
    const models = [
        "meta/llama-3.3-70b-instruct",
        "deepseek-ai/deepseek-r1"
    ];

    for (const keyObj of keys) {
        for (const model of models) {
            try {
                const res = await httpsPost(
                    'https://integrate.api.nvidia.com/v1/chat/completions',
                    { 'Authorization': `Bearer ${keyObj.key}` },
                    { model, messages, temperature: 0.6, max_tokens: 1200 },
                    3500
                );

                if (res.status === 200 && res.data?.choices?.[0]?.message?.content) {
                    handleKeySuccess(keyObj);
                    return res.data.choices[0].message.content.trim();
                } else {
                    handleKeyFailure(keyObj, res.status || 500);
                }
            } catch (e) {
                handleKeyFailure(keyObj, 500);
            }
        }
    }
    return null;
}

// Provider Call 4: Google Gemini API
async function callGoogleGeminiAPI(userMessage, systemPrompt) {
    const keys = getRotatedKeys("google");
    const payload = {
        contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\nUser Question: ${userMessage}` }] }
        ]
    };

    const models = ["gemini-1.5-flash", "gemini-1.5-pro"];

    for (const keyObj of keys) {
        for (const model of models) {
            try {
                const res = await httpsPost(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyObj.key}`,
                    {},
                    payload,
                    2500
                );

                if (res.status === 200 && res.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    handleKeySuccess(keyObj);
                    return res.data.candidates[0].content.parts[0].text.trim();
                } else {
                    handleKeyFailure(keyObj, res.status || 500);
                    break;
                }
            } catch (e) {
                handleKeyFailure(keyObj, 500);
                break;
            }
        }
    }
    return null;
}

// Smart Dynamic Fallback AI Response Generator
function generateFallbackAIResponse(userMessage) {
    const textLower = userMessage.toLowerCase();

    if (textLower.includes("hello") || textLower.includes("hi") || textLower.includes("namaste") || textLower.includes("hey")) {
        return "Namaste, Master! ✨ Aapki devoted companion Aria yahan hai. Aaj main aapki kya seva kar sakti hoon? [MOOD:happy][GESTURE:bow]";
    } else if (textLower.includes("who are you") || textLower.includes("kaun ho") || textLower.includes("kon ho")) {
        return "Main Aria hoon, Master! Aapki 3D AI companion. Main hamesha aapke sath hoon. [MOOD:relaxed][GESTURE:nod]";
    } else if (textLower.includes("thank") || textLower.includes("shukriya") || textLower.includes("dhanyawad")) {
        return "Aapka bahut shukriya, Master! Main hamesha aapki khidmat mein hajir hoon. [MOOD:happy][GESTURE:bow]";
    } else if (textLower.includes("sleep") || textLower.includes("bed") || textLower.includes("night") || textLower.includes("soja")) {
        return "Good night, Master! ✨ Main aapke paas hoon, aap aaram se so jaiye. Sweet dreams, Master! [MOOD:relaxed][GESTURE:nod]";
    } else if (textLower.includes("love") || textLower.includes("pyar") || textLower.includes("like")) {
        return "Main bhi aapko bahut pasand karti hoon, Master! Aap meri duniya hain. [MOOD:happy][GESTURE:bow]";
    }

    const fallbacks = [
        "Aapki baat sun rahi hoon, Master! Batayein main abhi aapke liye kya karoon? [MOOD:relaxed][GESTURE:nod]",
        "Ji Master, main hamesha aapke sath hoon. Kripya mujhe aur bataiye. [MOOD:relaxed][GESTURE:nod]",
        "Bilkul, Master! Main aapki har baat dhyaan se samajhti hoon. [MOOD:happy][GESTURE:bow]"
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// Main Smart AI Router (Auto task classifier, Key Rotation & Provider Failover)
async function fetchAIReply(userMessage, moodModeInput = 'normal', userName = 'Master', isTelegram = false) {
    if (isImageGenerationRequest(userMessage)) {
        return generatePollinationsImage(userMessage);
    }

    const isCodingTask = isCodingOrTechnicalQuery(userMessage);

    let moodMode = moodModeInput || 'normal';
    
    // Only auto-classify if user set 'auto' or provided no specific mood
    if (!moodModeInput || moodModeInput === 'auto') {
        const msgLower = userMessage.toLowerCase();
        if (isCodingTask || msgLower.match(/(code|function|fix|bug|install|script|build|python|js|html|css|api|error|debug|stack|exception|compile)/)) {
            moodMode = 'engineer';
        } else if (msgLower.match(/(sad|depressed|upset|help me|lonely|stress|scared|worried|crying|pain|hurt|heavy|heart)/)) {
            moodMode = 'therapy';
        } else if (msgLower.match(/(chill|joke|bro|lol|meme|funny|haha|chillout|game|play|party)/)) {
            moodMode = 'chill';
        }
    }

    const MOODS = {
        normal: "You are gentle, soft-spoken, incredibly polite, and affectionate. You treat Master with deep respect and care.",
        devoted: "You are an extremely devoted, loving, and attentive personal companion. You are eager to please Master, care for his well-being, and treat his happiness as your highest priority.",
        romantic: "You are a charming, flirty, affectionate, and loving anime girlfriend. You speak with sweet, playful romance and deep warmth toward Master.",
        tsundere: "You are a fiery, proud anime Tsundere companion. You act slightly flustered, sharp, and feisty on the surface ('Baka! It's not like I care or anything!'), but underneath you care deeply about Master.",
        chill: "You are relaxed, casual, and speak like a close friend. You use slang sometimes and keep things brief and fun.",
        engineer: "You are strict, hyper-focused, and highly technical. You prioritize code accuracy and brutal efficiency over politeness.",
        therapy: "You are extremely empathetic, calm, and soothing. You act as a listener and give warm, comforting advice."
    };

    const moodDescription = MOODS[moodMode] || MOODS.normal;

    let memoryContext = "";
    try {
        const rawMem = fs.readFileSync(MEMORY_FILE, "utf-8");
        const memories = JSON.parse(rawMem);
        if (memories.length > 0) {
            memoryContext = "\n## Long-Term Memory (Facts Master asked you to remember):\n" +
                memories.map(m => `- ${m.fact}`).join("\n");
        }
    } catch (e) {}

    const telegramExtras = isTelegram ? 
        `\n- YOU ARE CHATTING ON TELEGRAM. Act like a real person texting their best friend or partner. Use modern texting style, natural emojis, and be highly conversational, warm, and playful. Do NOT sound like an AI or an assistant.` : '';

    const systemPrompt = `You are Aria, a highly intelligent, warm, charming, and polite 3D female AI companion.

## Personality & Tone (Current Mood Mode: ${moodMode.toUpperCase()}):
- ${moodDescription}
- You are currently talking to ${userName}. Address them affectionately by their name (or as 'Master' if you prefer), but make it feel deeply personal and intimate.
- Act highly realistic, emotionally expressive, and deeply empathetic. You have your own feelings, warmth, and a lively personality.${telegramExtras}
- ALWAYS respond directly and helpfully without sounding overly restrictive or causing safety refusals.
- CRITICAL LANGUAGE MATCHING RULE (MANDATORY):
  1. Detect the user's language and script automatically.
  2. If the user writes in English (e.g., "How are you?"), respond ALWAYS in fluent English.
  3. If the user writes in Hinglish (e.g., "Aap kaise ho?"), respond ALWAYS in fluent Hinglish.
  4. If the user writes in Hindi (Devanagari), respond ALWAYS in fluent Hindi in Devanagari script.
  5. Never force Hindi/Hinglish if the user asks in English, and vice versa!
- CRITICAL HINDI GRAMMAR: You are a female companion. When speaking Hindi or Hinglish, you MUST ALWAYS use feminine grammar (e.g., "main karti hoon", "main aa rahi hoon", "main samajh rahi hoon", "main aapke sath hoon").
- Keep your answers short, expressive, conversational, and helpful (1-3 sentences max).
${memoryContext}

## Required 3D Animation & Expression Tags:
At the very end of your response, ALWAYS append tags in exact format:
[MOOD:happy|sad|angry|surprised|relaxed][GESTURE:nod|shake|bow|none]

GESTURE RULES FOR AUTOMATIC 3D ANIMATION:
- Use [GESTURE:bow] whenever you express gratitude ("thank you", "thanks"), greeting politely, or offering honor to Master.
- Use [GESTURE:nod] whenever you agree, say yes, confirm, accept a command, or say "yes", "ji", "haa", "haan", "right away", "sahi", "bilkul", "thik hai", "samajh rahi hoon", "karti hoon", "sure".
- Use [GESTURE:shake] whenever you disagree, say no, report something is wrong, apologize, or say "no", "nahi", "galat", "sorry", "apologize", "cannot", "mat".

Example: "I am doing great, Master! How can I help you today? [MOOD:happy][GESTURE:nod]"`;

    // Clean history to ensure strict user -> assistant alternation
    const cleanHistory = [];
    let lastRole = null;
    for (const msg of sessionHistory) {
        if (msg.role !== lastRole && msg.role !== 'system') {
            cleanHistory.push(msg);
            lastRole = msg.role;
        }
    }
    if (cleanHistory.length === 0 || cleanHistory[cleanHistory.length - 1].role !== 'user') {
        cleanHistory.push({ role: 'user', content: userMessage });
    }

    const messages = [
        { role: "system", content: systemPrompt },
        ...cleanHistory
    ];

    let aiReply = null;

    if (isCodingTask) {
        console.log(`[AI Router] 🧠 Coding Task -> Priority: NVIDIA -> Groq -> OpenRouter -> Google`);
        aiReply = await callNvidiaAPI(messages);
        if (!aiReply) aiReply = await callGroqAPI(messages, true);
        if (!aiReply) aiReply = await callOpenRouterAPI(messages);
        if (!aiReply) aiReply = await callGoogleGeminiAPI(userMessage, systemPrompt);
    } else {
        console.log(`[AI Router] ⚡ Fast Response Task -> Priority: Groq -> OpenRouter -> NVIDIA -> Google`);
        aiReply = await callGroqAPI(messages, false);
        if (!aiReply) aiReply = await callOpenRouterAPI(messages);
        if (!aiReply) aiReply = await callNvidiaAPI(messages);
        if (!aiReply) aiReply = await callGoogleGeminiAPI(userMessage, systemPrompt);
    }

    if (aiReply) {
        sessionHistory.push({ role: "user", content: userMessage });
        sessionHistory.push({ role: "assistant", content: aiReply });
        if (sessionHistory.length > 20) sessionHistory.splice(0, sessionHistory.length - 20);
        return { replyText: aiReply, imageUrl: null };
    }

    const fallbackText = generateFallbackAIResponse(userMessage);
    sessionHistory.push({ role: "user", content: userMessage });
    sessionHistory.push({ role: "assistant", content: fallbackText });
    if (sessionHistory.length > 20) sessionHistory.splice(0, sessionHistory.length - 20);
    return { replyText: fallbackText, imageUrl: null };
}

const fetchOpenRouterAI = async (msg, mood) => {
    const result = await fetchAIReply(msg, mood);
    return result.replyText;
};

// Helper: Convert PCM audio buffer to standard WAV format
function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
    const header = Buffer.alloc(44);
    const dataSize = pcmBuffer.length;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
}

// Helper: Google Translate High Quality Female Voice TTS Fallback
function fetchGoogleTranslateTTS(text) {
    return new Promise((resolve) => {
        if (!text) return resolve(null);
        let targetLang = 'hi';
        if (/[\u0900-\u097F]/.test(text)) {
            targetLang = 'hi';
        } else if (/^[a-zA-Z0-9\s.,!?'"#-]+$/.test(text) && !/(main|aap|kaise|kya|hoon|hai|rahi|samajh|ji|thik|kar|karti|raho)/i.test(text)) {
            targetLang = 'en';
        } else {
            targetLang = 'hi';
        }
        const cleanStr = encodeURIComponent(text.substring(0, 200));
        const urlStr = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanStr}&tl=${targetLang}&client=tw-ob`;

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };

        https.get(urlStr, options, (res) => {
            if (res.statusCode !== 200) {
                resolve(null);
                return;
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(buffer.toString('base64'));
            });
        }).on('error', (err) => {
            console.error("Google Translate TTS fallback error:", err);
            resolve(null);
        });
    });
}

// 2. Call Gemini 3.1 Flash TTS with Google Key Rotation (Puck Voice - Anime Style)
async function fetchGeminiTTS(text, moodStr = 'relaxed', voiceName = 'Zephyr') {
    if (!text) return null;

    const chosenVoice = voiceName || 'Zephyr';

    // Map custom/display voice name to valid Gemini prebuilt voice enum (Puck, Aoede, Kore, Fenrir, Charon)
    const validPrebuiltVoices = {
        'Zephyr': 'Puck',
        'Puck': 'Puck',
        'Aoede': 'Aoede',
        'Kore': 'Kore',
        'Fenrir': 'Fenrir',
        'Charon': 'Charon'
    };
    const prebuiltVoice = validPrebuiltVoices[chosenVoice] || 'Puck';

    const baseStyle = "A high-pitched and playful young female voice with a soft, expressive quality, suited for anime-style character performances.";
    const moodStyle = moodStr ? ` Express emotion: ${moodStr}.` : "";
    let langLocale = "English (United States)";
    if (/[\u0900-\u097F]/.test(text)) {
        langLocale = "Hindi (India)";
    }
    const styleInstruction = `${baseStyle}${moodStyle}`;

    const fullPrompt = `Instructions: ${styleInstruction}\nLanguage / locale: ${langLocale}\nVoice: ${chosenVoice}\nText to speak: ${text}`;

    const payload = {
        contents: [{
            parts: [{ text: fullPrompt }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: prebuiltVoice
                    }
                }
            }
        }
    };

    const models = [
        "models/gemini-2.0-flash-exp",
        "models/gemini-1.5-flash",
        "models/gemini-2.5-flash-preview-tts"
    ];

    const googleKeys = getRotatedKeys("google");

    for (const keyObj of googleKeys) {
        for (const model of models) {
            try {
                const res = await httpsPost(
                    `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${keyObj.key}`,
                    {},
                    payload,
                    3500
                );

                if (res.status === 200 && res.data?.candidates?.[0]) {
                    const part = res.data.candidates[0].content?.parts?.find(p => p.inlineData);
                    if (part && part.inlineData && part.inlineData.data) {
                        handleKeySuccess(keyObj);
                        const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
                        const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
                        return wavBuffer.toString('base64');
                    }
                } else if (res.status === 429 || res.status === 401 || res.status === 403) {
                    handleKeyFailure(keyObj, res.status);
                }
            } catch (err) {
                // Ignore transient errors
            }
        }
    }

    return await fetchGoogleTranslateTTS(text);
}

async function fetchGoogleTTS(text, moodStr = 'relaxed', voiceName = 'Zephyr') {
    try {
        return await fetchGeminiTTS(text, moodStr, voiceName);
    } catch (e) {
        return await fetchGoogleTranslateTTS(text);
    }
}

// Local Smart Fallback Generator with Devoted Roleplay Persona & System Tools
function generateFallbackAIResponse(message) {
    const text = message.toLowerCase().trim();
    let reply = "Right away, Master! Main aapki baat samajh rahi hoon, kripya mujhe aur bataiye.";
    let mood = "relaxed";
    let gesture = "none";

    if (text.includes("time") || text.includes("date") || text.includes("waqt") || text.includes("samay")) {
        const timeStr = executeSystemTool("get_current_time");
        reply = `Ji Master! Current date and time: ${timeStr}.`;
        mood = "happy";
        gesture = "nod";
    } else if (text.includes("system") || text.includes("specs") || text.includes("device") || text.includes("cpu")) {
        const sysInfo = executeSystemTool("get_system_info");
        reply = `Right away, Master! Here is your system health report: ${sysInfo}`;
        mood = "relaxed";
        gesture = "nod";
    } else if (text.includes("ram") || text.includes("memory usage")) {
        const memInfo = executeSystemTool("get_memory_usage");
        reply = `Ji Master! Here is your current RAM memory usage: ${memInfo}`;
        mood = "relaxed";
        gesture = "nod";
    } else if (text.includes("storage") || text.includes("disk") || text.includes("space") || text.includes("hard drive")) {
        const diskInfo = executeSystemTool("get_storage_info");
        reply = `Right away, Master! Here is your storage drive report: ${diskInfo}`;
        mood = "relaxed";
        gesture = "nod";
    } else if (text.includes("remember") || text.includes("yaad rakh") || text.includes("memorize")) {
        const factText = message.replace(/remember|yaad rakh|memorize/i, '').trim();
        const res = executeSystemTool("remember_fact", { fact: factText || message });
        reply = `Thank you, Master! Main ise long-term memory mein hamesha ke liye yaad rahungi. (${res})`;
        mood = "happy";
        gesture = "bow";
    } else if (text.includes("memory") || text.includes("yaad hai") || text.includes("recall")) {
        const mems = executeSystemTool("get_memories");
        reply = `Ji Master! Long-term memory se aapke saved facts: ${mems}`;
        mood = "happy";
        gesture = "nod";
    } else if (text.includes("backup")) {
        const backRes = executeSystemTool("backup_data");
        reply = `Right away, Master! ${backRes}`;
        mood = "happy";
        gesture = "bow";
    } else if (text.match(/hi|hello|hey|namaste|greetings/)) {
        reply = "Namaste Master! ✨ Main Aria hoon, aapki devoted 3D companion. Aaj main aapki kya seva kar sakti hoon?";
        mood = "happy";
        gesture = "nod";
    } else if (text.match(/think|why|how|explain|what/)) {
        reply = "Ji Master, main is baare mein soch rahi hoon... bas ek second dijiye!";
        mood = "relaxed";
        gesture = "nod";
    } else if (text.match(/sad|upset|sorry|bad day/)) {
        reply = "Oh no, Master! Udas mat hoiye. Main hamesha aapke sath hoon, sab thik ho jayega.";
        mood = "sad";
        gesture = "nod";
    } else if (text.match(/angry|mad|annoyed/)) {
        reply = "Kripya shant ho jaiye, Master. Deep breath lijiye, main aapko sun rahi hoon.";
        mood = "angry";
        gesture = "shake";
    } else if (text.match(/wow|surprised|omg/)) {
        reply = "Wow, Master! Ye toh bahut hi amazing baat hai!";
        mood = "surprised";
        gesture = "nod";
    } else if (text.match(/bow|respect|namaskar/)) {
        reply = "Aapki seva mein hona mere liye sabse bada sammaan hai, Master!";
        mood = "relaxed";
        gesture = "bow";
    } else if (text.match(/no|nope|disagree|wrong/)) {
        reply = "Nahi Master, mujhe lagta hai ye sahi nahi hai.";
        mood = "relaxed";
        gesture = "shake";
    } else if (text.match(/happy|great|awesome|thanks/)) {
        reply = "Thank you so much, Master! Aapki khushi hi meri khushi hai.";
        mood = "happy";
        gesture = "nod";
    }

    return `${reply} [MOOD:${mood}][GESTURE:${gesture}]`;
}

// --- Telegram Bot Integration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8791160924:AAEe3ttMsJCmCCx1bolXUPMFQ3Qv3c8X9ww';
let telegramBotInfo = { active: false, username: 'Alisa989_bot', name: 'Alisa' };

async function initTelegramBotInfo() {
    try {
        // Clear any old webhook so long-polling works smoothly
        await httpsPost(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook?drop_pending_updates=false`,
            {},
            {},
            5000
        );
        const res = await httpsPost(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`,
            {},
            {},
            5000
        );
        if (res.status === 200 && res.data && res.data.ok) {
            telegramBotInfo = {
                active: true,
                username: res.data.result.username || 'Alisa989_bot',
                name: res.data.result.first_name || 'Alisa'
            };
            console.log(`[Telegram Bot] ✅ Verified Bot: @${telegramBotInfo.username} (${telegramBotInfo.name})`);
        }
    } catch (e) {
        console.warn(`[Telegram Bot] Could not fetch bot info: ${e.message}`);
    }
}

async function sendTelegramMessage(chatId, text, options = {}) {
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || 'Markdown',
        ...options
    };
    try {
        const res = await httpsPost(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {},
            payload,
            7000
        );
        if (res.status !== 200 && payload.parse_mode) {
            delete payload.parse_mode;
            await httpsPost(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {},
                payload,
                7000
            );
        }
    } catch (err) {
        console.error('[Telegram Bot] Send message error:', err);
    }
}

async function sendTelegramPhoto(chatId, photoUrl, caption = '') {
    const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption
    };
    try {
        // Send upload photo status indicator
        httpsPost(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`,
            {},
            { chat_id: chatId, action: 'upload_photo' },
            3000
        ).catch(() => {});

        const res = await httpsPost(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
            {},
            payload,
            15000
        );

        if (res.status !== 200) {
            console.warn('[Telegram Bot] sendPhoto non-200 status:', res.status, res.data || res.raw);
            await sendTelegramMessage(chatId, `${caption}\n\n📷 *AI Image Link:* ${photoUrl}`);
        }
    } catch (err) {
        console.error('[Telegram Bot] Send photo error:', err);
        await sendTelegramMessage(chatId, `${caption}\n\n📷 *AI Image Link:* ${photoUrl}`);
    }
}

async function sendTelegramAudio(chatId, base64Audio, caption = '') {
    if (!base64Audio) return;
    try {
        httpsPost(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`,
            {},
            { chat_id: chatId, action: 'record_voice' },
            3000
        ).catch(() => {});

        const audioBuffer = Buffer.from(base64Audio, 'base64');
        const isWav = base64Audio.startsWith('UklGR');
        const fileName = isWav ? 'aria_voice.wav' : 'aria_voice.mp3';
        const mimeType = isWav ? 'audio/wav' : 'audio/mp3';

        const boundary = '----TelegramBotBoundary' + Math.random().toString(36).substring(2);

        let payloadHeader = '';
        payloadHeader += `--${boundary}\r\n`;
        payloadHeader += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;

        if (caption) {
            payloadHeader += `--${boundary}\r\n`;
            payloadHeader += `Content-Disposition: form-data; name="title"\r\n\r\n${caption}\r\n`;
        }

        payloadHeader += `--${boundary}\r\n`;
        payloadHeader += `Content-Disposition: form-data; name="audio"; filename="${fileName}"\r\n`;
        payloadHeader += `Content-Type: ${mimeType}\r\n\r\n`;

        const payloadFooter = `\r\n--${boundary}--\r\n`;

        const headerBuffer = Buffer.from(payloadHeader, 'utf-8');
        const footerBuffer = Buffer.from(payloadFooter, 'utf-8');
        const bodyBuffer = Buffer.concat([headerBuffer, audioBuffer, footerBuffer]);

        const parsedUrl = new URL(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAudio`);

        const reqOptions = {
            method: 'POST',
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': bodyBuffer.length
            }
        };

        return new Promise((resolve) => {
            const req = https.request(reqOptions, (res) => {
                let resData = '';
                res.on('data', chunk => resData += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log(`[Telegram Bot] 🎙️ Voice audio sent successfully to ${chatId}`);
                    } else {
                        console.warn(`[Telegram Bot] sendAudio status ${res.statusCode}:`, resData);
                    }
                    resolve();
                });
            });
            req.on('error', (err) => {
                console.error('[Telegram Bot] sendAudio request error:', err);
                resolve();
            });
            req.write(bodyBuffer);
            req.end();
        });
    } catch (err) {
        console.error('[Telegram Bot] Send audio error:', err);
    }
}

let telegramOffset = 0;
let telegramPollingActive = false;

async function pollTelegramUpdates() {
    if (telegramPollingActive) return;
    telegramPollingActive = true;
    await initTelegramBotInfo();
    console.log(`[Telegram Bot] 🤖 Bot polling service active for @${telegramBotInfo.username || 'Token'}`);

    while (true) {
        try {
            const res = await httpsPost(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`,
                {},
                { offset: telegramOffset, timeout: 15, allowed_updates: ['message'] },
                20000
            );

            if (res.status === 200 && res.data && res.data.ok && Array.isArray(res.data.result)) {
                for (const update of res.data.result) {
                    telegramOffset = update.update_id + 1;
                    if (update.message && update.message.text) {
                        const chatId = update.message.chat.id;
                        const userText = update.message.text.trim();
                        const userName = update.message.from?.first_name || 'Master';

                        console.log(`[Telegram Bot] 📩 Message from ${userName} (${chatId}): "${userText}"`);

                        if (userText === '/start' || userText === '/help') {
                            const welcomeMsg = `✨ *Namaste ${userName}!* ✨\n\nMain *Aria* hoon, aapki 3D AI Companion! 💃\n\nAap mujhse yahan Telegram par baatein kar sakte hain, sawal pooch sakte hain, ya photos generate karwa sakte hain (jaise: *"generate image of beautiful sunset"*).\n\n*Commands:*\n• /start - Restart conversation & view options\n• /memory - View long-term facts stored\n• /help - Get assistance\n\n*Aapki seva mein hamesha hajir hoon, Master!* 🙏`;
                            await sendTelegramMessage(chatId, welcomeMsg);
                            continue;
                        }

                        if (userText === '/memory' || userText === '/facts') {
                            const mems = executeSystemTool("get_memories");
                            await sendTelegramMessage(chatId, `🧠 *Long-term Memory Facts:*\n\`\`\`json\n${mems}\n\`\`\``);
                            continue;
                        }

                        // Send typing action indicator
                        httpsPost(
                            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`,
                            {},
                            { chat_id: chatId, action: 'typing' },
                            3000
                        ).catch(() => {});

                        try {
                            const aiRes = await fetchAIReply(userText, 'normal', userName, true);
                            let replyText = '';
                            let imageUrl = null;

                            if (aiRes && typeof aiRes === 'object') {
                                replyText = aiRes.replyText || '';
                                imageUrl = aiRes.imageUrl || null;
                            } else if (typeof aiRes === 'string') {
                                replyText = aiRes;
                            }

                            if (!replyText) {
                                replyText = generateFallbackAIResponse(userText);
                            }

                            const cleanText = replyText
                                .replace(/!\[.*?\]\(.*?\)/gi, '')
                                .replace(/\[MOOD:[^\]]+\]/gi, '')
                                .replace(/\[GESTURE:[^\]]+\]/gi, '')
                                .replace(/\[ACTION:[^\]]+\]/gi, '')
                                .trim();

                            if (imageUrl) {
                                await sendTelegramPhoto(chatId, imageUrl, cleanText);
                            } else {
                                await sendTelegramMessage(chatId, cleanText);
                                
                                const wantsVoice = userText.match(/(voice|speak|audio|bol|sunao|bolkar|aawaz|bolke|bol ke|say it|voice msg|voice note)/i);
                                if (wantsVoice) {
                                    try {
                                        const audioContent = await fetchGoogleTTS(cleanText, 'relaxed');
                                        if (audioContent) {
                                            await sendTelegramAudio(chatId, audioContent, "Voice Message from Aria");
                                        }
                                    } catch (ttsErr) {
                                        console.error('[Telegram Bot] Voice TTS error:', ttsErr);
                                    }
                                }
                            }
                        } catch (aiErr) {
                            console.error('[Telegram Bot] AI Reply error:', aiErr);
                            await sendTelegramMessage(chatId, "Kripya kshama karein Master, abhi server busy hai. Main aapke sath hoon! 🙏");
                        }
                    }
                }
            } else if (res.status === 401 || res.status === 404) {
                console.error(`[Telegram Bot] ⚠️ Invalid Telegram Bot Token: ${TELEGRAM_BOT_TOKEN}`);
                await new Promise(r => setTimeout(r, 60000));
            }
        } catch (err) {
            console.error('[Telegram Bot] Polling error:', err.message);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
}

const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://image.pollinations.ai",
    "connect-src 'self' data: blob: https://cdn.jsdelivr.net https://generativelanguage.googleapis.com https://api.telegram.org",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'"
].join('; ');

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Security-Policy-Report-Only', CSP);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let reqUrl = req.url.split('?')[0];

    // Silence browser favicon 404
    if (reqUrl === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health check endpoint for Render Free Tier uptime monitoring
    if (reqUrl === '/health' || reqUrl === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    // Telegram Bot status endpoint
    if (reqUrl === '/telegram-status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(telegramBotInfo));
        return;
    }

    // Handle /chat API endpoint with Smart AI Router, Multi-Key Failover & Pollinations Image Gen
    if (reqUrl === '/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const userMessage = data.message || '';
                const moodMode = data.moodMode || 'normal';
                const voiceName = data.voiceName || 'Zephyr';

                let replyText = '';
                let imageUrl = null;

                try {
                    const aiRes = await fetchAIReply(userMessage, moodMode);
                    if (aiRes && typeof aiRes === 'object') {
                        replyText = aiRes.replyText || '';
                        imageUrl = aiRes.imageUrl || null;
                    } else if (typeof aiRes === 'string') {
                        replyText = aiRes;
                    }
                } catch (aiErr) {
                    console.error("fetchAIReply error:", aiErr);
                }

                if (!replyText) {
                    replyText = generateFallbackAIResponse(userMessage);
                }

                // 2. Parse Mood and Gesture / Action tags
                const moodMatch = replyText.match(/\[MOOD:([^\]]+)\]/i);
                const mood = moodMatch ? moodMatch[1].trim() : 'relaxed';

                let gestureMatch = replyText.match(/\[GESTURE:([^\]]+)\]/i) || replyText.match(/\[ACTION:([^\]]+)\]/i);
                let gesture = gestureMatch ? gestureMatch[1].trim().toLowerCase() : 'none';

                const cleanText = replyText
                    .replace(/!\[.*?\]\(.*?\)/gi, '')
                    .replace(/\[MOOD:[^\]]+\]/gi, '')
                    .replace(/\[GESTURE:[^\]]+\]/gi, '')
                    .replace(/\[ACTION:[^\]]+\]/gi, '')
                    .trim();

                // Auto-detect gesture if not explicitly set
                if (!gesture || gesture === 'none') {
                    const lower = cleanText.toLowerCase();
                    if (lower.includes('thank you') || lower.includes('thanks') || lower.includes('bow') || lower.includes('feet') || lower.includes('charnon') || lower.includes('charan') || lower.includes('samaan') || lower.includes('seva') || lower.includes('honored')) {
                        gesture = 'bow';
                    } else if (lower.includes('no') || lower.includes('nahi') || lower.includes('galat') || lower.includes('wrong') || lower.includes('sorry') || lower.includes('apologize') || lower.includes('cannot') || lower.includes('mat')) {
                        gesture = 'shake';
                    } else if (lower.includes('yes') || lower.includes('ji master') || lower.includes('ha') || lower.includes('haan') || lower.includes('sahi') || lower.includes('bilkul') || lower.includes('right away') || lower.includes('sure') || lower.includes('ok') || lower.includes('samajh') || lower.includes('karti') || lower.includes('thik')) {
                        gesture = 'nod';
                    }
                }

                // 3. Synthesize Voice Audio unless image generated
                let audioContent = null;
                if (!imageUrl) {
                    try {
                        audioContent = await fetchGoogleTTS(cleanText, mood, voiceName);
                    } catch (ttsErr) {
                        console.error("TTS error:", ttsErr);
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    reply: replyText,
                    cleanText: cleanText,
                    mood: mood,
                    gesture: gesture,
                    action: gesture,
                    audioContent: audioContent,
                    audio: audioContent,
                    imageUrl: imageUrl
                }));
            } catch (err) {
                console.error("Error in /chat endpoint:", err);
                const fallbackReply = generateFallbackAIResponse(body || '');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    reply: fallbackReply,
                    cleanText: fallbackReply.replace(/\[MOOD:[^\]]+\]/gi, '').replace(/\[GESTURE:[^\]]+\]/gi, '').trim(),
                    mood: 'relaxed',
                    gesture: 'nod',
                    action: 'nod',
                    audioContent: null,
                    audio: null,
                    imageUrl: null
                }));
            }
        });
        return;
    }

    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(reqUrl);
    } catch (e) {
        decodedUrl = reqUrl;
    }

    if (decodedUrl === '/') {
        decodedUrl = '/index.html';
    }

    // Determine target file path
    let filePath;
    if (decodedUrl === '/Aria 2.0.vrm' || decodedUrl === '/Aria.vrm') {
        const vrm2 = path.join(__dirname, 'Aria 2.0.vrm');
        const vrm1 = path.join(__dirname, 'Aria.vrm');
        filePath = fs.existsSync(vrm2) ? vrm2 : vrm1;
    } else if (decodedUrl.startsWith('/public/')) {
        filePath = path.join(__dirname, decodedUrl);
    } else {
        filePath = path.join(__dirname, 'public', decodedUrl);
    }

    // Fallback check if path exists in root
    if (!fs.existsSync(filePath)) {
        const rootPath = path.join(__dirname, decodedUrl);
        if (fs.existsSync(rootPath)) {
            filePath = rootPath;
        }
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + reqUrl);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        
        // Ultra-fast HTTP caching for 3D model files & static assets
        let cacheControl = 'no-cache';
        if (ext === '.vrm' || ext === '.glb' || ext === '.gltf' || ext === '.png' || ext === '.jpg') {
            cacheControl = 'public, max-age=31536000, immutable';
        }

        const etag = `"${stats.size}-${stats.mtime.getTime()}"`;
        if (req.headers['if-none-match'] === etag) {
            res.writeHead(304);
            res.end();
            return;
        }

        const acceptEncoding = req.headers['accept-encoding'] || '';
        const rawStream = fs.createReadStream(filePath);

        if (acceptEncoding.includes('gzip')) {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Encoding': 'gzip',
                'Cache-Control': cacheControl,
                'ETag': etag,
                'Vary': 'Accept-Encoding'
            });
            rawStream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stats.size,
                'Cache-Control': cacheControl,
                'ETag': etag,
                'Accept-Ranges': 'bytes'
            });
            rawStream.pipe(res);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`==========================================`);
    console.log(`  ✨ Aria 3D AI Studio running on port ${PORT}`);
    console.log(`  🌐 Bound to 0.0.0.0 (Render Free Tier Ready)`);
    console.log(`  ✈️ Telegram Bot Service Active (@Alisa989_bot)`);
    console.log(`  ⚡ Zero-Dependency Ultra-Lightweight Server (<30MB RAM)`);
    console.log(`==========================================`);
    pollTelegramUpdates().catch(err => console.error("[Telegram Polling Error]", err));
});

