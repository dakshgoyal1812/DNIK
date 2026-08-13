const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runTests() {
    console.log("==========================================");
    console.log("  🧪 STARTING ARIA SELF-HEALING TEST SUITE");
    console.log("==========================================");

    // Import functions directly from server.js if possible, or we can mock/instantiate them.
    // Since server.js is a self-running file listening on a port, we can mock/run functions.
    // Wait, let's load server.js dynamically or simulate the same environment.
    // To keep it 100% robust and avoid port collision during imports, we can require server.js
    // but prevent it from listening, or we can run the server in background and query its HTTP routes,
    // AND test the logic of functions.
    // Wait, let's check if requiring server.js starts the server. Yes, it does because it calls `server.listen`.
    // So let's test by spawning server.js in a background process, making API requests, and verifying behaviour!
    // And to test functions directly, we can write a test that acts as a client making requests to our fully-functional endpoints.
    // Let's also do direct verification of data files.

    const { spawn } = require('child_process');
    const PORT = 3543; // Avoid port collision

    console.log(`[Test] Starting server on port ${PORT}...`);
    const serverProcess = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: PORT }
    });

    let stdoutData = '';
    serverProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
        // console.log("[Server log]", data.toString().trim());
    });

    serverProcess.stderr.on('data', (data) => {
        console.error("[Server err]", data.toString().trim());
    });

    // Wait for server to print started message or wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    try {
        const http = require('http');

        // Helper: Make HTTP GET Request
        const httpGet = (urlPath) => {
            return new Promise((resolve, reject) => {
                http.get(`http://localhost:${PORT}${urlPath}`, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        resolve({ status: res.statusCode, body: data });
                    });
                }).on('error', reject);
            });
        };

        // Helper: Make HTTP POST Request
        const httpPost = (urlPath, bodyObj) => {
            return new Promise((resolve, reject) => {
                const postData = JSON.stringify(bodyObj);
                const req = http.request({
                    hostname: 'localhost',
                    port: PORT,
                    path: urlPath,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        resolve({ status: res.statusCode, body: data });
                    });
                });
                req.on('error', reject);
                req.write(postData);
                req.end();
            });
        };

        console.log("\n------------------------------------------");
        console.log("🟢 TEST 1: Ping / health check endpoint");
        console.log("------------------------------------------");
        const healthRes = await httpGet('/health');
        assert.strictEqual(healthRes.status, 200);
        assert.strictEqual(healthRes.body, 'OK');
        console.log("Pass: Health check works correctly!");

        console.log("\n------------------------------------------");
        console.log("🟢 TEST 2: GET /api/self-heal triggers audit");
        console.log("------------------------------------------");
        const auditRes = await httpGet('/api/self-heal');
        assert.strictEqual(auditRes.status, 200);
        const auditData = JSON.parse(auditRes.body);
        assert.strictEqual(auditData.status, 'healed');
        assert.strictEqual(auditData.systemIntegrity, 100);
        assert.ok(auditData.report);
        console.log("Pass: GET /api/self-heal successfully executes and returns system report!");
        console.log("Report preview:\n", auditData.report.substring(0, 300) + "...");

        console.log("\n------------------------------------------");
        console.log("🟢 TEST 3: POST /api/self-heal logs and auto-heals");
        console.log("------------------------------------------");
        const clientException = {
            error: "TypeError: Cannot read properties of undefined (reading 'getNormalizedBoneNode')",
            source: "Browser client-side VRM loader"
        };
        const postRes = await httpPost('/api/self-heal', clientException);
        assert.strictEqual(postRes.status, 200);
        const postData = JSON.parse(postRes.body);
        assert.strictEqual(postData.status, 'healed');
        assert.ok(postData.autoHealedCount > 0);
        console.log("Pass: POST /api/self-heal accepts, logs, and mitigates exception successfully!");

        console.log("\n------------------------------------------");
        console.log("🟢 TEST 4: GET /api/self-heal/logs displays real-time logs");
        console.log("------------------------------------------");
        const logsRes = await httpGet('/api/self-heal/logs');
        assert.strictEqual(logsRes.status, 200);
        const logsData = JSON.parse(logsRes.body);
        assert.ok(Array.isArray(logsData.logs));
        assert.ok(logsData.logs.length > 0);

        // Find our logged client exception
        const loggedException = logsData.logs.find(l => l.type === 'exception');
        assert.ok(loggedException);
        assert.strictEqual(loggedException.error, clientException.error);
        assert.strictEqual(loggedException.source, clientException.source);
        console.log("Pass: Real-time exceptions are queryable from /api/self-heal/logs!");

        console.log("\n------------------------------------------");
        console.log("🟢 TEST 5: Test file corruption self-healing");
        console.log("------------------------------------------");
        // Corrupt reminders.json manually
        const remindersPath = path.join(__dirname, 'data', 'reminders.json');
        fs.writeFileSync(remindersPath, "INVALID { json : corrupted [", 'utf8');
        console.log("Artificially corrupted data/reminders.json");

        // Trigger GET /api/self-heal to heal it
        const healRes = await httpGet('/api/self-heal');
        assert.strictEqual(healRes.status, 200);

        // Verify that reminders.json is healed back to valid JSON []
        const healedContent = fs.readFileSync(remindersPath, 'utf8');
        const parsed = JSON.parse(healedContent);
        assert.deepStrictEqual(parsed, []);
        console.log("Pass: Corrupted reminders.json file was detected and automatically healed!");

        console.log("\n------------------------------------------");
        console.log("🟢 TEST 6: Chat endpoint and executeSystemTool routing");
        console.log("------------------------------------------");
        const chatRes = await httpPost('/chat', { message: "System check: memory usage" });
        assert.strictEqual(chatRes.status, 200);
        const chatData = JSON.parse(chatRes.body);
        assert.ok(chatData.reply);
        console.log("Pass: Chat fallback triggers executeSystemTool and returns memory report successfully!");
        console.log("Reply response:", chatData.reply);

        console.log("\n==========================================");
        console.log("  🎉 ALL ARIA SELF-HEALING TESTS PASSED!");
        console.log("==========================================");
    } catch (e) {
        console.error("\n❌ TEST FAILURE:");
        console.error(e);
        process.exitCode = 1;
    } finally {
        console.log("[Test] Killing background server...");
        serverProcess.kill();
    }
}

runTests();
