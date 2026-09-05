const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Start the server on a test port
process.env.PORT = '3099';
require('./server.js');

function makeRequest(pathStr, method = 'GET', bodyObj = null) {
    return new Promise((resolve, reject) => {
        const postData = bodyObj ? JSON.stringify(bodyObj) : '';
        const options = {
            hostname: '127.0.0.1',
            port: 3099,
            path: pathStr,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(bodyObj ? { 'Content-Length': Buffer.byteLength(postData) } : {})
            }
        };

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
        if (bodyObj) req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Running Aria Self-Healing & System Tools Integration Tests...');

    // Wait 500ms for server to start listening
    await new Promise(r => setTimeout(r, 500));

    try {
        // Test 1: GET /api/status
        console.log('1. Testing /api/status...');
        const statusRes = await makeRequest('/api/status');
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.data.status, 'ok');
        console.log('  ✅ /api/status passed');

        // Test 2: GET /api/self-heal
        console.log('2. Testing GET /api/self-heal...');
        const healGetRes = await makeRequest('/api/self-heal');
        assert.strictEqual(healGetRes.status, 200);
        assert.strictEqual(healGetRes.data.status, 'healed');
        assert.strictEqual(healGetRes.data.healthScore, 100);
        console.log('  ✅ GET /api/self-heal passed');

        // Test 3: POST /api/self-heal (Client Exception Logging)
        console.log('3. Testing POST /api/self-heal...');
        const clientErrRes = await makeRequest('/api/self-heal', 'POST', {
            error: 'Test uncaught exception',
            source: 'test_self_heal.js'
        });
        assert.strictEqual(clientErrRes.status, 200);
        assert.strictEqual(clientErrRes.data.status, 'mitigated');
        console.log('  ✅ POST /api/self-heal passed');

        // Test 4: POST /api/self-heal/heal (Deep Vitality Recover / heal_aria)
        console.log('4. Testing POST /api/self-heal/heal...');
        const deepHealRes = await makeRequest('/api/self-heal/heal', 'POST');
        assert.strictEqual(deepHealRes.status, 200);
        assert.strictEqual(deepHealRes.data.status, 'healed');
        assert.strictEqual(deepHealRes.data.healthScore, 100);
        console.log('  ✅ POST /api/self-heal/heal passed');

        // Test 5: POST /api/self-heal/recover
        console.log('5. Testing POST /api/self-heal/recover...');
        const recoverRes = await makeRequest('/api/self-heal/recover', 'POST');
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.data.status, 'recovered');
        assert.strictEqual(recoverRes.data.healthScore, 100);
        console.log('  ✅ POST /api/self-heal/recover passed');

        // Test 6: GET /api/self-heal/logs
        console.log('6. Testing GET /api/self-heal/logs...');
        const logsRes = await makeRequest('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert.strictEqual(logsRes.data.status, 'ok');
        assert(Array.isArray(logsRes.data.logs));
        assert(logsRes.data.logs.length > 0);
        console.log('  ✅ GET /api/self-heal/logs passed');

        // Test 7: Verify corrupted JSON auto-restoration
        console.log('7. Testing Corrupted JSON State Restoration...');
        const testJsonPath = path.join(__dirname, 'data', 'reminders.json');
        fs.writeFileSync(testJsonPath, 'CORRUPTED_JSON_CONTENT{{{', 'utf8');
        const healAuditRes = await makeRequest('/api/self-heal');
        assert.strictEqual(healAuditRes.status, 200);
        const restoredContent = fs.readFileSync(testJsonPath, 'utf8').trim();
        assert.doesNotThrow(() => JSON.parse(restoredContent));
        console.log('  ✅ Corrupted JSON Auto-Restoration passed');

        console.log('\n🎉 ALL 7 INTEGRATION TESTS PASSED SUCCESSFULLY!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exit(1);
    }
}

runTests();
