const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        testsPassed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        testsFailed++;
    }
}

async function runTests() {
    console.log("==================================================");
    console.log("  🧪 RUNNING INTEGRATION TEST SUITE: test_self_heal.js");
    console.log("==================================================\n");

    // --- TEST 1: Data Directory & JSON File Auto-Repair ---
    console.log("🔹 Test 1: Testing runSelfHealingAudit Data Directory Auto-Repair...");
    const dataDir = path.join(__dirname, 'data');
    const testRemindersPath = path.join(dataDir, 'reminders.json');

    // Intentionally corrupt reminders.json to test auto-repair
    if (fs.existsSync(testRemindersPath)) {
        fs.writeFileSync(testRemindersPath, "INVALID_JSON_CORRUPTED_DATA{{{", 'utf8');
    }

    // Start server in background process to test endpoints and startup audit
    const testPort = 3009;
    const serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: testPort }
    });

    // Wait for server to boot
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify corrupted reminders.json was repaired by startup self-healing audit
    try {
        const repairedContent = fs.readFileSync(testRemindersPath, 'utf8');
        const parsed = JSON.parse(repairedContent);
        assert(Array.isArray(parsed), "Corrupted reminders.json was auto-repaired into valid JSON array.");
    } catch (e) {
        assert(false, `Failed auto-repair check: ${e.message}`);
    }

    // Function to make HTTP GET request
    function httpGet(urlPath) {
        return new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${testPort}${urlPath}`, res => {
                let body = '';
                res.on('data', chunk => body += chunk.toString());
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
                });
            }).on('error', reject);
        });
    }

    // Function to make HTTP POST request
    function httpPost(urlPath, payload = {}) {
        return new Promise((resolve, reject) => {
            const dataStr = JSON.stringify(payload);
            const req = http.request(`http://127.0.0.1:${testPort}${urlPath}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(dataStr)
                }
            }, res => {
                let body = '';
                res.on('data', chunk => body += chunk.toString());
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
                });
            });
            req.on('error', reject);
            req.write(dataStr);
            req.end();
        });
    }

    try {
        // --- TEST 2: Endpoint GET /api/self-heal ---
        console.log("\n🔹 Test 2: Testing GET /api/self-heal endpoint...");
        const resGetHeal = await httpGet('/api/self-heal');
        assert(resGetHeal.status === 'healed', "GET /api/self-heal returns status 'healed'.");
        assert(resGetHeal.healthScore === 100, "GET /api/self-heal reports healthScore 100.");

        // --- TEST 3: Endpoint POST /api/self-heal/heal ---
        console.log("\n🔹 Test 3: Testing POST /api/self-heal/heal (Heal Aria Feature)...");
        const resPostHeal = await httpPost('/api/self-heal/heal');
        assert(resPostHeal.status === 'healed', "POST /api/self-heal/heal returns status 'healed'.");
        assert(resPostHeal.healthScore === 100, "POST /api/self-heal/heal restores healthScore to 100.");
        assert(resPostHeal.message && resPostHeal.message.includes("Aria vitality restored"), "POST /api/self-heal/heal returns vitality message.");

        // --- TEST 4: Endpoint POST /api/self-heal/recover ---
        console.log("\n🔹 Test 4: Testing POST /api/self-heal/recover endpoint...");
        const resRecover = await httpPost('/api/self-heal/recover');
        assert(resRecover.status === 'recovered', "POST /api/self-heal/recover returns status 'recovered'.");
        assert(resRecover.healthScore === 100, "POST /api/self-heal/recover reports healthScore 100.");

        // --- TEST 5: Endpoint POST /api/self-heal (Client Exception Logging) ---
        console.log("\n🔹 Test 5: Testing POST /api/self-heal client exception mitigation...");
        const resClientErr = await httpPost('/api/self-heal', { error: "Test Unhandled UI Rejection", source: "Playwright UI Test" });
        assert(resClientErr.status === 'mitigated', "POST /api/self-heal returns status 'mitigated'.");
        assert(resClientErr.healthScore === 100, "POST /api/self-heal mitigates exception and maintains healthScore 100.");

        // --- TEST 6: Endpoint GET /api/self-heal/logs ---
        console.log("\n🔹 Test 6: Testing GET /api/self-heal/logs endpoint...");
        const resLogs = await httpGet('/api/self-heal/logs');
        assert(Array.isArray(resLogs.logs), "GET /api/self-heal/logs returns logs array.");
        assert(resLogs.healthScore === 100, "GET /api/self-heal/logs reports healthScore 100.");

        // --- TEST 7: /chat API Endpoint Chat Response ---
        console.log("\n🔹 Test 7: Testing /chat API endpoint...");
        const chatRes = await httpPost('/chat', { message: "Hello Aria" });
        assert(chatRes && chatRes.reply && typeof chatRes.reply === 'string', "/chat API endpoint responds with valid AI reply.");

    } catch (err) {
        console.error("Test execution error:", err);
        testsFailed++;
    } finally {
        serverProcess.kill('SIGKILL');
    }

    console.log("\n==================================================");
    console.log(`  📊 TEST RESULTS: ${testsPassed} Passed, ${testsFailed} Failed`);
    console.log("==================================================");

    if (testsFailed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests();
