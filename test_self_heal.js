const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Start server on a test port
const TEST_PORT = 3099;
process.env.PORT = TEST_PORT;

// Disable Telegram polling in unit tests to avoid conflicts
process.env.TELEGRAM_BOT_TOKEN = "";

console.log("==========================================");
console.log("  🧪 Running Aria Self-Healing Test Suite");
console.log("==========================================");

function makeRequest(pathName, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';
        const req = http.request({
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: pathName,
            method: method,
            headers: body ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            } : {}
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json, raw: data });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(postData);
        req.end();
    });
}

async function runTests() {
    // Start server process dynamically
    require('./server.js');

    // Wait for server to listen
    await new Promise(r => setTimeout(r, 1000));

    try {
        console.log("1. Testing Health Endpoint (/health)...");
        const healthRes = await makeRequest('/health');
        assert.strictEqual(healthRes.status, 200);
        assert.strictEqual(healthRes.raw, 'OK');
        console.log("   ✅ Passed /health");

        console.log("2. Testing Status Endpoint (/api/status)...");
        const statusRes = await makeRequest('/api/status');
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.data.status, 'ok');
        console.log("   ✅ Passed /api/status");

        console.log("3. Testing Self-Healing Audit Endpoint (GET /api/self-heal)...");
        const auditRes = await makeRequest('/api/self-heal');
        assert.strictEqual(auditRes.status, 200);
        assert.strictEqual(auditRes.data.status, 'healed');
        assert.strictEqual(auditRes.data.healthScore, 100);
        console.log("   ✅ Passed GET /api/self-heal");

        console.log("4. Testing Client Exception Recording (POST /api/self-heal)...");
        const errPayload = { error: "Test Client Script Error", source: "test_self_heal.js" };
        const clientErrRes = await makeRequest('/api/self-heal', 'POST', errPayload);
        assert.strictEqual(clientErrRes.status, 200);
        assert.strictEqual(clientErrRes.data.status, 'healed');
        console.log("   ✅ Passed POST /api/self-heal");

        console.log("5. Testing Deep Vitality Recovery Endpoint (POST /api/self-heal/heal)...");
        const healRes = await makeRequest('/api/self-heal/heal', 'POST');
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.data.status, 'healed');
        assert.strictEqual(healRes.data.healthScore, 100);
        console.log("   ✅ Passed POST /api/self-heal/heal");

        console.log("6. Testing Audit Logs Endpoint (GET /api/self-heal/logs)...");
        const logsRes = await makeRequest('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert.ok(Array.isArray(logsRes.data.logs));
        assert.ok(logsRes.data.logs.length > 0);
        console.log("   ✅ Passed GET /api/self-heal/logs");

        console.log("7. Testing Full System State Recovery Endpoint (POST /api/self-heal/recover)...");
        const recoverRes = await makeRequest('/api/self-heal/recover', 'POST');
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.data.status, 'recovered');
        assert.strictEqual(recoverRes.data.healthScore, 100);
        console.log("   ✅ Passed POST /api/self-heal/recover");

        console.log("8. Testing Data File Auto-Restoration on Corruption...");
        const remindersFile = path.join(__dirname, 'data', 'reminders.json');
        fs.writeFileSync(remindersFile, "INVALID JSON CORRUPTED FILE", 'utf8');

        // Trigger audit via API
        const auditRestoreRes = await makeRequest('/api/self-heal');
        assert.strictEqual(auditRestoreRes.status, 200);

        // Verify file was restored to valid JSON
        const restoredContent = fs.readFileSync(remindersFile, 'utf8');
        assert.doesNotThrow(() => JSON.parse(restoredContent));
        console.log("   ✅ Passed Data File Auto-Restoration");

        console.log("==========================================");
        console.log("  ✨ ALL INTEGRATION TESTS PASSED!");
        console.log("==========================================");

        process.exit(0);
    } catch (err) {
        console.error("❌ Test failed:", err);
        process.exit(1);
    }
}

runTests();
