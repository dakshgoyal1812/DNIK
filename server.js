const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Provided API Keys
const OPENROUTER_API_KEY = "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";
const GOOGLE_API_KEY = "AQ.Ab8RN6If7YhrZfWcVHQ-Pd8LZB8UoxwO72wloUVBzJJjLcSqHw";

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
    '.wasm': 'application/wasm'
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

// 1. Call OpenRouter AI Brain
async function fetchOpenRouterAI(userMessage) {
    const systemPrompt = `You are Aria, a warm, charming, highly intelligent female 3D human companion.
Talk naturally like a real human friend (using natural Hinglish or English as the user prefers).
Keep your responses short, expressive, and conversational (1-2 sentences max).
At the very end of your response, ALWAYS include tags in exact format:
[MOOD:happy|sad|angry|surprised|relaxed][GESTURE:wave|nod|point|think|none]
Example: "I am doing great today! How about you? [MOOD:happy][GESTURE:wave]"
Example: "Hmm, let me think about that... [MOOD:relaxed][GESTURE:think]"`;

    const payload = {
        model: "openai/gpt-4o-mini",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
        ]
    };

    try {
        const res = await httpsPost(
            'https://openrouter.ai/api/v1/chat/completions',
            { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
            payload
        );

        if (res.status === 200 && res.data && res.data.choices && res.data.choices[0]) {
            return res.data.choices[0].message.content.trim();
        }

        const altPayload = { ...payload, model: "google/gemini-2.5-flash" };
        const altRes = await httpsPost(
            'https://openrouter.ai/api/v1/chat/completions',
            { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
            altPayload
        );
        if (altRes.status === 200 && altRes.data && altRes.data.choices && altRes.data.choices[0]) {
            return altRes.data.choices[0].message.content.trim();
        }
    } catch (err) {
        console.error("OpenRouter API error:", err);
    }
    return null;
}

// Helper: Calculate TTS pitch & rate based on emotion mood
function getTTSAudioConfig(moodStr) {
    let pitch = 0.4;
    let speakingRate = 1.30;

    if (!moodStr) return { pitch, speakingRate };

    const lower = moodStr.toLowerCase();
    if (lower.includes('happy')) {
        pitch = 1.6;
        speakingRate = 1.38;
    } else if (lower.includes('sad')) {
        pitch = -1.5;
        speakingRate = 1.15;
    } else if (lower.includes('angry')) {
        pitch = -0.5;
        speakingRate = 1.40;
    } else if (lower.includes('surprised')) {
        pitch = 2.2;
        speakingRate = 1.35;
    } else if (lower.includes('relaxed')) {
        pitch = 0.2;
        speakingRate = 1.28;
    }

    return { pitch, speakingRate };
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

// 2. Call Google Text-to-Speech for Realistic Hindi Female Human Voice
async function fetchGoogleTTS(text, moodStr = 'relaxed') {
    if (!text) return null;

    // Use high-quality Hindi Female Neural2 voice by default
    const languageCode = 'hi-IN';
    const voiceName = 'hi-IN-Neural2-A';

    const audioProps = getTTSAudioConfig(moodStr);

    const payload = {
        input: { text: text },
        voice: {
            languageCode: languageCode,
            name: voiceName,
            ssmlGender: 'FEMALE'
        },
        audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: audioProps.speakingRate,
            pitch: audioProps.pitch
        }
    };

    try {
        let res = await httpsPost(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_API_KEY}`,
            {},
            payload
        );

        if (res.status === 200 && res.data && res.data.audioContent) {
            return res.data.audioContent;
        } else {
            // Fallback 1: Wavenet Hindi Female voice
            payload.voice.name = 'hi-IN-Wavenet-A';
            const fallbackRes = await httpsPost(
                `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_API_KEY}`,
                {},
                payload
            );
            if (fallbackRes.status === 200 && fallbackRes.data && fallbackRes.data.audioContent) {
                return fallbackRes.data.audioContent;
            }
        }
    } catch (err) {
        console.error("Google Cloud TTS error:", err);
    }

    // Fallback 2: Google Female Voice Engine
    return await fetchGoogleTranslateTTS(text);
}

// Local Smart Fallback Generator
function generateFallbackAIResponse(message) {
    const text = message.toLowerCase().trim();
    let reply = "I understand! Main aapki baat samajh rahi hoon, tell me more about it!";
    let mood = "relaxed";
    let gesture = "none";

    if (text.match(/hi|hello|hey|namaste|greetings/)) {
        reply = "Namaste! Main Aria hoon, aapki real 3D companion. Aaj aap kaisa feel kar rahe hain?";
        mood = "happy";
        gesture = "wave";
    } else if (text.match(/think|why|how|explain|what/)) {
        reply = "Hmm, let me think about that for a second!";
        mood = "relaxed";
        gesture = "think";
    } else if (text.match(/sad|upset|sorry|bad day/)) {
        reply = "Oh no, don't be sad. Main aapke sath hoon, sab thik ho jayega!";
        mood = "sad";
        gesture = "nod";
    } else if (text.match(/angry|mad|annoyed/)) {
        reply = "Shant ho jaiye, relax! Deep breath lijiye.";
        mood = "angry";
        gesture = "point";
    } else if (text.match(/wow|surprised|omg/)) {
        reply = "Wow! Ye toh bahut hi amazing baat hai!";
        mood = "surprised";
        gesture = "nod";
    } else if (text.match(/happy|great|awesome|thanks/)) {
        reply = "Thank you so much! Ye sunkar mujhe bahut khushi hui!";
        mood = "happy";
        gesture = "wave";
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

    // Handle /chat API endpoint with OpenRouter Brain & Real Female TTS
    if (reqUrl === '/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const userMessage = data.message || '';

                // 1. Get Response from OpenRouter AI Brain
                let rawReply = await fetchOpenRouterAI(userMessage);
                if (!rawReply) {
                    rawReply = generateFallbackAIResponse(userMessage);
                }

                // 2. Parse Mood and Gesture / Action tags
                const moodMatch = rawReply.match(/\[MOOD:([^\]]+)\]/i);
                const mood = moodMatch ? moodMatch[1].trim() : 'relaxed';

                const gestureMatch = rawReply.match(/\[GESTURE:([^\]]+)\]/i) || rawReply.match(/\[ACTION:([^\]]+)\]/i);
                const gesture = gestureMatch ? gestureMatch[1].trim().toLowerCase() : 'none';

                const cleanText = rawReply
                    .replace(/\[MOOD:[^\]]+\]/gi, '')
                    .replace(/\[GESTURE:[^\]]+\]/gi, '')
                    .replace(/\[ACTION:[^\]]+\]/gi, '')
                    .trim();

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

    if (reqUrl === '/') {
        reqUrl = '/index.html';
    }

    // Determine target file path
    let filePath;
    if (reqUrl === '/Aria.vrm') {
        filePath = path.join(__dirname, 'Aria.vrm');
    } else if (reqUrl.startsWith('/public/')) {
        filePath = path.join(__dirname, reqUrl);
    } else {
        filePath = path.join(__dirname, 'public', reqUrl);
    }

    // Fallback check if path exists in root
    if (!fs.existsSync(filePath)) {
        const rootPath = path.join(__dirname, reqUrl);
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

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size,
            'Cache-Control': 'no-cache'
        });

        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`  Aria AI Studio running at http://localhost:${PORT}`);
    console.log(`  OpenRouter AI Brain & Google Voice Active!`);
    console.log(`==========================================`);
});
