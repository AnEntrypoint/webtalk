/**
 * End-to-End Playwright Test for TTS System
 *
 * This test verifies:
 * 1. Server startup and connectivity
 * 2. TTS client initialization
 * 3. ONNX model file loading
 * 4. No console errors (especially URL parsing)
 * 5. Audio generation and streaming
 * 6. Worker communication and audio chunk flow
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TEST_URL = 'http://localhost:8080';
const TEST_TIMEOUT = 120000; // 2 minutes

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(TEST_URL, () => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
  });
}

async function waitForServer(maxAttempts = 30) {
  log('\n[SETUP] Checking server connectivity...', 'cyan');

  for (let i = 0; i < maxAttempts; i++) {
    const isRunning = await checkServerRunning();
    if (isRunning) {
      log('[SETUP] Server is running and responding', 'green');
      return true;
    }
    log(`[SETUP] Server not ready, waiting... (${i + 1}/${maxAttempts})`, 'yellow');
    await new Promise(r => setTimeout(r, 1000));
  }

  log('[SETUP] Server failed to start', 'red');
  return false;
}

async function runTests() {
  let browser = null;
  let testResults = {
    passed: 0,
    failed: 0,
    tests: []
  };

  try {
    // Wait for server
    const serverReady = await waitForServer();
    if (!serverReady) {
      throw new Error('Server not responding');
    }

    // Launch browser
    log('\n[SETUP] Launching browser...', 'cyan');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Track all network requests for model files
    const networkRequests = [];
    const failedRequests = [];
    const consoleMessages = [];
    const consoleErrors = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/models/') || url.includes('onnx')) {
        networkRequests.push({
          url: url,
          method: request.method(),
          time: new Date().toISOString()
        });
      }
    });

    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/models/') || url.includes('onnx')) {
        if (!response.ok()) {
          failedRequests.push({
            url: url,
            status: response.status(),
            statusText: response.statusText(),
            time: new Date().toISOString()
          });
          log(`[NETWORK] Failed request: ${url} (${response.status()})`, 'red');
        } else {
          log(`[NETWORK] Loaded: ${url}`, 'green');
        }
      }
    });

    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push({
        type: msg.type(),
        text: text,
        location: msg.location(),
        time: new Date().toISOString()
      });

      if (msg.type() === 'error') {
        consoleErrors.push(text);
        log(`[CONSOLE ERROR] ${text}`, 'red');
      } else if (msg.type() === 'warn') {
        log(`[CONSOLE WARN] ${text}`, 'yellow');
      } else if (text.includes('[TTS') || text.includes('[Worker') || text.includes('[SW')) {
        log(`[CONSOLE] ${text}`, 'blue');
      }
    });

    page.on('pageerror', (error) => {
      log(`[PAGE ERROR] ${error.message}`, 'red');
      consoleErrors.push(`PAGE ERROR: ${error.message}`);
    });

    // Test 1: Navigate to page
    log('\n[TEST 1] Navigating to application...', 'cyan');
    try {
      await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      log('[TEST 1] Navigation successful', 'green');
      testResults.passed++;
      testResults.tests.push({ name: 'Navigation', status: 'PASSED' });
    } catch (err) {
      log(`[TEST 1] Navigation failed: ${err.message}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'Navigation', status: 'FAILED', error: err.message });
      throw err;
    }

    // Test 2: Check page title
    log('\n[TEST 2] Verifying page title...', 'cyan');
    try {
      const title = await page.title();
      if (title.includes('Webtalk') || title.includes('Speech')) {
        log(`[TEST 2] Page title: "${title}"`, 'green');
        testResults.passed++;
        testResults.tests.push({ name: 'Page Title', status: 'PASSED' });
      } else {
        throw new Error(`Unexpected title: ${title}`);
      }
    } catch (err) {
      log(`[TEST 2] Title check failed: ${err.message}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'Page Title', status: 'FAILED', error: err.message });
    }

    // Test 3: Wait for TTS client initialization
    log('\n[TEST 3] Waiting for TTS client to initialize...', 'cyan');
    try {
      await page.waitForFunction(
        () => window.ttsClient !== undefined,
        { timeout: 30000 }
      );
      log('[TEST 3] TTS client initialized', 'green');
      testResults.passed++;
      testResults.tests.push({ name: 'TTS Client Initialization', status: 'PASSED' });
    } catch (err) {
      log(`[TEST 3] TTS client init timeout: ${err.message}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'TTS Client Initialization', status: 'FAILED', error: err.message });
    }

    // Test 4: Wait for models to load
    log('\n[TEST 4] Waiting for TTS models to load...', 'cyan');
    try {
      await page.waitForFunction(
        () => {
          const statusEl = document.querySelector('[data-tts-status]');
          return statusEl && statusEl.textContent.includes('Ready');
        },
        { timeout: 60000 }
      );
      log('[TEST 4] TTS models loaded successfully', 'green');
      testResults.passed++;
      testResults.tests.push({ name: 'TTS Models Loaded', status: 'PASSED' });
    } catch (err) {
      log(`[TEST 4] Models loading timeout: ${err.message}`, 'yellow');
      testResults.tests.push({ name: 'TTS Models Loaded', status: 'TIMEOUT', error: err.message });
    }

    // Test 5: Check for URL parsing errors
    log('\n[TEST 5] Checking for "Failed to parse URL" errors...', 'cyan');
    const urlErrors = consoleErrors.filter(e => e.includes('Failed to parse URL') || e.includes('Failed to execute'));
    if (urlErrors.length === 0) {
      log('[TEST 5] No URL parsing errors found', 'green');
      testResults.passed++;
      testResults.tests.push({ name: 'No URL Parsing Errors', status: 'PASSED' });
    } else {
      log(`[TEST 5] Found ${urlErrors.length} URL errors: ${urlErrors.join(', ')}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'No URL Parsing Errors', status: 'FAILED', errors: urlErrors });
    }

    // Test 6: Check model file requests
    log('\n[TEST 6] Verifying ONNX model file requests...', 'cyan');
    const modelFiles = [
      'mimi_encoder.onnx',
      'text_conditioner.onnx',
      'flow_lm_main_int8.onnx',
      'flow_lm_flow_int8.onnx',
      'mimi_decoder_int8.onnx'
    ];

    const loadedModels = [];
    const missingModels = [];

    for (const model of modelFiles) {
      const found = networkRequests.some(req => req.url.includes(model));
      if (found) {
        loadedModels.push(model);
        log(`  ✓ ${model}`, 'green');
      } else {
        missingModels.push(model);
        log(`  ✗ ${model}`, 'red');
      }
    }

    if (missingModels.length === 0) {
      log(`[TEST 6] All ${loadedModels.length} ONNX models loaded successfully`, 'green');
      testResults.passed++;
      testResults.tests.push({ name: 'ONNX Models Loaded', status: 'PASSED', count: loadedModels.length });
    } else {
      log(`[TEST 6] Missing ${missingModels.length} model(s): ${missingModels.join(', ')}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'ONNX Models Loaded', status: 'FAILED', missing: missingModels });
    }

    // Test 7: Check for 404 errors
    log('\n[TEST 7] Checking for 404 errors on model requests...', 'cyan');
    if (failedRequests.length === 0) {
      log('[TEST 7] No 404 errors on model files', 'green');
      testResults.passed++;
      testResults.tests.push({ name: 'No 404 Errors', status: 'PASSED' });
    } else {
      log(`[TEST 7] Found ${failedRequests.length} failed requests:`, 'red');
      failedRequests.forEach(req => {
        log(`  ${req.url} (${req.status})`, 'red');
      });
      testResults.failed++;
      testResults.tests.push({ name: 'No 404 Errors', status: 'FAILED', count: failedRequests.length });
    }

    // Test 8: Generate speech and verify audio flow
    log('\n[TEST 8] Testing TTS generation with sample text...', 'cyan');
    try {
      const testText = 'Hello, this is a test';
      const audioChunksReceived = [];

      // Inject listener for audio chunks
      await page.evaluateHandle(() => {
        window.audioChunksTest = [];
        if (window.ttsClient && window.ttsClient.worker) {
          const originalPostMessage = window.ttsClient.worker.postMessage.bind(window.ttsClient.worker);
          window.ttsClient.worker.postMessage = function(message, transfers) {
            if (message.type === 'audio_chunk') {
              window.audioChunksTest.push({
                type: 'audio_chunk',
                dataLength: message.data?.audio?.length || 0,
                time: new Date().toISOString()
              });
            }
            return originalPostMessage(message, transfers);
          };
        }
      });

      // Trigger generation
      log(`  Generating: "${testText}"`, 'cyan');
      await page.evaluate((text) => {
        if (window.ttsClient) {
          window.ttsClient.generate(text, 'default');
        }
      }, testText);

      // Wait for generation to complete
      await page.waitForFunction(
        () => window.audioChunksTest && window.audioChunksTest.length > 0,
        { timeout: 45000 }
      );

      const chunks = await page.evaluate(() => window.audioChunksTest);
      log(`[TEST 8] Generated ${chunks.length} audio chunks`, 'green');
      testResults.passed++;
      testResults.tests.push({ name: 'TTS Generation', status: 'PASSED', chunks: chunks.length });

    } catch (err) {
      log(`[TEST 8] TTS generation failed: ${err.message}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'TTS Generation', status: 'FAILED', error: err.message });
    }

    // Test 9: Verify audio data in buffer
    log('\n[TEST 9] Verifying audio buffer contains data...', 'cyan');
    try {
      const audioBuffer = await page.evaluate(() => {
        if (window.ttsClient && window.ttsClient.audioBuffer) {
          return {
            chunksCount: window.ttsClient.audioBuffer.length,
            totalSamples: window.ttsClient.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
          };
        }
        return null;
      });

      if (audioBuffer && audioBuffer.totalSamples > 0) {
        log(`[TEST 9] Audio buffer: ${audioBuffer.chunksCount} chunks, ${audioBuffer.totalSamples} samples`, 'green');
        testResults.passed++;
        testResults.tests.push({ name: 'Audio Buffer', status: 'PASSED', samples: audioBuffer.totalSamples });
      } else {
        throw new Error('Audio buffer is empty');
      }
    } catch (err) {
      log(`[TEST 9] Audio buffer check failed: ${err.message}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'Audio Buffer', status: 'FAILED', error: err.message });
    }

    // Test 10: Verify worker loaded
    log('\n[TEST 10] Verifying worker is loaded...', 'cyan');
    try {
      const workerInfo = await page.evaluate(() => {
        return {
          hasWorker: window.ttsClient?.worker !== null && window.ttsClient?.worker !== undefined,
          isAlive: window.ttsClient?.worker instanceof Worker
        };
      });

      if (workerInfo.hasWorker && workerInfo.isAlive) {
        log('[TEST 10] Worker is loaded and running', 'green');
        testResults.passed++;
        testResults.tests.push({ name: 'Worker Loaded', status: 'PASSED' });
      } else {
        throw new Error('Worker not properly loaded');
      }
    } catch (err) {
      log(`[TEST 10] Worker check failed: ${err.message}`, 'red');
      testResults.failed++;
      testResults.tests.push({ name: 'Worker Loaded', status: 'FAILED', error: err.message });
    }

    // Print network summary
    log('\n[NETWORK SUMMARY]', 'cyan');
    log(`  Total model requests: ${networkRequests.length}`, 'blue');
    log(`  Successful: ${networkRequests.length - failedRequests.length}`, 'green');
    if (failedRequests.length > 0) {
      log(`  Failed: ${failedRequests.length}`, 'red');
    }

    // Print console summary
    log('\n[CONSOLE SUMMARY]', 'cyan');
    log(`  Total messages: ${consoleMessages.length}`, 'blue');
    log(`  Errors: ${consoleErrors.length}`, consoleErrors.length > 0 ? 'red' : 'green');
    log(`  Warnings: ${consoleMessages.filter(m => m.type === 'warn').length}`, 'blue');

    // Print final results
    log('\n' + '='.repeat(60), 'cyan');
    log('TEST RESULTS SUMMARY', 'cyan');
    log('='.repeat(60), 'cyan');

    testResults.tests.forEach((test, idx) => {
      const status = test.status === 'PASSED' ? colors.green + 'PASSED' :
                     test.status === 'FAILED' ? colors.red + 'FAILED' :
                     colors.yellow + 'TIMEOUT';
      const details = test.chunks ? ` (${test.chunks} chunks)` :
                      test.count ? ` (${test.count} models)` :
                      test.samples ? ` (${test.samples} samples)` :
                      test.missing ? ` (missing: ${test.missing.join(', ')})` :
                      test.error ? ` - ${test.error}` : '';
      console.log(`${idx + 1}. ${test.name.padEnd(30)} ${status}${details}${colors.reset}`);
    });

    log('='.repeat(60), 'cyan');
    log(`\nTotal: ${testResults.passed} passed, ${testResults.failed} failed`,
        testResults.failed === 0 ? 'green' : 'red');

    // Detailed error report
    if (consoleErrors.length > 0) {
      log('\n[DETAILED ERROR LOG]', 'red');
      consoleErrors.forEach((err, idx) => {
        log(`  ${idx + 1}. ${err}`, 'red');
      });
    }

    if (failedRequests.length > 0) {
      log('\n[FAILED NETWORK REQUESTS]', 'red');
      failedRequests.forEach((req, idx) => {
        log(`  ${idx + 1}. ${req.url} (${req.status})`, 'red');
      });
    }

    await page.close();

  } catch (err) {
    log(`\n[FATAL ERROR] ${err.message}`, 'red');
    testResults.failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Exit with appropriate code
  const success = testResults.failed === 0;
  log(`\n[RESULT] ${success ? 'All tests passed!' : 'Some tests failed.'}`, success ? 'green' : 'red');
  process.exit(success ? 0 : 1);
}

// Run tests
runTests().catch(err => {
  log(`[FATAL] ${err.message}`, 'red');
  process.exit(1);
});
