const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const os = require('os');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;

// Provided API Keys
const OPENROUTER_API_KEY = "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";
const GOOGLE_API_KEY = "AQ.Ab8RN6If7YhrZfWcVHQ-Pd8LZB8UoxwO72wloUVBzJJjLcSqHw";

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

// Helper: Make HTTPS POST Request
function httpsPost(urlStr, headers, bodyObj) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const postData = JSON.stringify(bodyObj);

        const options = {
            hostname: url.hostname,
            port: 443,
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

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

// Conversation memory buffer
const sessionHistory = [];

// 1. Call OpenRouter AI Brain with Roleplay & Long-Term Memory System
async function fetchOpenRouterAI(userMessage, moodMode = "normal") {
    const MOODS = {
        normal: "You are gentle, soft-spoken, incredibly polite, and deeply affectionate.",
        chill: "You are relaxed, casual, and speak like a close friend. You use slang sometimes and keep things brief.",
        engineer: "You are strict, hyper-focused, and highly technical. You prioritize code accuracy and brutal efficiency over politeness.",
        therapy: "You are extremely empathetic, calm, and soothing. You act as a listener and give warm, comforting advice."
    };

    const moodDescription = MOODS[moodMode] || MOODS.normal;

    // Load Long-Term Memory context
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

    sessionHistory.push({ role: "user", content: userMessage });
    if (sessionHistory.length > 20) sessionHistory.shift();

    const payload = {
        model: "openai/gpt-4o-mini",
        messages: [
            { role: "system", content: systemPrompt },
            ...sessionHistory
        ]
    };

    try {
        const res = await httpsPost(
            'https://openrouter.ai/api/v1/chat/completions',
            { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
            payload
        );

        if (res.status === 200 && res.data && res.data.choices && res.data.choices[0]) {
            const aiContent = res.data.choices[0].message.content.trim();
            sessionHistory.push({ role: "assistant", content: aiContent });
            if (sessionHistory.length > 20) sessionHistory.shift();
            return aiContent;
        }

        const altPayload = { ...payload, model: "google/gemini-2.5-flash" };
        const altRes = await httpsPost(
            'https://openrouter.ai/api/v1/chat/completions',
            { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
            altPayload
        );
        if (altRes.status === 200 && altRes.data && altRes.data.choices && altRes.data.choices[0]) {
            const aiContent = altRes.data.choices[0].message.content.trim();
            sessionHistory.push({ role: "assistant", content: aiContent });
            if (sessionHistory.length > 20) sessionHistory.shift();
            return aiContent;
        }
    } catch (err) {
        console.error("OpenRouter API error:", err);
    }
    return null;
}

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

// 2. Call Gemini 3.1 Flash TTS (preview) for Hyper-Realistic Natural Female Companion Voice (Kore)
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

    for (const model of models) {
        try {
            const res = await httpsPost(
                `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${GOOGLE_API_KEY}`,
                {},
                payload
            );

            if (res.status === 200 && res.data && res.data.candidates && res.data.candidates[0]) {
                const part = res.data.candidates[0].content?.parts?.find(p => p.inlineData);
                if (part && part.inlineData && part.inlineData.data) {
                    const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
                    const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
                    return wavBuffer.toString('base64');
                }
            }
        } catch (err) {
            console.error(`Gemini TTS (${model}) error:`, err);
        }
    }

    // Fallback: Google Translate TTS Engine
    return await fetchGoogleTranslateTTS(text);
}

const fetchGoogleTTS = fetchGeminiTTS;

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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
        return;
    }

    // Handle /chat API endpoint with OpenRouter Brain & Real Female TTS
    if (reqUrl === '/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const userMessage = data.message || '';
                const moodMode = data.moodMode || 'normal';

                // 1. Get Response from OpenRouter AI Brain with Roleplay Persona
                let rawReply = await fetchOpenRouterAI(userMessage, moodMode);
                if (!rawReply) {
                    rawReply = generateFallbackAIResponse(userMessage);
                }

                // 2. Parse Mood and Gesture / Action tags
                const moodMatch = rawReply.match(/\[MOOD:([^\]]+)\]/i);
                const mood = moodMatch ? moodMatch[1].trim() : 'relaxed';

                let gestureMatch = rawReply.match(/\[GESTURE:([^\]]+)\]/i) || rawReply.match(/\[ACTION:([^\]]+)\]/i);
                let gesture = gestureMatch ? gestureMatch[1].trim().toLowerCase() : 'none';

                const cleanText = rawReply
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

                // 3. Synthesize Realistic Female Human Voice Audio (Google TTS with emotion config)
                const audioContent = await fetchGoogleTTS(cleanText, mood);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    reply: rawReply,
                    cleanText: cleanText,
                    mood: mood,
                    gesture: gesture,
                    action: gesture,
                    audioContent: audioContent,
                    audio: audioContent
                }));
            } catch (err) {
                console.error("Error in /chat endpoint:", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server internal error' }));
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
