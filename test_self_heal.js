const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const TEST_PORT = 3099;

function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';
        const options = {
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: path,
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
                    resolve({ statusCode: res.statusCode, json, raw: data });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(postData);
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
        console.log('--- Test 1: GET /api/status ---');
        const statusRes = await makeRequest('/api/status');
        assert.strictEqual(statusRes.statusCode, 200);
        assert.strictEqual(statusRes.json.status, 'ok');
        console.log('✅ GET /api/status passed.');

        console.log('--- Test 2: GET /api/self-heal ---');
        const healRes = await makeRequest('/api/self-heal');
        assert.strictEqual(healRes.statusCode, 200);
        assert.strictEqual(healRes.json.status, 'healed');
        assert.strictEqual(healRes.json.healthScore, 100);
        console.log('✅ GET /api/self-heal passed.');

        console.log('--- Test 3: POST /api/self-heal (Log Client Exception) ---');
        const errRes = await makeRequest('/api/self-heal', 'POST', {
            error: 'Test exception for self-healing verification',
            source: 'Integration Test'
        });
        assert.strictEqual(errRes.statusCode, 200);
        assert.strictEqual(errRes.json.status, 'recorded');
        console.log('✅ POST /api/self-heal passed.');

        console.log('--- Test 4: POST /api/self-heal/heal (Deep Vitality Recovery) ---');
        const deepHealRes = await makeRequest('/api/self-heal/heal', 'POST');
        assert.strictEqual(deepHealRes.statusCode, 200);
        assert.strictEqual(deepHealRes.json.status, 'healed');
        assert.strictEqual(deepHealRes.json.healthScore, 100);
        console.log('✅ POST /api/self-heal/heal passed.');

        console.log('--- Test 5: GET /api/self-heal/logs ---');
        const logsRes = await makeRequest('/api/self-heal/logs');
        assert.strictEqual(logsRes.statusCode, 200);
        assert.strictEqual(logsRes.json.status, 'ok');
        assert(Array.isArray(logsRes.json.logs));
        assert(logsRes.json.logs.length > 0);
        console.log('✅ GET /api/self-heal/logs passed.');

        console.log('--- Test 6: POST /api/self-heal/recover ---');
        const recoverRes = await makeRequest('/api/self-heal/recover', 'POST');
        assert.strictEqual(recoverRes.statusCode, 200);
        assert.strictEqual(recoverRes.json.status, 'recovered');
        assert.strictEqual(recoverRes.json.healthScore, 100);
        console.log('✅ POST /api/self-heal/recover passed.');

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (e) {
        console.error('❌ Test failed:', e);
        process.exitCode = 1;
    } finally {
        serverProcess.kill('SIGTERM');
    }
}

runTests();
