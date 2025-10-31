/**
 * Test script to compare OpenAI vs Anthropic extraction on the same PDF
 * Run with: node test-providers-comparison.js
 */

require('dotenv').config();
const fs = require('fs');
const OpenAIProvider = require('./server/services/vision/OpenAIProvider');
const AnthropicProvider = require('./server/services/vision/AnthropicProvider');
const { loadPrompt } = require('./server/utils/promptLoader');

const structuredOutputFormat = {
  type: 'json_schema',
  name: 'full_lab_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      patient_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      patient_age: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
      patient_date_of_birth: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      patient_gender: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      test_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      parameters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            parameter_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            result: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reference_interval: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lower: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                lower_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                upper: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                upper_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                full_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['lower', 'lower_operator', 'upper', 'upper_operator', 'text', 'full_text'],
            },
            is_value_out_of_range: { type: 'boolean' },
            numeric_result: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          },
          required: [
            'parameter_name',
            'result',
            'unit',
            'reference_interval',
            'is_value_out_of_range',
            'numeric_result',
          ],
        },
      },
      missing_data: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            parameter_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            missing_fields: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['parameter_name', 'missing_fields'],
        },
      },
    },
    required: ['patient_name', 'patient_age', 'patient_date_of_birth', 'patient_gender', 'test_date', 'parameters', 'missing_data'],
  },
};

async function testProvider(provider, providerName, imageDataUrl) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${providerName}`);
  console.log('='.repeat(60));

  const systemPrompt = loadPrompt('lab_system_prompt.txt');
  const userPrompt = loadPrompt('lab_user_prompt.txt');

  try {
    const startTime = Date.now();
    const result = await provider.analyze(
      [imageDataUrl],
      systemPrompt,
      userPrompt,
      structuredOutputFormat.schema
    );
    const endTime = Date.now();

    console.log(`\n✅ ${providerName} completed in ${endTime - startTime}ms`);
    console.log('\nExtracted data:');
    console.log(`  Patient name: ${result.patient_name || 'N/A'}`);
    console.log(`  Patient age: ${result.patient_age || 'N/A'}`);
    console.log(`  Test date: ${result.test_date || 'N/A'}`);
    console.log(`  Parameters: ${result.parameters?.length || 0} entries`);
    console.log(`  Missing data: ${result.missing_data?.length || 0} entries`);

    if (result.parameters?.length > 0) {
      console.log('\nFirst 3 parameters:');
      result.parameters.slice(0, 3).forEach((param, idx) => {
        console.log(`  ${idx + 1}. ${param.parameter_name}: ${param.result} ${param.unit || ''}`);
      });
    } else {
      console.log('\n⚠️  No parameters extracted');
    }

    return result;
  } catch (error) {
    console.error(`\n❌ ${providerName} failed:`, error.message);
    throw error;
  }
}

async function main() {
  // Create a simple test image (1x1 white pixel PNG as data URL)
  // In real test, you'd use: const imageBuffer = fs.readFileSync('path/to/test.pdf');
  const testImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

  console.log('Provider Comparison Test');
  console.log('========================\n');
  console.log('This test uses a minimal test image.');
  console.log('For real comparison, replace testImageDataUrl with actual PDF data.\n');

  const openaiProvider = new OpenAIProvider();
  const anthropicProvider = new AnthropicProvider();

  try {
    openaiProvider.validateConfig();
    console.log('✅ OpenAI config valid');
  } catch (e) {
    console.log('⚠️  OpenAI config invalid:', e.message);
  }

  try {
    anthropicProvider.validateConfig();
    console.log('✅ Anthropic config valid');
  } catch (e) {
    console.log('⚠️  Anthropic config invalid:', e.message);
  }

  console.log('\nNote: This test script is a template.');
  console.log('To run a real comparison:');
  console.log('1. Uncomment the fs.readFileSync line above');
  console.log('2. Provide a real PDF path');
  console.log('3. Ensure both API keys are set in .env');
}

main().catch(console.error);
