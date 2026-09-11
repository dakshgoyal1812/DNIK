const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Start server on a test port
const TEST_PORT = 3099;
process.env.PORT = TEST_PORT;

console.log('🚀 Starting test suite for Aria Self-Healing & System Tools...');

const serverProcess = require('child_process').fork(path.join(__dirname, 'server.js'), [], {
    env: { ...process.env, PORT: TEST_PORT },
    silent: true
});

function request(method, pathStr, bodyObj = null) {
    return new Promise((resolve, reject) => {
        const postData = bodyObj ? JSON.stringify(bodyObj) : '';
        const req = http.request({
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: pathStr,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
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
        if (postData) req.write(postData);
        req.end();
    });
}

async function runTests() {
    // Wait 2 seconds for server startup
    await new Promise(r => setTimeout(r, 2000));

    try {
        console.log('1. Testing GET /health...');
        const healthRes = await request('GET', '/health');
        assert.strictEqual(healthRes.status, 200, 'Health endpoint should return 200');

        console.log('2. Testing GET /api/self-heal...');
        const healGetRes = await request('GET', '/api/self-heal');
        assert.strictEqual(healGetRes.status, 200);
        assert.strictEqual(healGetRes.data.status, 'healed');
        assert.strictEqual(healGetRes.data.systemIntegrity, 100);

        console.log('3. Testing POST /api/self-heal (Exception Report)...');
        const errReportRes = await request('POST', '/api/self-heal', { error: 'Test client exception', source: 'Test Runner' });
        assert.strictEqual(errReportRes.status, 200);
        assert.strictEqual(errReportRes.data.status, 'healed');

        console.log('4. Testing POST /api/self-heal/heal (Deep Vitality Recovery)...');
        const deepHealRes = await request('POST', '/api/self-heal/heal');
        assert.strictEqual(deepHealRes.status, 200);
        assert.strictEqual(deepHealRes.data.healthScore, 100);

        console.log('5. Testing GET /api/self-heal/logs...');
        const logsRes = await request('GET', '/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert(Array.isArray(logsRes.data.logs), 'Logs should return an array');
        assert(logsRes.data.logs.length > 0, 'Logs array should not be empty');

        console.log('6. Testing POST /chat Fallback System Tool Execution...');
        const chatRes = await request('POST', '/chat', { message: 'what is the system time?' });
        assert.strictEqual(chatRes.status, 200);
        assert(chatRes.data.reply, 'Chat response should contain a reply');

        console.log('✅ ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('❌ TEST FAILED:', err);
        process.exitCode = 1;
    } finally {
        serverProcess.kill();
        process.exit(process.exitCode || 0);
    }
}

runTests();
