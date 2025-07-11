/**
 * Basic usage example for @autoweave/db-reader
 */

const { Db-reader } = require('../src/index');

async function main() {
  console.log('🚀 Db-reader Example\n');

  const instance = new Db-reader({
    logger: console
  });

  try {
    await instance.initialize();
    console.log('✅ Db-reader initialized successfully');
    
    // TODO: Add usage examples
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();
