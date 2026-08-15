const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function runTests() {
    console.log('Starting Self-Healing Integration Tests...');
    const serverProcess = require('./server.js');

    // Wait 1.5s for server to start listening
    await new Promise(r => setTimeout(r, 1500));

    const PORT = process.env.PORT || 3000;
    const baseUrl = `http://localhost:${PORT}`;

    // Test 1: GET /api/self-heal
    console.log('Test 1: Testing GET /api/self-heal...');
    const getRes = await new Promise((resolve) => {
        http.get(`${baseUrl}/api/self-heal`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });
    assert.strictEqual(getRes.status, 'healed');
    assert.strictEqual(getRes.healthScore, 100);
    console.log('✅ GET /api/self-heal passed.');

    // Test 2: POST /api/self-heal (Client Exception Logging)
    console.log('Test 2: Testing POST /api/self-heal (Client Error Logging)...');
    const postData = JSON.stringify({ error: 'Test UI Error', source: 'test_runner' });
    const postRes = await new Promise((resolve) => {
        const req = http.request(`${baseUrl}/api/self-heal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.write(postData);
        req.end();
    });
    assert.strictEqual(postRes.status, 'mitigated');
    assert.strictEqual(postRes.healthScore, 100);
    console.log('✅ POST /api/self-heal passed.');

    // Test 3: GET /api/self-heal/logs
    console.log('Test 3: Testing GET /api/self-heal/logs...');
    const logsRes = await new Promise((resolve) => {
        http.get(`${baseUrl}/api/self-heal/logs`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });
    assert.strictEqual(logsRes.healthScore, 100);
    assert(Array.isArray(logsRes.logs));
    console.log('✅ GET /api/self-heal/logs passed.');

    // Test 4: Corrupted JSON Repair Audit Test
    console.log('Test 4: Testing State Restoration on Corrupted JSON...');
    const memoryFile = path.join(__dirname, 'data', 'long_term_memory.json');
    fs.writeFileSync(memoryFile, 'INVALID_JSON_CONTENT{{{', 'utf8');

    // Trigger self-heal diagnostic
    const repairRes = await new Promise((resolve) => {
        http.get(`${baseUrl}/api/self-heal`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });
    assert.strictEqual(repairRes.status, 'healed');

    // Verify file was restored to valid JSON
    const restoredContent = fs.readFileSync(memoryFile, 'utf8');
    assert.doesNotThrow(() => JSON.parse(restoredContent));
    console.log('✅ State Restoration on Corrupted JSON passed.');

    console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Integration Test Failed:', err);
    process.exit(1);
});
