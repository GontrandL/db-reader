/**
 * Complete example demonstrating all features of @autoweave/db-reader
 */

const { DatabaseReader } = require('../src/index');

// Custom logger for demo
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.log('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args)
};

async function main() {
  console.log('🚀 DatabaseReader Complete Example\n');

  // Create reader with all features enabled
  const reader = new DatabaseReader({
    logger,
    enableCache: true,
    cacheTimeout: 30000, // 30 seconds
    maxConnections: 5,
    retries: 2
  });

  try {
    // 1. SQLite Example
    console.log('═══ SQLite Example ═══');
    await sqliteExample(reader);
    
    // 2. MySQL Example (requires MySQL server)
    console.log('\n═══ MySQL Example ═══');
    await mysqlExample(reader);
    
    // 3. PostgreSQL Example (requires PostgreSQL server)
    console.log('\n═══ PostgreSQL Example ═══');
    await postgresExample(reader);
    
    // 4. MongoDB Example (requires MongoDB server)
    console.log('\n═══ MongoDB Example ═══');
    await mongodbExample(reader);
    
    // 5. Advanced Features
    console.log('\n═══ Advanced Features ═══');
    await advancedFeatures(reader);
    
  } catch (error) {
    console.error('Example failed:', error.message);
  } finally {
    // Always disconnect all connections
    await reader.disconnectAll();
  }
}

async function sqliteExample(reader) {
  // Connect to in-memory SQLite database
  const connId = await reader.connect({
    type: 'sqlite',
    filename: ':memory:' // In-memory database
  });
  
  console.log(`✅ Connected to SQLite (ID: ${connId})`);
  
  // Create table
  await reader.query(connId, `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Insert data
  const insertResult = await reader.query(connId, 
    'INSERT INTO users (name, email) VALUES (?, ?)',
    ['John Doe', 'john@example.com']
  );
  console.log(`Inserted user with ID: ${insertResult.lastID}`);
  
  // Query data
  const users = await reader.query(connId, 'SELECT * FROM users');
  console.log('Users:', users);
  
  // Get table info
  const tables = await reader.getTables(connId);
  console.log('Tables:', tables);
  
  const schema = await reader.getTableSchema(connId, 'users');
  console.log('User table schema:', schema);
}

async function mysqlExample(reader) {
  try {
    // Connect to MySQL (update credentials as needed)
    const connId = await reader.connect({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'test'
    });
    
    console.log(`✅ Connected to MySQL (ID: ${connId})`);
    
    // Create table if not exists
    await reader.query(connId, `
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2),
        stock INT DEFAULT 0
      )
    `);
    
    // Insert with prepared statement
    await reader.query(connId,
      'INSERT INTO products (name, price, stock) VALUES (?, ?, ?)',
      ['Laptop', 999.99, 10]
    );
    
    // Query with cache
    const products = await reader.query(connId, 
      'SELECT * FROM products WHERE price > ?',
      [500],
      { cache: true } // Enable caching for this query
    );
    console.log('Products:', products);
    
    // Second query should be cached
    const cachedProducts = await reader.query(connId,
      'SELECT * FROM products WHERE price > ?',
      [500]
    );
    console.log('Cached query returned same results');
    
  } catch (error) {
    console.log('MySQL example skipped:', error.message);
  }
}

async function postgresExample(reader) {
  try {
    // Connect to PostgreSQL
    const connId = await reader.connect({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'password',
      database: 'test'
    });
    
    console.log(`✅ Connected to PostgreSQL (ID: ${connId})`);
    
    // Create table with advanced features
    await reader.query(connId, `
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255),
        total NUMERIC(10, 2),
        status VARCHAR(50) DEFAULT 'pending',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insert with JSONB
    await reader.query(connId,
      `INSERT INTO orders (customer_name, total, metadata) 
       VALUES ($1, $2, $3)`,
      ['Alice Smith', 150.00, JSON.stringify({ items: ['item1', 'item2'] })]
    );
    
    // Query with JSONB
    const orders = await reader.query(connId,
      `SELECT * FROM orders WHERE metadata @> $1`,
      [JSON.stringify({ items: ['item1'] })]
    );
    console.log('Orders with item1:', orders);
    
  } catch (error) {
    console.log('PostgreSQL example skipped:', error.message);
  }
}

async function mongodbExample(reader) {
  try {
    // Connect to MongoDB
    const connId = await reader.connect({
      type: 'mongodb',
      host: 'localhost',
      port: 27017,
      database: 'test'
    });
    
    console.log(`✅ Connected to MongoDB (ID: ${connId})`);
    
    // Insert document
    const insertResult = await reader.query(connId, {
      collection: 'users',
      operation: 'insertOne',
      document: {
        name: 'Bob Johnson',
        email: 'bob@example.com',
        tags: ['customer', 'premium'],
        metadata: {
          lastLogin: new Date(),
          preferences: { theme: 'dark' }
        }
      }
    });
    console.log('Inserted document ID:', insertResult.insertedId);
    
    // Find documents
    const users = await reader.query(connId, {
      collection: 'users',
      operation: 'find',
      filter: { tags: 'premium' },
      options: { limit: 10 }
    });
    console.log('Premium users:', users);
    
    // Aggregation pipeline
    const stats = await reader.query(connId, {
      collection: 'users',
      operation: 'aggregate',
      pipeline: [
        { $match: { tags: 'premium' } },
        { $group: { _id: null, count: { $sum: 1 } } }
      ]
    });
    console.log('Premium user stats:', stats);
    
    // List collections
    const collections = await reader.getTables(connId);
    console.log('Collections:', collections);
    
  } catch (error) {
    console.log('MongoDB example skipped:', error.message);
  }
}

async function advancedFeatures(reader) {
  // 1. Connection Management
  console.log('\n1. Connection Management:');
  
  // Create multiple connections
  const conn1 = await reader.connect({ type: 'sqlite', id: 'conn1' });
  const conn2 = await reader.connect({ type: 'sqlite', id: 'conn2' });
  
  // List all connections
  const connections = reader.listConnections();
  console.log('Active connections:');
  connections.forEach(conn => {
    console.log(`  - ${conn.id}: ${conn.type} (queries: ${conn.queryCount})`);
  });
  
  // Get specific connection info
  const connInfo = reader.getConnectionInfo('conn1');
  console.log('Connection details:', connInfo);
  
  // 2. Error Handling with Retry
  console.log('\n2. Error Handling with Retry:');
  
  // This will demonstrate retry logic
  let attemptCount = 0;
  reader.executeQuery = async function(connInfo, query, params) {
    attemptCount++;
    if (attemptCount < 2) {
      throw new Error('Simulated temporary failure');
    }
    return [{ result: 'Success after retry' }];
  };
  
  try {
    const result = await reader.query(conn1, 'SELECT 1');
    console.log('Query succeeded after retry:', result);
  } catch (error) {
    console.error('Query failed after all retries:', error.message);
  }
  
  // 3. Cache Management
  console.log('\n3. Cache Management:');
  
  // Reset executeQuery to normal
  reader.executeQuery = DatabaseReader.prototype.executeQuery;
  
  // Execute same query multiple times
  const query = 'SELECT datetime("now")';
  
  console.log('First query (not cached):');
  const result1 = await reader.query(conn1, query, [], { cache: true });
  console.log(result1);
  
  console.log('Second query (cached):');
  const result2 = await reader.query(conn1, query, [], { cache: true });
  console.log(result2);
  console.log('Results are identical:', JSON.stringify(result1) === JSON.stringify(result2));
  
  // Clear cache
  reader.clearCache();
  console.log('Cache cleared');
  
  console.log('Third query (not cached):');
  const result3 = await reader.query(conn1, query, [], { cache: true });
  console.log(result3);
  
  // 4. Transaction Example (SQLite)
  console.log('\n4. Transaction Example:');
  
  try {
    await reader.query(conn1, 'BEGIN TRANSACTION');
    await reader.query(conn1, 'CREATE TABLE test (id INTEGER, value TEXT)');
    await reader.query(conn1, 'INSERT INTO test VALUES (1, "one")');
    await reader.query(conn1, 'INSERT INTO test VALUES (2, "two")');
    await reader.query(conn1, 'COMMIT');
    
    const data = await reader.query(conn1, 'SELECT * FROM test');
    console.log('Transaction completed, data:', data);
  } catch (error) {
    await reader.query(conn1, 'ROLLBACK');
    console.error('Transaction failed:', error.message);
  }
  
  // 5. Connection Limits
  console.log('\n5. Connection Limits:');
  
  // Try to exceed connection limit
  reader.maxConnections = 3; // We already have 2
  
  try {
    await reader.connect({ type: 'sqlite', id: 'conn3' });
    console.log('Created connection 3');
    
    await reader.connect({ type: 'sqlite', id: 'conn4' });
  } catch (error) {
    console.log('Connection limit enforced:', error.message);
  }
}

// Run the example
main().catch(console.error);