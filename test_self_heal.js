const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');

const TEST_PORT = 3001;

function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';
        const req = http.request({
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
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
        if (postData) req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('🚀 Starting test server on port', TEST_PORT);
    const serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: TEST_PORT },
        stdio: 'inherit'
    });

    // Wait for server to boot
    await new Promise(r => setTimeout(r, 2000));

    try {
        console.log('🧪 Test 1: System Status endpoint...');
        const statusRes = await request('/api/status');
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.data.status, 'ok');
        console.log('  ✅ Status check passed.');

        console.log('🧪 Test 2: GET /api/self-heal diagnostic endpoint...');
        const healRes = await request('/api/self-heal');
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.data.status, 'healed');
        assert.strictEqual(healRes.data.systemIntegrity, 100);
        console.log('  ✅ GET /api/self-heal diagnostic passed.');

        console.log('🧪 Test 3: POST /api/self-heal client exception logging...');
        const errLogRes = await request('/api/self-heal', 'POST', { error: 'Test UI Exception', source: 'Integration Test' });
        assert.strictEqual(errLogRes.status, 200);
        assert.strictEqual(errLogRes.data.status, 'logged_and_mitigated');
        console.log('  ✅ Client exception logging passed.');

        console.log('🧪 Test 4: POST /api/self-heal/heal vitality recovery endpoint...');
        const recoverRes = await request('/api/self-heal/heal', 'POST');
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.data.status, 'healed');
        assert.strictEqual(recoverRes.data.healthScore, 100);
        console.log('  ✅ Deep vitality recovery passed.');

        console.log('🧪 Test 5: GET /api/self-heal/logs endpoint...');
        const logsRes = await request('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert.ok(Array.isArray(logsRes.data.logs));
        assert.ok(logsRes.data.logs.length > 0);
        console.log('  ✅ Audit logs query passed.');

        console.log('🧪 Test 6: POST /chat endpoint with "heal aria" system tool trigger...');
        const chatRes = await request('/chat', 'POST', { message: 'heal aria' });
        assert.strictEqual(chatRes.status, 200);
        assert.ok(chatRes.data && (chatRes.data.reply || chatRes.data.cleanText));
        console.log('  ✅ Chat endpoint & heal_aria system tool passed.');

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
    } catch (err) {
        console.error('❌ Integration Test Failed:', err);
        process.exitCode = 1;
    } finally {
        serverProcess.kill('SIGTERM');
    }
}

runTests();
