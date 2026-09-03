const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3099;
process.env.PORT = TEST_PORT;

console.log('==============================================');
console.log(' 🧪 Starting Aria Self-Healing Test Suite...');
console.log('==============================================');

let serverProcess = null;

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
                    resolve({ status: res.statusCode, body: json });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', (err) => reject(err));
        if (body) req.write(postData);
        req.end();
    });
}

async function runTests() {
    // Start server in child process
    serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: TEST_PORT },
        stdio: 'pipe'
    });

    // Wait 2 seconds for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    let passed = 0;
    let failed = 0;

    async function assertTest(name, fn) {
        try {
            await fn();
            console.log(` ✅ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(` ❌ FAIL: ${name} ->`, err.message);
            failed++;
        }
    }

    // Test 1: GET /health
    await assertTest('GET /health endpoint', async () => {
        const res = await makeRequest('/health');
        if (res.status !== 200 || res.raw !== 'OK') {
            throw new Error(`Expected status 200 OK, got ${res.status}: ${res.raw}`);
        }
    });

    // Test 2: GET /api/status
    await assertTest('GET /api/status endpoint', async () => {
        const res = await makeRequest('/api/status');
        if (res.status !== 200 || res.body.status !== 'ok') {
            throw new Error(`Unexpected status response: ${JSON.stringify(res.body)}`);
        }
    });

    // Test 3: GET /api/self-heal
    await assertTest('GET /api/self-heal diagnostic audit', async () => {
        const res = await makeRequest('/api/self-heal');
        if (res.status !== 200 || res.body.status !== 'healed' || res.body.healthScore !== 100) {
            throw new Error(`Expected healed status and healthScore 100, got: ${JSON.stringify(res.body)}`);
        }
    });

    // Test 4: POST /api/self-heal (Client Exception Mitigation)
    await assertTest('POST /api/self-heal client exception logging', async () => {
        const res = await makeRequest('/api/self-heal', 'POST', { error: 'Test UI Error', source: 'TestRunner' });
        if (res.status !== 200 || res.body.status !== 'mitigated' || res.body.healthScore !== 100) {
            throw new Error(`Expected mitigated status, got: ${JSON.stringify(res.body)}`);
        }
    });

    // Test 5: GET /api/self-heal/logs
    await assertTest('GET /api/self-heal/logs audit logs query', async () => {
        const res = await makeRequest('/api/self-heal/logs');
        if (res.status !== 200 || !res.body || typeof res.body !== 'object') {
            throw new Error(`Expected valid log object, got: ${JSON.stringify(res.body)}`);
        }
    });

    // Test 6: POST /api/self-heal/heal (Deep Vitality Recovery)
    await assertTest('POST /api/self-heal/heal deep vitality recovery', async () => {
        const res = await makeRequest('/api/self-heal/heal', 'POST');
        if (res.status !== 200 || res.body.status !== 'healed' || res.body.healAura !== true) {
            throw new Error(`Expected healAura true and healed status, got: ${JSON.stringify(res.body)}`);
        }
    });

    // Test 7: POST /api/self-heal/recover (Full System State Recovery)
    await assertTest('POST /api/self-heal/recover state recovery', async () => {
        const res = await makeRequest('/api/self-heal/recover', 'POST');
        if (res.status !== 200 || res.body.status !== 'recovered') {
            throw new Error(`Expected recovered status, got: ${JSON.stringify(res.body)}`);
        }
    });

    // Test 8: POST /chat endpoint fallback & tool execution
    await assertTest('POST /chat response & fallback execution', async () => {
        const res = await makeRequest('/chat', 'POST', { message: 'Hello Aria, what time is it?' });
        if (res.status !== 200 || !res.body.reply) {
            throw new Error(`Expected chat reply, got: ${JSON.stringify(res.body)}`);
        }
    });

    // Clean up server process
    if (serverProcess) {
        serverProcess.kill();
    }

    console.log('==============================================');
    console.log(` 📊 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('==============================================');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    if (serverProcess) serverProcess.kill();
    process.exit(1);
});
