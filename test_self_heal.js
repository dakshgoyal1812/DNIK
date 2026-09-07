const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PORT = 3001; // Use separate port for test server instance
process.env.PORT = PORT;

// Start server process
const server = require('./server.js');

function makeRequest(path, method = 'GET', bodyObj = null) {
    return new Promise((resolve, reject) => {
        const postData = bodyObj ? JSON.stringify(bodyObj) : '';
        const options = {
            hostname: '127.0.0.1',
            port: PORT,
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
                    resolve({ status: res.statusCode, data: json });
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
    console.log('🚀 Starting Self-Healing Integration Test Suite...\n');

    try {
        // Wait for server to bind
        await new Promise(r => setTimeout(r, 1000));

        // Test 1: GET /api/status
        console.log('Test 1: Checking /api/status endpoint...');
        const statusRes = await makeRequest('/api/status');
        assert.strictEqual(statusRes.status, 200, 'Status endpoint should return 200 OK');
        assert.strictEqual(statusRes.data.status, 'ok', 'Status should be ok');
        console.log('✅ Test 1 Passed: Server status healthy');

        // Test 2: GET /api/self-heal (Audit)
        console.log('\nTest 2: Checking GET /api/self-heal audit endpoint...');
        const auditRes = await makeRequest('/api/self-heal');
        assert.strictEqual(auditRes.status, 200, 'GET /api/self-heal should return 200 OK');
        assert.strictEqual(auditRes.data.healthScore, 100, 'Health score should be 100');
        assert.strictEqual(auditRes.data.systemIntegrity, 100, 'System integrity should be 100');
        console.log('✅ Test 2 Passed: Self-healing audit verified');

        // Test 3: POST /api/self-heal (Client exception recording and auto-mitigation)
        console.log('\nTest 3: Checking POST /api/self-heal exception reporting...');
        const exceptionPayload = { error: 'Simulated UI Canvas Context Lost', source: 'IntegrationTest.js' };
        const postExceptionRes = await makeRequest('/api/self-heal', 'POST', exceptionPayload);
        assert.strictEqual(postExceptionRes.status, 200, 'POST /api/self-heal should return 200 OK');
        assert.strictEqual(postExceptionRes.data.status, 'healed', 'Status should be healed');
        assert.strictEqual(postExceptionRes.data.healthScore, 100, 'Health score should be restored to 100');
        console.log('✅ Test 3 Passed: Exception recorded and mitigated');

        // Test 4: POST /api/self-heal/heal (Deep vitality recovery)
        console.log('\nTest 4: Checking POST /api/self-heal/heal endpoint...');
        const healRes = await makeRequest('/api/self-heal/heal', 'POST');
        assert.strictEqual(healRes.status, 200, 'POST /api/self-heal/heal should return 200 OK');
        assert.strictEqual(healRes.data.status, 'healed', 'Status should be healed');
        assert.strictEqual(healRes.data.healthScore, 100, 'Health score should be 100');
        console.log('✅ Test 4 Passed: Deep vitality recovery executed');

        // Test 5: POST /api/self-heal/recover (Full system state recovery)
        console.log('\nTest 5: Checking POST /api/self-heal/recover endpoint...');
        const recoverRes = await makeRequest('/api/self-heal/recover', 'POST');
        assert.strictEqual(recoverRes.status, 200, 'POST /api/self-heal/recover should return 200 OK');
        assert.strictEqual(recoverRes.data.status, 'recovered', 'Status should be recovered');
        assert.strictEqual(recoverRes.data.healthScore, 100, 'Health score should be 100');
        console.log('✅ Test 5 Passed: Full system state recovery executed');

        // Test 6: GET /api/self-heal/logs (Audit log retrieval)
        console.log('\nTest 6: Checking GET /api/self-heal/logs endpoint...');
        const logsRes = await makeRequest('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200, 'GET /api/self-heal/logs should return 200 OK');
        assert(Array.isArray(logsRes.data.logs), 'Logs should be an array');
        assert(logsRes.data.logs.length > 0, 'Logs array should contain audit and exception entries');
        console.log(`✅ Test 6 Passed: Retrieved ${logsRes.data.logs.length} audit logs`);

        // Test 7: Verify persistent data files integrity in data/
        console.log('\nTest 7: Verifying persistent JSON files integrity...');
        const logFilePath = path.join(__dirname, 'data', 'self_healing_log.json');
        assert(fs.existsSync(logFilePath), 'data/self_healing_log.json should exist');
        const logContent = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
        assert.strictEqual(logContent.healthScore, 100, 'Persisted health score should be 100');
        console.log('✅ Test 7 Passed: Data file state integrity verified');

        console.log('\n==========================================');
        console.log('🎉 ALL 7 SELF-HEALING TESTS PASSED SUCCESSFULLY!');
        console.log('==========================================\n');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Test Suite Failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

runTests();
