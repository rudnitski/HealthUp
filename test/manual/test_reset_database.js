// test/manual/test_reset_database.js

// Load environment variables
import '../../server/config/loadEnv.js';

import { resetDatabase } from '../../server/db/schema.js';
import { pool } from '../../server/db/index.js';

async function testResetDatabase() {
  console.log('Testing resetDatabase() includes new auth tables...');

  try {
    // Create test data in auth tables
    await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('Reset Test', 'reset@example.com')
    `);

    console.log('Created test user');

    // Call resetDatabase
    await resetDatabase();

    console.log('resetDatabase() completed');

    // Verify auth tables are empty
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const count = Number(userCount.rows[0].count);

    if (count === 0) {
      console.log('✅ SUCCESS: Auth tables properly reset');
    } else {
      console.error('❌ FAILURE: Found', count, 'users after reset');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testResetDatabase();
