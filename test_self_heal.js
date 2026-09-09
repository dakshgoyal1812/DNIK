const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(method, pathName, bodyData = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(pathName, BASE_URL);
        const postData = bodyData ? JSON.stringify(bodyData) : null;
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (postData) {
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, body: parsed, raw: data });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', (err) => reject(err));
        if (postData) req.write(postData);
        req.end();
    });
}

async function runIntegrationTests() {
    console.log('🚀 Starting Integration Test Suite for Aria Self-Healing System...');

    // Spawn server process on TEST_PORT
    const serverProc = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: TEST_PORT },
        stdio: 'pipe'
    });

    let serverLogs = '';
    serverProc.stdout.on('data', (d) => { serverLogs += d.toString(); });
    serverProc.stderr.on('data', (d) => { serverLogs += d.toString(); });

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 2000));

    try {
        console.log('1. Testing GET /health endpoint...');
        const healthRes = await makeRequest('GET', '/health');
        if (healthRes.status !== 200 || healthRes.raw !== 'OK') {
            throw new Error(`GET /health failed: status ${healthRes.status}, body: ${healthRes.raw}`);
        }
        console.log('   ✅ GET /health passed.');

        console.log('2. Testing GET /api/self-heal endpoint (System Audit)...');
        const selfHealRes = await makeRequest('GET', '/api/self-heal');
        if (selfHealRes.status !== 200 || selfHealRes.body.status !== 'healed' || selfHealRes.body.healthScore !== 100) {
            throw new Error(`GET /api/self-heal failed: ${JSON.stringify(selfHealRes.body)}`);
        }
        console.log('   ✅ GET /api/self-heal passed.');

        console.log('3. Testing POST /api/self-heal endpoint (Client Exception Logging)...');
        const postErrRes = await makeRequest('POST', '/api/self-heal', {
            error: 'Test exception for self-healing verification',
            source: 'Integration Test Suite'
        });
        if (postErrRes.status !== 200 || postErrRes.body.status !== 'mitigated') {
            throw new Error(`POST /api/self-heal failed: ${JSON.stringify(postErrRes.body)}`);
        }
        console.log('   ✅ POST /api/self-heal passed.');

        console.log('4. Testing POST /api/self-heal/heal endpoint (Deep Vitality Recovery)...');
        const healRes = await makeRequest('POST', '/api/self-heal/heal');
        if (healRes.status !== 200 || healRes.body.status !== 'healed' || healRes.body.healthScore !== 100) {
            throw new Error(`POST /api/self-heal/heal failed: ${JSON.stringify(healRes.body)}`);
        }
        console.log('   ✅ POST /api/self-heal/heal passed.');

        console.log('5. Testing GET /api/self-heal/logs endpoint...');
        const logsRes = await makeRequest('GET', '/api/self-heal/logs');
        if (logsRes.status !== 200 || !Array.isArray(logsRes.body.logs)) {
            throw new Error(`GET /api/self-heal/logs failed: ${JSON.stringify(logsRes.body)}`);
        }
        console.log(`   ✅ GET /api/self-heal/logs passed (${logsRes.body.logs.length} logs recorded).`);

        console.log('6. Testing /chat endpoint with "heal aria" system command...');
        const chatRes = await makeRequest('POST', '/chat', { message: 'heal aria' });
        if (chatRes.status !== 200 || !chatRes.body.reply.includes('self-healing')) {
            throw new Error(`POST /chat heal command failed: ${JSON.stringify(chatRes.body)}`);
        }
        console.log('   ✅ POST /chat heal command passed.');

        console.log('7. Verifying persistence files in data/ directory...');
        const logFilePath = path.join(__dirname, 'data', 'self_healing_log.json');
        if (!fs.existsSync(logFilePath)) {
            throw new Error(`Log file ${logFilePath} does not exist!`);
        }
        const fileContent = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
        if (fileContent.healthScore !== 100) {
            throw new Error(`Expected health score 100 in log file, got ${fileContent.healthScore}`);
        }
        console.log('   ✅ Data persistence files verified.');

        console.log('\n================================================');
        console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
        console.log('================================================\n');

        serverProc.kill('SIGTERM');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ INTEGRATION TEST FAILED:', err.message);
        console.error('Server Logs:\n', serverLogs);
        serverProc.kill('SIGTERM');
        process.exit(1);
    }
}

runIntegrationTests();
