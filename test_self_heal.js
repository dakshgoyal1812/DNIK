const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Integration Test Suite for Aria 3D Companion Self-Healing & System Tools
async function runTests() {
    console.log("==========================================");
    console.log("  🧪 Running Aria 3D Integration Test Suite");
    console.log("==========================================");

    // 1. Test Data Files Integrity
    const dataDir = path.join(__dirname, 'data');
    assert(fs.existsSync(dataDir), "data/ directory should exist");

    const requiredFiles = ['long_term_memory.json', 'reminders.json', 'self_healing_log.json', 'vector_memory.json'];
    for (const f of requiredFiles) {
        const fp = path.join(dataDir, f);
        assert(fs.existsSync(fp), `${f} should exist`);
        const content = fs.readFileSync(fp, 'utf8');
        assert.doesNotThrow(() => JSON.parse(content), `${f} should contain valid JSON`);
    }
    console.log("✅ [1/4] Data storage integrity test passed");

    // Start server on test port 3099
    process.env.PORT = '3099';
    require('./server.js');
    await new Promise(r => setTimeout(r, 1000));

    // Helpers for HTTP requests
    function httpGet(urlPath) {
        return new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:3099${urlPath}`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                    catch(e) { resolve({ status: res.statusCode, raw: data }); }
                });
            }).on('error', reject);
        });
    }

    function httpPost(urlPath, bodyObj) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify(bodyObj || {});
            const req = http.request(`http://127.0.0.1:3099${urlPath}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                    catch(e) { resolve({ status: res.statusCode, raw: data }); }
                });
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    // 2. Test Status & Health Endpoints
    const statusRes = await httpGet('/api/status');
    assert.strictEqual(statusRes.status, 200, "/api/status should return 200");
    assert.strictEqual(statusRes.data.status, "ok", "/api/status status should be ok");

    const selfHealGet = await httpGet('/api/self-heal');
    assert.strictEqual(selfHealGet.status, 200, "/api/self-heal GET should return 200");
    assert.strictEqual(selfHealGet.data.status, "healed", "/api/self-heal status should be healed");
    assert.strictEqual(selfHealGet.data.healthScore, 100, "/api/self-heal health score should be 100");
    console.log("✅ [2/4] Health telemetry endpoints test passed");

    // 3. Test Client Exception Mitigation & Heal Aria Endpoint
    const excRes = await httpPost('/api/self-heal', { error: 'Test client error', source: 'Unit Test' });
    assert.strictEqual(excRes.status, 200, "/api/self-heal POST exception should return 200");
    assert.strictEqual(excRes.data.status, "healed");

    const healRes = await httpPost('/api/self-heal/heal', {});
    assert.strictEqual(healRes.status, 200, "/api/self-heal/heal should return 200");
    assert.strictEqual(healRes.data.healthScore, 100, "Heal Aria should restore health score to 100");

    const logsRes = await httpGet('/api/self-heal/logs');
    assert.strictEqual(logsRes.status, 200, "/api/self-heal/logs should return 200");
    assert(Array.isArray(logsRes.data.logs), "logs should be an array");
    console.log("✅ [3/4] Client exception mitigation & Heal Aria endpoint test passed");

    // 4. Test /chat endpoint & System Tool dispatch
    const chatRes = await httpPost('/chat', { message: 'remember my favorite color is teal' });
    assert.strictEqual(chatRes.status, 200, "/chat should return 200");
    assert(chatRes.data.reply, "/chat should return reply");
    console.log("✅ [4/4] Chat API & System tool integration test passed");

    console.log("\n✨ All Integration Tests Passed Successfully!");
    process.exit(0);
}

runTests().catch(err => {
    console.error("❌ Test Suite Failed:", err);
    process.exit(1);
});
