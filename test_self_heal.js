const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const PORT = 3099;
let serverProcess = null;

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, headers: res.headers, raw: data });
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
    console.log('🚀 Starting Aria Self-Healing Integration Test Suite...');

    // Start test server process
    serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: String(PORT) },
        stdio: 'inherit'
    });

    // Wait for server boot
    await new Promise(r => setTimeout(r, 2000));

    try {
        console.log('Testing GET /health...');
        const healthRes = await request({ hostname: 'localhost', port: PORT, path: '/health', method: 'GET' });
        assert.strictEqual(healthRes.status, 200);
        console.log('✅ GET /health passed');

        console.log('Testing GET /api/self-heal...');
        const selfHealRes = await request({ hostname: 'localhost', port: PORT, path: '/api/self-heal', method: 'GET' });
        assert.strictEqual(selfHealRes.status, 200);
        assert.strictEqual(selfHealRes.body.status, 'healed');
        assert.strictEqual(selfHealRes.body.healthScore, 100);
        console.log('✅ GET /api/self-heal passed');

        console.log('Testing POST /api/self-heal (Client Exception Logging)...');
        const postExceptionRes = await request(
            { hostname: 'localhost', port: PORT, path: '/api/self-heal', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            { error: 'Simulated UI Exception', source: 'Integration Test' }
        );
        assert.strictEqual(postExceptionRes.status, 200);
        assert.strictEqual(postExceptionRes.body.status, 'healed');
        assert.strictEqual(postExceptionRes.body.healthScore, 100);
        assert.ok(postExceptionRes.body.autoHealedCount >= 1);
        console.log('✅ POST /api/self-heal passed');

        console.log('Testing POST /api/self-heal/heal (Heal Aria)...');
        const healRes = await request(
            { hostname: 'localhost', port: PORT, path: '/api/self-heal/heal', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            {}
        );
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.body.status, 'healed');
        assert.strictEqual(healRes.body.healthScore, 100);
        console.log('✅ POST /api/self-heal/heal passed');

        console.log('Testing POST /api/self-heal/recover...');
        const recoverRes = await request(
            { hostname: 'localhost', port: PORT, path: '/api/self-heal/recover', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            {}
        );
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.body.status, 'recovered');
        assert.strictEqual(recoverRes.body.healthScore, 100);
        console.log('✅ POST /api/self-heal/recover passed');

        console.log('Testing GET /api/self-heal/logs...');
        const logsRes = await request({ hostname: 'localhost', port: PORT, path: '/api/self-heal/logs', method: 'GET' });
        assert.strictEqual(logsRes.status, 200);
        assert.ok(Array.isArray(logsRes.body.logs));
        console.log('✅ GET /api/self-heal/logs passed');

        console.log('Testing POST /chat (Fallback & System Tools)...');
        const chatRes = await request(
            { hostname: 'localhost', port: PORT, path: '/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            { message: 'what time is it' }
        );
        assert.strictEqual(chatRes.status, 200);
        assert.ok(chatRes.body.reply && chatRes.body.reply.length > 0);
        console.log('✅ POST /chat passed');

        console.log('🎉 All Self-Healing Integration Tests Passed Successfully!');
    } finally {
        if (serverProcess) {
            serverProcess.kill();
        }
    }
}

runTests().catch(err => {
    console.error('❌ Test Suite Failed:', err);
    if (serverProcess) serverProcess.kill();
    process.exit(1);
});
