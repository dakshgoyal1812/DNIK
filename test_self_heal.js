const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Start backend server on test port 3999
process.env.PORT = '3999';
const serverProcess = require('child_process').fork('./server.js', [], {
    env: { ...process.env, PORT: '3999' }
});

function httpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
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
        req.on('error', reject);
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log("Waiting for server startup on port 3999...");
    await new Promise(r => setTimeout(r, 2000));

    try {
        console.log("Test 1: GET /api/self-heal");
        const healRes = await httpRequest({
            hostname: '127.0.0.1',
            port: 3999,
            path: '/api/self-heal',
            method: 'GET'
        });
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.data.status, 'healed');
        assert.strictEqual(healRes.data.healthScore, 100);
        console.log("✅ Test 1 Passed: Self-heal GET endpoint returned 200 OK & 100% health score.");

        console.log("Test 2: POST /api/self-heal (Client exception mitigation)");
        const postRes = await httpRequest({
            hostname: '127.0.0.1',
            port: 3999,
            path: '/api/self-heal',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { error: 'Test WebGL context lost', source: 'Integration Test' });
        assert.strictEqual(postRes.status, 200);
        assert.strictEqual(postRes.data.status, 'mitigated');
        console.log("✅ Test 2 Passed: Client error successfully logged and mitigated.");

        console.log("Test 3: GET /api/self-heal/logs");
        const logsRes = await httpRequest({
            hostname: '127.0.0.1',
            port: 3999,
            path: '/api/self-heal/logs',
            method: 'GET'
        });
        assert.strictEqual(logsRes.status, 200);
        assert.strictEqual(logsRes.data.status, 'ok');
        assert(Array.isArray(logsRes.data.logs));
        assert(logsRes.data.logs.length > 0);
        console.log("✅ Test 3 Passed: Self-heal logs endpoint returned non-empty audit entries.");

        console.log("Test 4: Corrupt state restoration test");
        const corruptFile = path.join(__dirname, 'data', 'reminders.json');
        fs.writeFileSync(corruptFile, 'INVALID JSON {{{', 'utf8');
        const repairRes = await httpRequest({
            hostname: '127.0.0.1',
            port: 3999,
            path: '/api/self-heal',
            method: 'GET'
        });
        assert.strictEqual(repairRes.status, 200);
        const restoredContent = fs.readFileSync(corruptFile, 'utf8');
        JSON.parse(restoredContent); // Should parse cleanly
        console.log("✅ Test 4 Passed: Corrupted state file automatically detected and repaired.");

        console.log("\n🎉 ALL SELF-HEALING TESTS PASSED SUCCESSFULLY!");
    } catch (err) {
        console.error("❌ Test failure:", err);
        process.exitCode = 1;
    } finally {
        serverProcess.kill();
        process.exit(process.exitCode || 0);
    }
}

runTests();
