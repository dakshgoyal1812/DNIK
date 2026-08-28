const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function httpRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const postData = body ? JSON.stringify(body) : '';
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
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
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function waitForServer(maxRetries = 20) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await httpRequest('GET', '/health');
            if (res.status === 200) return true;
        } catch (e) {}
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('Server failed to start on port ' + PORT);
}

async function runTests() {
    console.log('🚀 Starting test server process...');
    const serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: PORT },
        stdio: 'inherit'
    });

    try {
        await waitForServer();
        console.log('✅ Server is up and healthy!');

        // 1. Test GET /api/status
        console.log('🧪 Testing GET /api/status...');
        const statusRes = await httpRequest('GET', '/api/status');
        assert.strictEqual(statusRes.status, 200, 'Status code should be 200');
        assert.strictEqual(statusRes.data.status, 'ok', 'Status should be ok');

        // 2. Test GET /api/self-heal (Self-Healing Audit)
        console.log('🧪 Testing GET /api/self-heal...');
        const auditRes = await httpRequest('GET', '/api/self-heal');
        assert.strictEqual(auditRes.status, 200);
        assert.strictEqual(auditRes.data.status, 'healed');
        assert.strictEqual(auditRes.data.healthScore, 100);

        // 3. Test POST /api/self-heal (Client Exception Logging)
        console.log('🧪 Testing POST /api/self-heal (client exception shield)...');
        const errRes = await httpRequest('POST', '/api/self-heal', {
            error: 'Test uncaught client-side exception',
            source: 'test_self_heal.js'
        });
        assert.strictEqual(errRes.status, 200);
        assert.strictEqual(errRes.data.status, 'healed');
        assert.strictEqual(errRes.data.healthScore, 100);

        // 4. Test POST /api/self-heal/heal (Deep Vitality Recovery / heal_aria)
        console.log('🧪 Testing POST /api/self-heal/heal (Aria Vitality Healing)...');
        const healRes = await httpRequest('POST', '/api/self-heal/heal');
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.data.status, 'healed');
        assert.strictEqual(healRes.data.healthScore, 100);

        // 5. Test POST /api/self-heal/recover (Full System State Recovery)
        console.log('🧪 Testing POST /api/self-heal/recover...');
        const recoverRes = await httpRequest('POST', '/api/self-heal/recover');
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.data.status, 'recovered');
        assert.strictEqual(recoverRes.data.healthScore, 100);

        // 6. Test GET /api/self-heal/logs (Real-Time Audit Logs)
        console.log('🧪 Testing GET /api/self-heal/logs...');
        const logsRes = await httpRequest('GET', '/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert.strictEqual(logsRes.data.healthScore, 100);
        assert(Array.isArray(logsRes.data.logs), 'Logs should be an array');
        assert(logsRes.data.logs.length > 0, 'Logs should not be empty');

        // 7. Test POST /chat fallback system tools dispatch
        console.log('🧪 Testing POST /chat with system tools dispatch...');
        const chatRes = await httpRequest('POST', '/chat', { message: 'tell me system specs' });
        assert.strictEqual(chatRes.status, 200);
        assert(chatRes.data.reply, 'Chat response should contain reply text');

        console.log('\n✨ ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ✨\n');
    } finally {
        serverProcess.kill('SIGTERM');
    }
}

runTests().catch(err => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
});
