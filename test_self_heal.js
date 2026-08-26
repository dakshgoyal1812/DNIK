const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

console.log("==========================================");
console.log("  🚀 Running Self-Healing Integration Tests ");
console.log("==========================================");

const serverProcess = require('child_process').spawn('node', ['server.js'], {
    env: { ...process.env, PORT: '3099' },
    stdio: 'ignore'
});

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        req.end();
    });
}

async function runTests() {
    // Give server a moment to spin up on port 3099
    await new Promise(r => setTimeout(r, 1500));

    try {
        console.log("Test 1: GET /api/self-heal");
        const res1 = await request({ hostname: 'localhost', port: 3099, path: '/api/self-heal', method: 'GET' });
        assert.strictEqual(res1.status, 200, "GET /api/self-heal should return status 200");
        assert.strictEqual(res1.data.healthScore, 100, "healthScore should be 100");
        console.log("  ✅ GET /api/self-heal passed!");

        console.log("Test 2: POST /api/self-heal (Client Exception Logging)");
        const res2 = await request(
            { hostname: 'localhost', port: 3099, path: '/api/self-heal', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            { error: 'Simulated UI Test Error', source: 'TestRunner' }
        );
        assert.strictEqual(res2.status, 200, "POST /api/self-heal should return status 200");
        assert.strictEqual(res2.data.status, "healed");
        console.log("  ✅ POST /api/self-heal passed!");

        console.log("Test 3: POST /api/self-heal/heal (Heal Aria Vitality Endpoint)");
        const res3 = await request(
            { hostname: 'localhost', port: 3099, path: '/api/self-heal/heal', method: 'POST' }
        );
        assert.strictEqual(res3.status, 200, "/api/self-heal/heal should return status 200");
        assert.strictEqual(res3.data.healthScore, 100, "Health score should be restored to 100");
        console.log("  ✅ POST /api/self-heal/heal passed!");

        console.log("Test 4: GET /api/self-heal/logs");
        const res4 = await request({ hostname: 'localhost', port: 3099, path: '/api/self-heal/logs', method: 'GET' });
        assert.strictEqual(res4.status, 200, "GET /api/self-heal/logs should return status 200");
        assert.ok(Array.isArray(res4.data.logs), "Log response should contain logs array");
        console.log("  ✅ GET /api/self-heal/logs passed!");

        console.log("Test 5: Verify JSON Data files integrity");
        const dataDir = path.join(__dirname, 'data');
        const files = ['long_term_memory.json', 'reminders.json', 'self_healing_log.json', 'vector_memory.json'];
        for (const file of files) {
            const filePath = path.join(dataDir, file);
            assert.ok(fs.existsSync(filePath), `${file} must exist`);
            const content = fs.readFileSync(filePath, 'utf8');
            assert.doesNotThrow(() => JSON.parse(content), `${file} must contain valid JSON`);
        }
        console.log("  ✅ Data files integrity verified!");

        console.log("\n✨ ALL TESTS PASSED SUCCESSFULLY! ✨");
    } catch (err) {
        console.error("  ❌ Test failure:", err);
        process.exitCode = 1;
    } finally {
        serverProcess.kill();
    }
}

runTests();
