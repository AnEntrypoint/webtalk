#!/usr/bin/env node

/**
 * Inspect ONNX model to find which inputs require int64 dtype
 * This helps identify which states need int64 conversion
 */

const path = require('path');

async function inspectModel() {
    try {
        // Import ONNX Runtime
        const ort = await import('onnxruntime-node');

        const modelPath = path.join(process.cwd(), 'models', 'tts', 'flow_lm_main_int8.onnx');
        console.log('Loading model from:', modelPath);

        // Create session
        const session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['cpu'],
            logSeverityLevel: 2
        });

        console.log('\n=== MODEL INSPECTION ===\n');

        // List all inputs
        console.log('INPUT METADATA:');
        console.log('---------------');

        const inputs = session.inputMetadata;
        const stateInputs = {};

        Object.entries(inputs).forEach(([name, metadata]) => {
            console.log(`\n${name}:`);
            console.log(`  dims: [${metadata.dims.join(', ')}]`);
            console.log(`  type: ${metadata.type}`);

            if (name.startsWith('state_')) {
                stateInputs[name] = metadata.type;
            }
        });

        console.log('\n\n=== STATE INPUTS DTYPE ANALYSIS ===\n');
        console.log('State inputs that require int64:');
        Object.entries(stateInputs).forEach(([name, type]) => {
            if (type === 'int64') {
                console.log(`  ${name}: ${type} ✓ NEEDS INT64`);
            }
        });

        console.log('\nState inputs that are float32:');
        Object.entries(stateInputs).forEach(([name, type]) => {
            if (type === 'float32') {
                console.log(`  ${name}: ${type}`);
            }
        });

        console.log('\n\n=== SUMMARY ===');
        const int64Count = Object.values(stateInputs).filter(t => t === 'int64').length;
        const float32Count = Object.values(stateInputs).filter(t => t === 'float32').length;
        console.log(`Total state inputs: ${Object.keys(stateInputs).length}`);
        console.log(`Int64 states: ${int64Count}`);
        console.log(`Float32 states: ${float32Count}`);

    } catch (err) {
        console.error('Error:', err.message);
        console.error('\nNote: This script requires onnxruntime-node to be installed');
        console.error('Run: npm install onnxruntime-node');
        process.exit(1);
    }
}

inspectModel();
