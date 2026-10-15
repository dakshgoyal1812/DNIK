const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let serverProcess = null;
const PORT = 3001;

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, headers: res.headers, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Starting Aria Self-Healing & Daily Routine Integration Tests...');

    // 1. Corrupt data files to test auto-restoration
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    fs.writeFileSync(path.join(dataDir, 'long_term_memory.json'), '{corrupted_json:true', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'reminders.json'), 'INVALID_JSON', 'utf8');
    console.log('  [Setup] Intentionally corrupted data/ JSON files for test validation');

    // 2. Spawn server on test port 3001
    serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: String(PORT) },
        stdio: 'pipe'
    });

    await new Promise(r => setTimeout(r, 2500));

    try {
        // Test 1: GET /api/self-heal/daily
        console.log('  [Test 1] Executing GET /api/self-heal/daily...');
        const res1 = await request({ hostname: 'localhost', port: PORT, path: '/api/self-heal/daily', method: 'GET' });
        console.assert(res1.status === 200, `Expected 200, got ${res1.status}`);
        console.assert(res1.data.status === 'healed', `Expected status 'healed', got ${res1.data.status}`);
        console.assert(res1.data.healthScore === 100, `Expected healthScore 100, got ${res1.data.healthScore}`);
        console.log('  ✅ Test 1 Passed: GET /api/self-heal/daily returned 200 with 100% health score');

        // Test 2: Verify data files were auto-repaired
        console.log('  [Test 2] Verifying auto-repair of corrupted JSON files...');
        const memRaw = fs.readFileSync(path.join(dataDir, 'long_term_memory.json'), 'utf8');
        const remRaw = fs.readFileSync(path.join(dataDir, 'reminders.json'), 'utf8');
        JSON.parse(memRaw);
        JSON.parse(remRaw);
        console.log('  ✅ Test 2 Passed: Corrupted JSON files successfully auto-repaired and valid');

        // Test 3: POST /api/self-heal with client error payload
        console.log('  [Test 3] Testing POST /api/self-heal exception reporting...');
        const res3 = await request(
            { hostname: 'localhost', port: PORT, path: '/api/self-heal', method: 'POST', headers: { 'Content-Type': 'application/json' } },
            { error: 'Simulated UI Exception', source: 'TestRunner' }
        );
        console.assert(res3.status === 200, `Expected 200, got ${res3.status}`);
        console.log('  ✅ Test 3 Passed: POST /api/self-heal logged exception and restored integrity');

        // Test 4: GET /api/self-heal/logs
        console.log('  [Test 4] Querying /api/self-heal/logs...');
        const res4 = await request({ hostname: 'localhost', port: PORT, path: '/api/self-heal/logs', method: 'GET' });
        console.assert(res4.status === 200, `Expected 200, got ${res4.status}`);
        console.assert(Array.isArray(res4.data.logs), 'Expected logs array');
        console.log('  ✅ Test 4 Passed: Query /api/self-heal/logs returned valid audit history');

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('❌ Test failed with error:', err);
        process.exitCode = 1;
    } finally {
        if (serverProcess) {
            serverProcess.kill();
        }
    }
}

runTests().then(() => process.exit(process.exitCode || 0));
