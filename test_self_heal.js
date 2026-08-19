const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Import server internals if exported, or test via HTTP request
const { spawn } = require('child_process');

function makeRequest(urlStr, method = 'GET', bodyObj = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const postData = bodyObj ? JSON.stringify(bodyObj) : '';
        const options = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        if (bodyObj) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

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

        req.on('error', err => reject(err));
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (bodyObj) req.write(postData);
        req.end();
    });
}

async function runIntegrationTests() {
    console.log('🚀 Starting Aria Self-Healing & System Tool Integration Test Suite...');
    const TEST_PORT = 3099;
    const env = { ...process.env, PORT: TEST_PORT };

    const serverProc = spawn('node', ['server.js'], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let serverReady = false;
    serverProc.stdout.on('data', (d) => {
        const str = d.toString();
        if (str.includes('running on port')) {
            serverReady = true;
        }
    });

    // Wait for server to start
    for (let i = 0; i < 30; i++) {
        if (serverReady) break;
        await new Promise(r => setTimeout(r, 200));
    }

    const baseUrl = `http://localhost:${TEST_PORT}`;

    try {
        // Test 1: Health check endpoint
        console.log('\n[Test 1] GET /health');
        const resHealth = await makeRequest(`${baseUrl}/health`);
        assert.strictEqual(resHealth.status, 200);
        assert.strictEqual(resHealth.raw, 'OK');
        console.log('✅ /health passed!');

        // Test 2: GET /api/self-heal (Self-Healing Audit)
        console.log('\n[Test 2] GET /api/self-heal');
        const resAudit = await makeRequest(`${baseUrl}/api/self-heal`);
        assert.strictEqual(resAudit.status, 200);
        assert.strictEqual(resAudit.data.status, 'healed');
        assert.strictEqual(resAudit.data.systemIntegrity, 100);
        assert.ok(resAudit.data.report);
        console.log('✅ GET /api/self-heal passed!');

        // Test 3: POST /api/self-heal (Client Exception Logging & Mitigation)
        console.log('\n[Test 3] POST /api/self-heal (Exception Logging)');
        const resErrLog = await makeRequest(`${baseUrl}/api/self-heal`, 'POST', {
            error: 'Test exception for self-healing verification',
            source: 'IntegrationTest'
        });
        assert.strictEqual(resErrLog.status, 200);
        assert.strictEqual(resErrLog.data.status, 'healed');
        assert.ok(resErrLog.data.autoHealedCount >= 1);
        console.log('✅ POST /api/self-heal exception logging passed!');

        // Test 4: GET /api/self-heal/logs (Audit Log Query)
        console.log('\n[Test 4] GET /api/self-heal/logs');
        const resLogs = await makeRequest(`${baseUrl}/api/self-heal/logs`);
        assert.strictEqual(resLogs.status, 200);
        assert.strictEqual(resLogs.data.status, 'ok');
        assert.ok(Array.isArray(resLogs.data.logs));
        assert.ok(resLogs.data.logs.length > 0);
        console.log('✅ GET /api/self-heal/logs passed!');

        // Test 5: POST /api/self-heal/recover (Deep State Recovery)
        console.log('\n[Test 5] POST /api/self-heal/recover');
        const resRecover = await makeRequest(`${baseUrl}/api/self-heal/recover`, 'POST');
        assert.strictEqual(resRecover.status, 200);
        assert.strictEqual(resRecover.data.status, 'recovered');
        assert.strictEqual(resRecover.data.healthScore, 100);
        console.log('✅ POST /api/self-heal/recover passed!');

        // Test 6: Verify Data Persistence Files
        console.log('\n[Test 6] Data Persistence Integrity');
        const logFilePath = path.join(__dirname, 'data', 'self_healing_log.json');
        assert.ok(fs.existsSync(logFilePath), 'self_healing_log.json must exist');
        const logContent = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
        assert.ok(Array.isArray(logContent.logs), 'logs array must exist');
        console.log('✅ Data persistence files integrity passed!');

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('\n❌ Integration Test Failed:', err);
        process.exitCode = 1;
    } finally {
        serverProc.kill();
    }
}

runIntegrationTests();
