const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function httpRequest(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
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

        req.on('error', (e) => reject(e));
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    console.log('==============================================');
    console.log(' 🧪 Starting Aria Self-Healing Integration Test Suite');
    console.log('==============================================');

    console.log('[1/7] Starting test server instance on port ' + TEST_PORT + '...');
    const serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: TEST_PORT },
        stdio: 'inherit'
    });

    // Wait for server to boot up
    await new Promise(r => setTimeout(r, 2000));

    try {
        console.log('[2/7] Testing GET /api/status...');
        const statusRes = await httpRequest('GET', '/api/status');
        assert.strictEqual(statusRes.status, 200, 'GET /api/status should return 200 OK');
        assert.strictEqual(statusRes.data.status, 'ok', 'Status should be ok');
        console.log('  ✅ GET /api/status passed.');

        console.log('[3/7] Testing GET /api/self-heal...');
        const healRes = await httpRequest('GET', '/api/self-heal');
        assert.strictEqual(healRes.status, 200, 'GET /api/self-heal should return 200 OK');
        assert.strictEqual(healRes.data.status, 'ok', 'Status should be ok');
        assert.strictEqual(healRes.data.healthScore, 100, 'Health score should be 100%');
        console.log('  ✅ GET /api/self-heal passed.');

        console.log('[4/7] Testing POST /api/self-heal (Client Exception Logging)...');
        const errPayload = { error: 'Test UI Exception simulated', source: 'test_self_heal.js' };
        const excRes = await httpRequest('POST', '/api/self-heal', errPayload);
        assert.strictEqual(excRes.status, 200, 'POST /api/self-heal should return 200 OK');
        assert.strictEqual(excRes.data.healthScore, 100, 'Auto-mitigated health score should be 100%');
        console.log('  ✅ POST /api/self-heal passed.');

        console.log('[5/7] Testing POST /api/self-heal/heal (Deep Vitality Recovery)...');
        const healAriaRes = await httpRequest('POST', '/api/self-heal/heal');
        assert.strictEqual(healAriaRes.status, 200, 'POST /api/self-heal/heal should return 200 OK');
        assert.strictEqual(healAriaRes.data.status, 'healed', 'Status should be healed');
        assert.strictEqual(healAriaRes.data.healthScore, 100, 'Health score should be restored to 100%');
        assert.ok(healAriaRes.data.message.includes('healed'), 'Message should indicate healing complete');
        console.log('  ✅ POST /api/self-heal/heal passed.');

        console.log('[6/7] Testing GET /api/self-heal/logs & POST /api/self-heal/recover...');
        const logsRes = await httpRequest('GET', '/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200, 'GET /api/self-heal/logs should return 200 OK');
        assert.ok(Array.isArray(logsRes.data.logs), 'logs should be an array');

        const recoverRes = await httpRequest('POST', '/api/self-heal/recover');
        assert.strictEqual(recoverRes.status, 200, 'POST /api/self-heal/recover should return 200 OK');
        assert.strictEqual(recoverRes.data.status, 'recovered', 'Status should be recovered');
        console.log('  ✅ GET /api/self-heal/logs & POST /api/self-heal/recover passed.');

        console.log('[7/7] Verifying persistent JSON state files integrity in data/...');
        const files = ['long_term_memory.json', 'reminders.json', 'self_healing_log.json', 'vector_memory.json'];
        for (const file of files) {
            const fpath = path.join(__dirname, 'data', file);
            assert.ok(fs.existsSync(fpath), `File ${file} should exist`);
            const content = fs.readFileSync(fpath, 'utf-8');
            assert.doesNotThrow(() => JSON.parse(content), `File ${file} should contain valid JSON`);
        }
        console.log('  ✅ Persistent state JSON files verified.');

        console.log('==============================================');
        console.log(' 🎉 ALL SELF-HEALING INTEGRATION TESTS PASSED!');
        console.log('==============================================');
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exitCode = 1;
    } finally {
        serverProcess.kill('SIGTERM');
        setTimeout(() => process.exit(process.exitCode || 0), 500);
    }
}

runTests();
