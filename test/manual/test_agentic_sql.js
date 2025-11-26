#!/usr/bin/env node
// Manual test script for agentic SQL generation
// Usage: node test/manual/test_agentic_sql.js

import 'dotenv/config';
import { handleGeneration } from '../../server/services/sqlGenerator.js';

// Test queries covering different complexity levels
const testQueries = [
  {
    name: 'Simple term search (Cyrillic)',
    question: 'какой у меня витамин д?',
    expectedIterations: '1-2',
    expectedMatch: 'витамин D',
    description: 'Should use fuzzy_search_parameter_names and find mixed-script matches'
  },
  {
    name: 'Simple term search (English)',
    question: 'what is my cholesterol?',
    expectedIterations: '1-2',
    expectedMatch: 'cholesterol',
    description: 'Should use fuzzy_search_parameter_names for English terms'
  },
  {
    name: 'Aggregation query',
    question: 'какие анализы хуже нормы?',
    expectedIterations: '2-3',
    description: 'Should search for parameters and understand "below normal" logic'
  },
  {
    name: 'Time-based query',
    question: 'мой гемоглобин за последний год',
    expectedIterations: '2-3',
    description: 'Should find hemoglobin and add time filtering'
  },
  {
    name: 'Chemical name search',
    question: 'show me my calcidiol levels',
    expectedIterations: '1-2',
    expectedMatch: 'vitamin D',
    description: 'LLM should understand calcidiol = vitamin D 25-OH'
  },
  {
    name: 'Complex query with multiple terms',
    question: 'сравни мой холестерин и триглицериды за последние 6 месяцев',
    expectedIterations: '2-4',
    description: 'Should handle multiple fuzzy searches and complex SQL construction'
  }
];

async function runTest(testCase) {
  console.log('\n' + '='.repeat(80));
  console.log(`Test: ${testCase.name}`);
  console.log(`Question: "${testCase.question}"`);
  console.log(`Expected iterations: ${testCase.expectedIterations}`);
  console.log(`Description: ${testCase.description}`);
  console.log('='.repeat(80));

  const startTime = Date.now();

  try {
    const result = await handleGeneration({
      question: testCase.question,
      userIdentifier: 'test-user',
      model: process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini'
    });

    const duration = Date.now() - startTime;

    if (result.ok) {
      console.log('✅ SUCCESS');
      console.log(`Duration: ${duration}ms`);

      if (result.metadata?.agentic) {
        console.log(`Iterations: ${result.metadata.agentic.iterations}`);
        console.log(`Forced completion: ${result.metadata.agentic.forced_completion}`);
      }

      console.log(`\nGenerated SQL:\n${result.sql}\n`);

      if (result.explanation) {
        console.log(`Explanation: ${result.explanation}`);
      }

      // Check if SQL looks reasonable
      if (result.sql.toLowerCase().includes('select')) {
        console.log('✓ Contains SELECT statement');
      }

      if (testCase.expectedMatch && result.sql.toLowerCase().includes(testCase.expectedMatch.toLowerCase())) {
        console.log(`✓ Contains expected term: "${testCase.expectedMatch}"`);
      }

    } else {
      console.log('❌ FAILED');
      console.log(`Duration: ${duration}ms`);
      console.log(`Error: ${result.error?.code} - ${result.error?.message}`);

      if (result.details) {
        console.log('Details:', JSON.stringify(result.details, null, 2));
      }

      if (result.metadata?.iteration_log) {
        console.log('\nIteration Log:');
        result.metadata.iteration_log.forEach((log, idx) => {
          console.log(`  ${idx + 1}. ${log.tool || 'unknown'} - ${log.error || 'no error'}`);
        });
      }
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.log('💥 EXCEPTION');
    console.log(`Duration: ${duration}ms`);
    console.log(`Error: ${error.message}`);
    console.log(error.stack);
  }
}

async function main() {
  console.log('\n🚀 Agentic SQL Generation - Manual Test Suite');
  console.log(`Mode: ${process.env.AGENTIC_SQL_ENABLED === 'true' ? 'AGENTIC' : 'SINGLE-SHOT'}`);
  console.log(`Max iterations: ${process.env.AGENTIC_MAX_ITERATIONS || '5'}`);
  console.log(`Fuzzy search limit: ${process.env.AGENTIC_FUZZY_SEARCH_LIMIT || '20'}`);
  console.log(`Similarity threshold: ${process.env.AGENTIC_SIMILARITY_THRESHOLD || '0.3'}`);
  console.log(`Timeout: ${process.env.AGENTIC_TIMEOUT_MS || '15000'}ms`);

  if (process.env.AGENTIC_SQL_ENABLED !== 'true') {
    console.log('\n⚠️  WARNING: AGENTIC_SQL_ENABLED is not set to true');
    console.log('Set AGENTIC_SQL_ENABLED=true in your .env file to test agentic mode\n');
  }

  // Check if specific test requested via command line
  const testIndex = process.argv[2];

  if (testIndex !== undefined) {
    const idx = parseInt(testIndex);
    if (idx >= 0 && idx < testQueries.length) {
      console.log(`\nRunning single test [${idx}]...\n`);
      await runTest(testQueries[idx]);
    } else {
      console.log(`\n❌ Invalid test index: ${testIndex}`);
      console.log(`Valid range: 0-${testQueries.length - 1}`);
      process.exit(1);
    }
  } else {
    // Run all tests
    console.log(`\nRunning all ${testQueries.length} tests...\n`);

    for (let i = 0; i < testQueries.length; i++) {
      await runTest(testQueries[i]);

      // Wait a bit between tests to avoid rate limiting
      if (i < testQueries.length - 1) {
        console.log('\nWaiting 2 seconds before next test...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✨ Test suite completed');
  console.log('='.repeat(80) + '\n');

  process.exit(0);
}

// Run main with error handling
main().catch(error => {
  console.error('\n💥 Fatal error in test suite:');
  console.error(error);
  process.exit(1);
});
