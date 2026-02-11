/**
 * Test Runner - Starts server and runs Playwright tests
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('[TEST RUNNER] Starting TTS end-to-end test...\n');

// Start server
console.log('[SERVER] Starting Node.js server on port 8080...');
const serverProcess = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});

let serverReady = false;

// Give server time to start
setTimeout(async () => {
  console.log('\n[TEST RUNNER] Waiting for server to initialize...');

  // Check if server is responding
  const checkServer = () => {
    return new Promise((resolve) => {
      const http = require('http');
      const req = http.get('http://localhost:8080', (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 304);
      });
      req.on('error', () => {
        resolve(false);
      });
    });
  };

  for (let i = 0; i < 15; i++) {
    if (await checkServer()) {
      serverReady = true;
      console.log('[SERVER] Server is responding!\n');
      break;
    }
    console.log(`[SERVER] Waiting... (${i + 1}/15)`);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Run test
  console.log('[TEST RUNNER] Running Playwright tests...\n');
  const testProcess = spawn('node', ['test-tts-e2e.js'], {
    cwd: __dirname,
    stdio: 'inherit'
  });

  testProcess.on('exit', (code) => {
    console.log(`\n[TEST RUNNER] Tests finished with code ${code}`);
    serverProcess.kill();
    process.exit(code);
  });

}, 2000);

// Handle server errors
serverProcess.on('error', (err) => {
  console.error('[SERVER ERROR]', err);
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n[TEST RUNNER] Shutting down...');
  serverProcess.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[TEST RUNNER] Shutting down...');
  serverProcess.kill();
  process.exit(0);
});
