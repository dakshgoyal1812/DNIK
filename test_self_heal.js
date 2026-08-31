const http = require('http');
const assert = require('assert');

function httpRequest(options, postData = null) {
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
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function runTests() {
    console.log('🚀 Starting Integration Tests for Aria Self-Healing System...');

    // Start server in background
    const serverProcess = require('child_process').fork('./server.js', [], { silent: true });
    await new Promise(r => setTimeout(r, 2000)); // wait for server start

    try {
        // 1. Test GET /api/status
        console.log('Testing GET /api/status...');
        const statusRes = await httpRequest({ hostname: '127.0.0.1', port: 3000, path: '/api/status', method: 'GET' });
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.data.status, 'ok');
        console.log('  ✅ GET /api/status passed');

        // 2. Test GET /api/self-heal
        console.log('Testing GET /api/self-heal...');
        const healGetRes = await httpRequest({ hostname: '127.0.0.1', port: 3000, path: '/api/self-heal', method: 'GET' });
        assert.strictEqual(healGetRes.status, 200);
        assert.strictEqual(healGetRes.data.status, 'healed');
        assert.strictEqual(healGetRes.data.healthScore, 100);
        console.log('  ✅ GET /api/self-heal passed');

        // 3. Test POST /api/self-heal (recording client exception)
        console.log('Testing POST /api/self-heal...');
        const healPostRes = await httpRequest(
            { hostname: '127.0.0.1', port: 3000, path: '/api/self-heal', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            { error: 'Simulated UI Unhandled Rejection', source: 'IntegrationTest' }
        );
        assert.strictEqual(healPostRes.status, 200);
        assert.strictEqual(healPostRes.data.status, 'mitigated');
        assert.strictEqual(healPostRes.data.healthScore, 100);
        console.log('  ✅ POST /api/self-heal passed');

        // 4. Test GET /api/self-heal/heal (Deep Vitality Recovery)
        console.log('Testing GET /api/self-heal/heal...');
        const deepHealRes = await httpRequest({ hostname: '127.0.0.1', port: 3000, path: '/api/self-heal/heal', method: 'GET' });
        assert.strictEqual(deepHealRes.status, 200);
        assert.strictEqual(deepHealRes.data.status, 'healed');
        assert.strictEqual(deepHealRes.data.healthScore, 100);
        assert.strictEqual(deepHealRes.data.vitalityState, 'OPTIMAL_QUANTUM_RESTORED');
        console.log('  ✅ GET /api/self-heal/heal passed');

        // 5. Test POST /api/self-heal/recover (Full System Recovery)
        console.log('Testing POST /api/self-heal/recover...');
        const recoverRes = await httpRequest({ hostname: '127.0.0.1', port: 3000, path: '/api/self-heal/recover', method: 'POST' });
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.data.status, 'recovered');
        assert.strictEqual(recoverRes.data.healthScore, 100);
        console.log('  ✅ POST /api/self-heal/recover passed');

        // 6. Test GET /api/self-heal/logs
        console.log('Testing GET /api/self-heal/logs...');
        const logsRes = await httpRequest({ hostname: '127.0.0.1', port: 3000, path: '/api/self-heal/logs', method: 'GET' });
        assert.strictEqual(logsRes.status, 200);
        assert.strictEqual(logsRes.data.status, 'ok');
        assert(Array.isArray(logsRes.data.logs));
        assert(logsRes.data.logs.length > 0);
        console.log('  ✅ GET /api/self-heal/logs passed');

        // 7. Test POST /chat fallback system tools trigger
        console.log('Testing POST /chat fallback tool trigger...');
        const chatRes = await httpRequest(
            { hostname: '127.0.0.1', port: 3000, path: '/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            { message: 'What is the current system specs?' }
        );
        assert.strictEqual(chatRes.status, 200);
        assert(chatRes.data.reply);
        console.log('  ✅ POST /chat fallback tool trigger passed');

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('❌ Integration test failed:', err);
        process.exitCode = 1;
    } finally {
        serverProcess.kill();
    }
}

runTests();
