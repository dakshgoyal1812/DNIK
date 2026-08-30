const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

let serverProcess = null;
const PORT = 3005;

function startServer() {
    return new Promise((resolve, reject) => {
        serverProcess = spawn('node', ['server.js'], {
            env: { ...process.env, PORT: String(PORT) },
            stdio: 'pipe'
        });

        serverProcess.stdout.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes('running on port')) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            // Log errors if any
        });

        setTimeout(() => resolve(), 2500);
    });
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
    }
}

function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const reqOpts = {
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = http.request(reqOpts, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    parsed = body;
                }
                resolve({ status: res.statusCode, data: parsed, headers: res.headers });
            });
        });

        req.on('error', err => reject(err));

        if (options.body) {
            const bodyData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Content-Length', Buffer.byteLength(bodyData));
            req.write(bodyData);
        }

        req.end();
    });
}

async function runTests() {
    console.log('🧪 Starting Aria Self-Healing Integration Test Suite...');
    try {
        await startServer();
        console.log('✅ Server started on port', PORT);

        // Test 1: Health / Status Endpoint
        console.log('Testing GET /api/status...');
        const statusRes = await request('/api/status');
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.data.status, 'ok');
        console.log('  PASSED: /api/status endpoint responsive');

        // Test 2: Self-Healing GET Endpoint (Diagnostics Audit)
        console.log('Testing GET /api/self-heal...');
        const selfHealRes = await request('/api/self-heal');
        assert.strictEqual(selfHealRes.status, 200);
        assert.strictEqual(typeof selfHealRes.data.healthScore, 'number');
        assert.strictEqual(selfHealRes.data.status, 'active');
        console.log('  PASSED: /api/self-heal GET audit intact (Health Score:', selfHealRes.data.healthScore, '%)');

        // Test 3: Client UI Exception Logging & Auto-mitigation
        console.log('Testing POST /api/self-heal (Client Error Reporting)...');
        const errReportRes = await request('/api/self-heal', {
            method: 'POST',
            body: { error: 'Simulated WebGL Context Loss Error', source: 'TestRunner' }
        });
        assert.strictEqual(errReportRes.status, 200);
        assert.strictEqual(errReportRes.data.status, 'healed');
        console.log('  PASSED: Client error successfully logged and mitigated');

        // Test 4: Heal Aria Feature Endpoint (/api/self-heal/heal)
        console.log('Testing POST /api/self-heal/heal (Heal Aria System Tool)...');
        const healRes = await request('/api/self-heal/heal', { method: 'POST' });
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.data.status, 'healed');
        assert.strictEqual(healRes.data.healthScore, 100);
        assert(healRes.data.message.includes('fully healed'));
        console.log('  PASSED: /api/self-heal/heal restored vitality to 100%');

        // Test 5: System Recovery Endpoint (/api/self-heal/recover)
        console.log('Testing POST /api/self-heal/recover...');
        const recoverRes = await request('/api/self-heal/recover', { method: 'POST' });
        assert.strictEqual(recoverRes.status, 200);
        assert.strictEqual(recoverRes.data.status, 'recovered');
        console.log('  PASSED: /api/self-heal/recover state purge complete');

        // Test 6: Audit Logs Query Endpoint (/api/self-heal/logs)
        console.log('Testing GET /api/self-heal/logs...');
        const logsRes = await request('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert(Array.isArray(logsRes.data.logs));
        assert(logsRes.data.logs.length > 0);
        console.log('  PASSED: /api/self-heal/logs returned', logsRes.data.logs.length, 'audit log entries');

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exitCode = 1;
    } finally {
        stopServer();
        process.exit();
    }
}

runTests();
