const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3098;
const BASE_URL = `http://localhost:${PORT}`;

function httpRequest(urlStr, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const reqOpts = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        if (postData) {
            reqOpts.headers['Content-Type'] = 'application/json';
            reqOpts.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = http.request(reqOpts, (res) => {
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

        req.on('error', err => reject(err));
        if (postData) req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log("==========================================");
    console.log(" 🧪 Starting Aria Self-Healing Integration Test Suite");
    console.log("==========================================");

    let serverProcess;
    try {
        serverProcess = spawn('node', ['server.js'], {
            env: { ...process.env, PORT: String(PORT) },
            stdio: 'pipe'
        });

        await new Promise(r => setTimeout(r, 2500));

        let passed = 0;
        let failed = 0;

        function assert(condition, message) {
            if (condition) {
                console.log(` ✅ PASS: ${message}`);
                passed++;
            } else {
                console.error(` ❌ FAIL: ${message}`);
                failed++;
            }
        }

        // Test 1: System status endpoint
        const statusRes = await httpRequest(`${BASE_URL}/api/status`);
        assert(statusRes.status === 200 && statusRes.data.status === 'ok', 'GET /api/status returns HTTP 200 OK');

        // Test 2: Self-heal GET audit
        const healGetRes = await httpRequest(`${BASE_URL}/api/self-heal`);
        assert(healGetRes.status === 200 && healGetRes.data.status === 'healed' && healGetRes.data.healthScore === 100, 'GET /api/self-heal audit report (Health: 100%)');

        // Test 3: Self-heal POST client exception logging
        const exceptionPayload = JSON.stringify({ error: 'WebGL context loss simulated in test', source: 'IntegrationTest' });
        const healPostRes = await httpRequest(`${BASE_URL}/api/self-heal`, { method: 'POST' }, exceptionPayload);
        assert(healPostRes.status === 200 && healPostRes.data.status === 'mitigated', 'POST /api/self-heal logs and mitigates client exception');

        // Test 4: Self-heal logs retrieval
        const logsRes = await httpRequest(`${BASE_URL}/api/self-heal/logs`);
        assert(logsRes.status === 200 && Array.isArray(logsRes.data.logs), 'GET /api/self-heal/logs returns audit logs array');

        // Test 5: Self-heal full recovery POST
        const recoverRes = await httpRequest(`${BASE_URL}/api/self-heal/recover`, { method: 'POST' }, JSON.stringify({}));
        assert(recoverRes.status === 200 && recoverRes.data.status === 'recovered', 'POST /api/self-heal/recover restores system state');

        // Test 6: New Feature - Aria Deep Vitality Healing
        const healFeatureRes = await httpRequest(`${BASE_URL}/api/self-heal/heal`, { method: 'POST' }, JSON.stringify({}));
        assert(healFeatureRes.status === 200 && healFeatureRes.data.status === 'healed', 'POST /api/self-heal/heal triggers vitality recovery');

        // Test 7: Chat API Endpoint
        const chatPayload = JSON.stringify({ message: "Hello Aria!", moodMode: "normal" });
        const chatRes = await httpRequest(`${BASE_URL}/chat`, { method: 'POST' }, chatPayload);
        assert(chatRes.status === 200 && typeof chatRes.data.reply === 'string', 'POST /chat returns valid response and mood tags');

        // Test 8: Data Files Integrity
        const logPath = path.join(__dirname, 'data', 'self_healing_log.json');
        const memPath = path.join(__dirname, 'data', 'long_term_memory.json');
        const remPath = path.join(__dirname, 'data', 'reminders.json');

        assert(fs.existsSync(logPath) && fs.existsSync(memPath) && fs.existsSync(remPath), 'All data/ persistence JSON files exist and are intact');

        console.log("==========================================");
        console.log(` 📊 Test Results: ${passed} Passed, ${failed} Failed`);
        console.log("==========================================");

        if (failed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } catch (err) {
        console.error("Test execution error:", err);
        process.exit(1);
    } finally {
        if (serverProcess) {
            serverProcess.kill('SIGTERM');
        }
    }
}

runTests();
