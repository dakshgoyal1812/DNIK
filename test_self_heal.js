const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Helper: Make HTTP request
function httpRequest(urlStr, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const options = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
            method: method,
            headers: {}
        };

        let postData = '';
        if (body) {
            postData = typeof body === 'string' ? body : JSON.stringify(body);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch (e) {}
                resolve({ status: res.statusCode, data: json, raw: data });
            });
        });

        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Starting Aria 3D Self-Healing & API Test Suite...\n');

    // Start server in background for testing
    const serverProc = require('child_process').spawn('node', ['server.js'], {
        env: { ...process.env, PORT: '3005' },
        stdio: 'inherit'
    });

    // Allow server 2.5s to start up
    await new Promise(resolve => setTimeout(resolve, 2500));

    const baseUrl = 'http://localhost:3005';

    try {
        // Test 1: Health Check
        console.log('Test 1: GET /health');
        const resHealth = await httpRequest(`${baseUrl}/health`);
        assert.strictEqual(resHealth.status, 200);
        assert.strictEqual(resHealth.raw, 'OK');
        console.log('  ✅ /health passed');

        // Test 2: System Status Overview
        console.log('Test 2: GET /api/status');
        const resStatus = await httpRequest(`${baseUrl}/api/status`);
        assert.strictEqual(resStatus.status, 200);
        assert.strictEqual(resStatus.data.status, 'ok');
        assert.strictEqual(resStatus.data.system, 'Aria 3D AI Companion');
        console.log('  ✅ /api/status passed');

        // Test 3: Self-Healing Audit Endpoint
        console.log('Test 3: GET /api/self-heal');
        const resSelfHeal = await httpRequest(`${baseUrl}/api/self-heal`);
        assert.strictEqual(resSelfHeal.status, 200);
        assert.strictEqual(resSelfHeal.data.status, 'healed');
        assert.strictEqual(resSelfHeal.data.healthScore, 100);
        assert.strictEqual(resSelfHeal.data.systemIntegrity, 100);
        console.log('  ✅ GET /api/self-heal passed');

        // Test 4: Heal Aria Vitality Endpoint
        console.log('Test 4: POST /api/self-heal/heal');
        const resHeal = await httpRequest(`${baseUrl}/api/self-heal/heal`, 'POST');
        assert.strictEqual(resHeal.status, 200);
        assert.strictEqual(resHeal.data.status, 'healed');
        assert.strictEqual(resHeal.data.healthScore, 100);
        console.log('  ✅ POST /api/self-heal/heal passed');

        // Test 5: Self-Healing Logs Endpoint
        console.log('Test 5: GET /api/self-heal/logs');
        const resLogs = await httpRequest(`${baseUrl}/api/self-heal/logs`);
        assert.strictEqual(resLogs.status, 200);
        assert.strictEqual(resLogs.data.healthScore, 100);
        assert(Array.isArray(resLogs.data.logs));
        console.log('  ✅ GET /api/self-heal/logs passed');

        // Test 6: Client Exception Logging
        console.log('Test 6: POST /api/self-heal (Client Exception Mitigation)');
        const resClientErr = await httpRequest(`${baseUrl}/api/self-heal`, 'POST', {
            error: 'Test simulated UI exception',
            source: 'Unit Test Suite'
        });
        assert.strictEqual(resClientErr.status, 200);
        assert.strictEqual(resClientErr.data.status, 'healed');
        assert.strictEqual(resClientErr.data.healthScore, 100);
        console.log('  ✅ Client Exception Mitigation passed');

        // Test 7: Chat Endpoint with Fallback & System Tools
        console.log('Test 7: POST /chat (Fallback Response)');
        const resChat = await httpRequest(`${baseUrl}/chat`, 'POST', {
            message: 'what time is it'
        });
        assert.strictEqual(resChat.status, 200);
        assert(resChat.data.reply && resChat.data.reply.length > 0);
        assert(resChat.data.mood && resChat.data.mood.length > 0);
        assert(resChat.data.gesture && resChat.data.gesture.length > 0);
        console.log('  ✅ POST /chat passed (Reply: ' + resChat.data.cleanText + ')');

        // Verify Data Directory JSON persistence
        console.log('Test 8: Data Directory Integrity Check');
        const logFile = path.join(__dirname, 'data', 'self_healing_log.json');
        assert(fs.existsSync(logFile), 'self_healing_log.json exists');
        const parsedLog = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
        assert.strictEqual(parsedLog.healthScore, 100);
        console.log('  ✅ Data directory JSON files verified');

        console.log('\n🎉 ALL 8 TESTS PASSED SUCCESSFULLY!\n');
    } catch (err) {
        console.error('\n❌ TEST FAILED:', err);
        process.exitCode = 1;
    } finally {
        serverProc.kill();
    }
}

runTests();
