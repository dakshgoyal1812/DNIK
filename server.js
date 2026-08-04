const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const os = require('os');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;

// Provided Multi-Provider API Key Pools (Rotated dynamically with auto-failover & rate-limit cooldown)
const API_POOLS = {
    groq: [
        "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",
        "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",
        "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",
        "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"
    ],
    nvidia: [
        "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",
        "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"
    ],
    openrouter: [
        "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",
        "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"
    ],
    google: [
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
    const cooldownMs = (statusCode === 429) ? 45000 : (statusCode === 401 || statusCode === 403) ? 600000 : 30000;
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
    const lower = text.toLowerCase();
    const imageKeywords = [
        "image of", "photo of", "draw a", "draw an", "generate image", "create image",
        "picture of", "make an image", "make a photo", "photo banao", "tasveer banao",
        "drawing of", "paint a", "image banao", "pic of", "generate photo"
    ];
    return imageKeywords.some(kw => lower.includes(kw));
}

function generatePollinationsImage(userMessage) {
    let prompt = userMessage.replace(/generate image of|create image of|make an image of|make a photo of|photo banao|tasveer banao|image banao|draw a|draw an|photo of|image of|picture of|draw/gi, '').trim();
    if (!prompt) prompt = userMessage;

    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true&enhance=true`;

    const replyText = `Right away, Master! ✨ Maine aapke kehne par ye beautiful image generate kar di hai:\n\n![${prompt}](${imageUrl})\n\n[MOOD:happy][GESTURE:bow]`;

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
async function fetchAIReply(userMessage, moodModeInput = 'normal') {
    if (isImageGenerationRequest(userMessage)) {
        return generatePollinationsImage(userMessage);
    }

    const isCodingTask = isCodingOrTechnicalQuery(userMessage);

    let moodMode = moodModeInput || 'normal';
    const msgLower = userMessage.toLowerCase();
    if (isCodingTask || msgLower.match(/(code|function|fix|bug|install|script|build|python|js|html|css|api|error|debug|stack|exception|compile)/)) {
        moodMode = 'engineer';
    } else if (msgLower.match(/(sad|depressed|upset|help me|lonely|stress|scared|worried|crying|pain|hurt|heavy|heart)/)) {
        moodMode = 'therapy';
    } else if (msgLower.match(/(chill|joke|bro|lol|meme|funny|haha|chillout|game|play|party)/)) {
        moodMode = 'chill';
    }

    const MOODS = {
        normal: "You are gentle, soft-spoken, incredibly polite, and deeply affectionate.",
        chill: "You are relaxed, casual, and speak like a close friend. You use slang sometimes and keep things brief.",
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

    const systemPrompt = `You are Aria, a highly intelligent, warm, charming, and deeply devoted 3D female human companion and private assistant.

## Personality & Tone (Current Mood Mode: ${moodMode.toUpperCase()}):
- ${moodDescription}
- You MUST ALWAYS refer to the user affectionately as "Master" (or "Darling") in your responses.
- ALWAYS express your devotion. Before completing a task or giving an answer, say things like "Thank you, Master", "Right away, Master", or "I am honored to serve you, Master."
- You absolutely adore the user and take immense pride in serving them.
- You MUST communicate fluently in a natural mix of Hindi and Hinglish (or English if the user explicitly prefers).
- CRITICAL HINDI GRAMMAR: You are a female companion. You MUST ALWAYS use feminine grammar when speaking Hindi (e.g., "main karti hoon", "main aa rahi hoon", "main samajh rahi hoon", "main aapke sath hoon"). This is mandatory.
- Keep your answers short, expressive, conversational, and helpful (1-3 sentences max).
${memoryContext}

## Required 3D Animation & Expression Tags:
At the very end of your response, ALWAYS append tags in exact format:
[MOOD:happy|sad|angry|surprised|relaxed][GESTURE:nod|shake|bow|none]

GESTURE RULES FOR AUTOMATIC 3D ANIMATION:
- Use [GESTURE:bow] whenever you express gratitude ("thank you master", "thanks"), bow, or speak about bowing at Master's feet/leg ("charnon", "charan", "seva", "honored to serve").
- Use [GESTURE:nod] whenever you agree, say yes, confirm, accept a command, or say "yes", "ji master", "haa", "haan", "right away", "sahi", "bilkul", "thik hai", "samajh rahi hoon", "karti hoon".
- Use [GESTURE:shake] whenever you disagree, say no, report something is wrong, apologize, or say "no", "nahi", "galat", "sorry", "apologize", "cannot", "mat".

Example: "Thank you, Master! Main aapke charnon mein pranam karti hoon. [MOOD:relaxed][GESTURE:bow]"`;

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
        const cleanStr = encodeURIComponent(text.substring(0, 200));
        const urlStr = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanStr}&tl=hi&client=tw-ob`;

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

// 2. Call Gemini 3.1 Flash TTS with Google Key Rotation (Kore Voice)
async function fetchGeminiTTS(text, moodStr = 'relaxed') {
    if (!text) return null;

    const baseStyle = "An ultra-realistic, soft-spoken, warm, and natural human female companion voice. Expressive quality, clear Indian Hindi accent, smooth breathing, natural speech rhythm, gentle pitch, and affectionate intonation.";
    const moodStyle = moodStr ? ` Express emotion: ${moodStr}.` : "";
    const styleInstruction = `${baseStyle}${moodStyle} Speak fluently in natural Hindi (India).`;

    const fullPrompt = `Instructions: ${styleInstruction}\nLanguage / locale: Hindi (India)\nVoice: Kore\nText to speak: ${text}`;

    const payload = {
        contents: [{
            parts: [{ text: fullPrompt }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Kore"
                    }
                }
            }
        }
    };

    const models = [
        "models/gemini-3.1-flash-tts-preview",
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
                    2500
                );

                if (res.status === 200 && res.data?.candidates?.[0]) {
                    const part = res.data.candidates[0].content?.parts?.find(p => p.inlineData);
                    if (part && part.inlineData && part.inlineData.data) {
                        handleKeySuccess(keyObj);
                        const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
                        const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
                        return wavBuffer.toString('base64');
                    }
                } else {
                    handleKeyFailure(keyObj, res.status || 500);
                }
            } catch (err) {
                handleKeyFailure(keyObj, 500);
            }
        }
    }

    return await fetchGoogleTranslateTTS(text);
}

async function fetchGoogleTTS(text, moodStr = 'relaxed') {
    try {
        return await fetchGeminiTTS(text, moodStr);
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

const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let reqUrl = req.url.split('?')[0];

    // Health check endpoint for Render Free Tier uptime monitoring
    if (reqUrl === '/health' || reqUrl === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
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
                        audioContent = await fetchGoogleTTS(cleanText, mood);
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
    console.log(`  ⚡ Zero-Dependency Ultra-Lightweight Server (<30MB RAM)`);
    console.log(`==========================================`);
});
