const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const PORT = 3099;
let serverProcess = null;

function request(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            hostname: '127.0.0.1',
            port: PORT,
            path,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = http.request(reqOptions, (res) => {
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

        if (body) {
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Content-Length', Buffer.byteLength(bodyStr));
            req.write(bodyStr);
        }
        req.end();
    });
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
    console.log('🧪 Launching server for integration tests...');
    serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: String(PORT) },
        stdio: 'inherit'
    });

    await wait(2000);

    try {
        console.log('1. Testing GET /api/status...');
        const statusRes = await request('/api/status');
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.data.status, 'ok');
        console.log('   ✅ GET /api/status passed');

        console.log('2. Testing GET /api/self-heal...');
        const selfHealRes = await request('/api/self-heal');
        assert.strictEqual(selfHealRes.status, 200);
        assert.strictEqual(selfHealRes.data.status, 'healed');
        assert.strictEqual(selfHealRes.data.healthScore, 100);
        console.log('   ✅ GET /api/self-heal passed');

        console.log('3. Testing POST /api/self-heal (Client Exception Handling)...');
        const errRes = await request('/api/self-heal', { method: 'POST' }, { error: 'Test UI Error', source: 'Unit Test' });
        assert.strictEqual(errRes.status, 200);
        assert.strictEqual(errRes.data.status, 'healed');
        assert.strictEqual(errRes.data.healthScore, 100);
        console.log('   ✅ POST /api/self-heal passed');

        console.log('4. Testing POST /api/self-heal/heal (Deep Vitality Recovery)...');
        const healRes = await request('/api/self-heal/heal', { method: 'POST' });
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.data.status, 'healed');
        assert.strictEqual(healRes.data.healthScore, 100);
        console.log('   ✅ POST /api/self-heal/heal passed');

        console.log('5. Testing GET /api/self-heal/logs...');
        const logsRes = await request('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert(Array.isArray(logsRes.data.logs));
        console.log('   ✅ GET /api/self-heal/logs passed');

        console.log('6. Testing POST /api/self-heal/recover...');
        const recoverRes = await request('/api/self-heal/recover', { method: 'POST' });
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.data.status, 'recovered');
        console.log('   ✅ POST /api/self-heal/recover passed');

        console.log('7. Testing POST /chat with TTS synthesis...');
        const chatRes = await request('/chat', { method: 'POST' }, { message: 'hello', moodMode: 'normal', voiceName: 'Swara' });
        assert.strictEqual(chatRes.status, 200);
        assert(chatRes.data.reply);
        console.log('   ✅ POST /chat with TTS synthesis passed');

        console.log('\n🎉 ALL SELF-HEALING & SYSTEM TOOL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exitCode = 1;
    } finally {
        if (serverProcess) {
            serverProcess.kill('SIGTERM');
        }
    }
}

runTests();
