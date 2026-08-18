const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
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
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function runTests() {
    console.log("Starting server process for integration testing...");
    const serverProc = spawn('node', ['server.js'], { env: { ...process.env, PORT: '3099' } });

    // Wait 2 seconds for server to boot
    await new Promise(r => setTimeout(r, 2000));

    try {
        console.log("\n--- Test 1: GET /api/status ---");
        const statusRes = await makeRequest({
            hostname: '127.0.0.1',
            port: 3099,
            path: '/api/status',
            method: 'GET'
        });
        console.log("Status code:", statusRes.status, "Body:", statusRes.body);
        if (statusRes.status !== 200 || statusRes.body.status !== 'ok') {
            throw new Error("Test 1 Failed: /api/status endpoint error");
        }

        console.log("\n--- Test 2: GET /api/self-heal ---");
        const healGetRes = await makeRequest({
            hostname: '127.0.0.1',
            port: 3099,
            path: '/api/self-heal',
            method: 'GET'
        });
        console.log("Status code:", healGetRes.status, "Body:", healGetRes.body);
        if (healGetRes.status !== 200 || healGetRes.body.healthScore !== 100) {
            throw new Error("Test 2 Failed: /api/self-heal GET error");
        }

        console.log("\n--- Test 3: POST /api/self-heal (Client Exception Logging) ---");
        const healPostRes = await makeRequest({
            hostname: '127.0.0.1',
            port: 3099,
            path: '/api/self-heal',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { error: 'Test UI Error', source: 'Integration Test' });
        console.log("Status code:", healPostRes.status, "Body:", healPostRes.body);
        if (healPostRes.status !== 200 || healPostRes.body.status !== 'mitigated') {
            throw new Error("Test 3 Failed: /api/self-heal POST exception mitigation error");
        }

        console.log("\n--- Test 4: GET /api/self-heal/logs ---");
        const logsRes = await makeRequest({
            hostname: '127.0.0.1',
            port: 3099,
            path: '/api/self-heal/logs',
            method: 'GET'
        });
        console.log("Status code:", logsRes.status, "Logs count:", logsRes.body.logs?.length);
        if (logsRes.status !== 200 || !Array.isArray(logsRes.body.logs)) {
            throw new Error("Test 4 Failed: /api/self-heal/logs error");
        }

        console.log("\n--- Test 5: POST /chat (Fallback & System Tools Execution) ---");
        const chatRes = await makeRequest({
            hostname: '127.0.0.1',
            port: 3099,
            path: '/chat',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { message: 'what is system status' });
        console.log("Status code:", chatRes.status, "Reply:", chatRes.body.reply);
        if (chatRes.status !== 200 || !chatRes.body.reply) {
            throw new Error("Test 5 Failed: /chat endpoint error");
        }

        console.log("\n--- Test 6: Verify JSON File Auto-Healing on Corruption ---");
        const memFile = path.join(__dirname, 'data', 'long_term_memory.json');
        fs.writeFileSync(memFile, '{ corrupted_json... ', 'utf8');

        // Trigger self heal audit via GET
        await makeRequest({
            hostname: '127.0.0.1',
            port: 3099,
            path: '/api/self-heal',
            method: 'GET'
        });

        // Verify JSON is repaired
        const restoredContent = fs.readFileSync(memFile, 'utf8').trim();
        console.log("Restored memory file content:", restoredContent);
        JSON.parse(restoredContent); // Will throw if invalid JSON

        console.log("\n✅ ALL INTEGRATION TESTS PASSED SUCCESSFULLY!");
    } catch (e) {
        console.error("\n❌ TEST FAILURE:", e.message);
        process.exitCode = 1;
    } finally {
        serverProc.kill('SIGTERM');
    }
}

runTests();
