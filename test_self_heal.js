const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TEST_PORT = 3001;
process.env.PORT = TEST_PORT;

// Helper for making HTTP requests
function makeRequest(pathStr, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';
        const options = {
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: pathStr,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, body: json });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', (err) => reject(err));
        if (postData) req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log("==================================================");
    console.log("🧪 Starting Aria Self-Healing Integration Test Suite");
    console.log("==================================================");

    // Require server to start it on TEST_PORT
    require('./server.js');
    await new Promise(r => setTimeout(r, 1000)); // Allow server to bind

    let passed = 0;
    let failed = 0;

    async function testCase(name, fn) {
        try {
            await fn();
            console.log(`  ✅ PASSED: ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ FAILED: ${name}`);
            console.error(`     Error: ${err.message}`);
            failed++;
        }
    }

    // Test 1: GET /api/status endpoint
    await testCase("GET /api/status returns OK status", async () => {
        const res = await makeRequest('/api/status');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, "ok");
        assert.strictEqual(res.body.system, "Aria 3D AI Companion");
    });

    // Test 2: GET /api/self-heal diagnostic endpoint
    await testCase("GET /api/self-heal returns 100% health & report", async () => {
        const res = await makeRequest('/api/self-heal');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, "healed");
        assert.strictEqual(res.body.healthScore, 100);
        assert.strictEqual(res.body.systemIntegrity, 100);
        assert.ok(res.body.report, "Audit report should be present");
    });

    // Test 3: POST /api/self-heal client exception logging & mitigation
    await testCase("POST /api/self-heal logs and mitigates client exception", async () => {
        const payload = { error: "Test UI Exception", source: "Integration Test" };
        const res = await makeRequest('/api/self-heal', 'POST', payload);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, "healed");
        assert.strictEqual(res.body.healthScore, 100);

        // Verify log entry written to self_healing_log.json
        const logPath = path.join(__dirname, 'data', 'self_healing_log.json');
        assert.ok(fs.existsSync(logPath), "self_healing_log.json should exist");
        const logContent = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        assert.ok(logContent.logs.some(l => l.error === "Test UI Exception"), "Exception should be recorded in logs");
    });

    // Test 4: GET /api/self-heal/heal deep vitality recovery
    await testCase("GET /api/self-heal/heal restores vitality and health score to 100%", async () => {
        const res = await makeRequest('/api/self-heal/heal');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, "healed");
        assert.strictEqual(res.body.healthScore, 100);
        assert.strictEqual(res.body.systemIntegrity, 100);
    });

    // Test 5: GET /api/self-heal/logs endpoint queries real-time logs
    await testCase("GET /api/self-heal/logs queries audit logs and metrics", async () => {
        const res = await makeRequest('/api/self-heal/logs');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, "ok");
        assert.strictEqual(res.body.healthScore, 100);
        assert.ok(Array.isArray(res.body.logs), "logs should be an array");
    });

    // Test 6: POST /api/self-heal/recover endpoint
    await testCase("POST /api/self-heal/recover executes full state recovery", async () => {
        const res = await makeRequest('/api/self-heal/recover', 'POST');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, "recovered");
        assert.strictEqual(res.body.healthScore, 100);
    });

    // Test 7: Data Integrity & Auto-Restoration on Corrupt File
    await testCase("Self-Healing Audit auto-restores corrupted data JSON files", async () => {
        const dataDir = path.join(__dirname, 'data');
        const testCorruptPath = path.join(dataDir, 'reminders.json');

        // Intentionally corrupt reminders.json
        fs.writeFileSync(testCorruptPath, "{ INVALID JSON DATA", 'utf8');

        // Trigger audit via GET /api/self-heal
        const res = await makeRequest('/api/self-heal');
        assert.strictEqual(res.status, 200);

        // Verify file is restored to valid JSON
        const restoredContent = fs.readFileSync(testCorruptPath, 'utf8');
        assert.doesNotThrow(() => JSON.parse(restoredContent), "Corrupted file should be restored to valid JSON");
    });

    // Test 8: Chat endpoint fallback response
    await testCase("POST /chat responds cleanly with fallback persona & system tools", async () => {
        const res = await makeRequest('/chat', 'POST', { message: "What time is it?" });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.reply, "Reply should be present");
        assert.ok(res.body.cleanText, "cleanText should be present");
        assert.ok(res.body.mood, "mood should be present");
    });

    console.log("==================================================");
    console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error("Fatal Test Suite Error:", err);
    process.exit(1);
});
