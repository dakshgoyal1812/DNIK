const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;
process.env.PORT = PORT;

// Start server process dynamically
const { spawn } = require('child_process');

console.log('🚀 Starting integration test suite for Self-Healing and Aria Vitality Engine...');

const serverProc = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) } });

function httpGet(path) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${PORT}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        }).on('error', reject);
    });
}

function httpPost(path, bodyObj = {}) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(bodyObj);
        const req = http.request(`http://localhost:${PORT}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function runTests() {
    // Wait for server startup
    await new Promise(r => setTimeout(r, 2000));

    try {
        // Test 1: GET /api/status
        console.log('Testing GET /api/status...');
        const statusRes = await httpGet('/api/status');
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.body.status, 'ok');
        console.log('✅ GET /api/status passed');

        // Test 2: GET /api/self-heal
        console.log('Testing GET /api/self-heal...');
        const selfHealRes = await httpGet('/api/self-heal');
        assert.strictEqual(selfHealRes.status, 200);
        assert.strictEqual(selfHealRes.body.healthScore, 100);
        console.log('✅ GET /api/self-heal passed');

        // Test 3: POST /api/self-heal (Client exception logging)
        console.log('Testing POST /api/self-heal exception logging...');
        const logRes = await httpPost('/api/self-heal', { error: "Test uncaught error", source: "TestRunner" });
        assert.strictEqual(logRes.status, 200);
        assert.strictEqual(logRes.body.status, 'mitigated');
        assert.strictEqual(logRes.body.healthScore, 100);
        console.log('✅ POST /api/self-heal exception logging passed');

        // Test 4: POST /api/self-heal/heal (Deep Healing)
        console.log('Testing POST /api/self-heal/heal...');
        const healRes = await httpPost('/api/self-heal/heal', {});
        assert.strictEqual(healRes.status, 200);
        assert.strictEqual(healRes.body.status, 'healed');
        assert.strictEqual(healRes.body.healthScore, 100);
        console.log('✅ POST /api/self-heal/heal passed');

        // Test 5: GET /api/self-heal/logs
        console.log('Testing GET /api/self-heal/logs...');
        const logsRes = await httpGet('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        assert.strictEqual(logsRes.body.healthScore, 100);
        assert(Array.isArray(logsRes.body.logs));
        console.log('✅ GET /api/self-heal/logs passed');

        // Test 6: Chat / heal tool invocation
        console.log('Testing /chat endpoint with heal prompt...');
        const chatRes = await httpPost('/chat', { message: "please heal aria" });
        assert.strictEqual(chatRes.status, 200);
        assert(chatRes.body.reply.includes("vitality") || chatRes.body.reply.includes("healed") || chatRes.body.reply.includes("Health"));
        console.log('✅ /chat heal tool execution passed');

        console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exitCode = 1;
    } finally {
        serverProc.kill();
        process.exit(process.exitCode || 0);
    }
}

runTests();
