# @autoweave/db-reader

[![npm version](https://badge.fury.io/js/@autoweave%2Fdb-reader.svg)](https://www.npmjs.com/package/@autoweave/db-reader)
[![CI](https://github.com/GontrandL/db-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/GontrandL/db-reader/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/GontrandL/db-reader/badge.svg?branch=main)](https://coveralls.io/github/GontrandL/db-reader?branch=main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 📚 Universal database reader with support for SQLite, MySQL, PostgreSQL, and MongoDB

## 📋 Description

`@autoweave/db-reader` provides a unified interface for reading from multiple database types. It features connection pooling, query caching, automatic retries, and comprehensive error handling. Perfect for applications that need to work with multiple databases or migrate between different database systems.

## ✨ Features

- 🔌 **Multi-Database Support**: SQLite, MySQL, PostgreSQL, MongoDB
- 🚀 **Connection Pooling**: Manage multiple connections efficiently
- 💾 **Query Caching**: Optional in-memory caching with TTL
- 🔄 **Automatic Retry**: Configurable retry logic for transient failures
- 🔍 **Schema Introspection**: Discover tables and schemas
- 🛡️ **Type Safety**: Consistent API across all database types
- 📊 **Connection Monitoring**: Track usage and performance
- 🔒 **Secure**: Password hiding in connection info

## 🚀 Installation

```bash
npm install @autoweave/db-reader
```

### Optional Database Drivers

Install only the drivers you need:

```bash
# SQLite
npm install sqlite3

# MySQL
npm install mysql2

# PostgreSQL
npm install pg

# MongoDB
npm install mongodb
```

## 📖 Usage

### Basic Example

```javascript
const { DatabaseReader } = require('@autoweave/db-reader');

// Create a reader instance
const reader = new DatabaseReader({
  logger: console,
  enableCache: true,
  maxConnections: 10
});

// Connect to a database
const connectionId = await reader.connect({
  type: 'sqlite',
  filename: './mydb.sqlite'
});

// Execute queries
const users = await reader.query(connectionId, 'SELECT * FROM users');
console.log(users);

// Disconnect when done
await reader.disconnect(connectionId);
```

### Connection Examples

#### SQLite
```javascript
const sqliteConn = await reader.connect({
  type: 'sqlite',
  filename: './data.db', // or ':memory:' for in-memory
  mode: OPEN_READWRITE | OPEN_CREATE // optional
});
```

#### MySQL
```javascript
const mysqlConn = await reader.connect({
  type: 'mysql',
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'password',
  database: 'myapp'
});
```

#### PostgreSQL
```javascript
const pgConn = await reader.connect({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'myapp'
});
```

#### MongoDB
```javascript
const mongoConn = await reader.connect({
  type: 'mongodb',
  url: 'mongodb://localhost:27017', // or use host/port
  database: 'myapp'
});
```

### Query Examples

#### SQL Databases (SQLite, MySQL, PostgreSQL)
```javascript
// Simple query
const results = await reader.query(connId, 'SELECT * FROM users WHERE age > 18');

// Parameterized query (prevents SQL injection)
const user = await reader.query(
  connId,
  'SELECT * FROM users WHERE email = ?',
  ['user@example.com']
);

// Insert with parameters
const result = await reader.query(
  connId,
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['John Doe', 'john@example.com']
);
console.log('Inserted ID:', result.lastID); // SQLite
console.log('Affected rows:', result.affectedRows); // MySQL
```

#### MongoDB Queries
```javascript
// Find documents
const users = await reader.query(mongoConn, {
  collection: 'users',
  operation: 'find',
  filter: { age: { $gt: 18 } },
  options: { limit: 10, sort: { name: 1 } }
});

// Insert document
const result = await reader.query(mongoConn, {
  collection: 'users',
  operation: 'insertOne',
  document: { name: 'John', email: 'john@example.com' }
});

// Aggregation
const stats = await reader.query(mongoConn, {
  collection: 'orders',
  operation: 'aggregate',
  pipeline: [
    { $match: { status: 'completed' } },
    { $group: { _id: '$product', total: { $sum: '$amount' } } }
  ]
});
```

### Advanced Features

#### Query Caching
```javascript
const reader = new DatabaseReader({
  enableCache: true,
  cacheTimeout: 60000 // 1 minute
});

// This query will be cached
const result1 = await reader.query(connId, 'SELECT * FROM config', [], { cache: true });

// This will return cached result if called within 1 minute
const result2 = await reader.query(connId, 'SELECT * FROM config', [], { cache: true });

// Clear cache manually
reader.clearCache();
```

#### Connection Management
```javascript
// List all active connections
const connections = reader.listConnections();
connections.forEach(conn => {
  console.log(`${conn.id}: ${conn.type} - ${conn.queryCount} queries`);
});

// Get specific connection info
const info = reader.getConnectionInfo(connectionId);
console.log(info); // passwords are hidden

// Disconnect all connections
await reader.disconnectAll();
```

#### Schema Introspection
```javascript
// Get all tables/collections
const tables = await reader.getTables(connectionId);
console.log('Tables:', tables);

// Get table schema
const schema = await reader.getTableSchema(connectionId, 'users');
console.log('Schema:', schema);
```

#### Error Handling & Retries
```javascript
const reader = new DatabaseReader({
  retries: 3,
  retryFactor: 2,
  minRetryTimeout: 1000,
  maxRetryTimeout: 5000
});

// Queries will automatically retry on transient failures
try {
  const result = await reader.query(connId, 'SELECT * FROM users');
} catch (error) {
  console.error('Query failed after 3 retries:', error);
}
```

## 🔧 API Reference

### Constructor Options

```javascript
new DatabaseReader(options)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger` | Object | `console` | Logger instance (must have info, warn, error, debug methods) |
| `enableCache` | Boolean | `false` | Enable query result caching |
| `cacheTimeout` | Number | `300000` | Cache TTL in milliseconds (5 minutes) |
| `maxConnections` | Number | `10` | Maximum number of concurrent connections |
| `retries` | Number | `3` | Number of retry attempts for failed queries |
| `retryFactor` | Number | `2` | Exponential backoff factor |
| `minRetryTimeout` | Number | `1000` | Minimum retry delay in ms |
| `maxRetryTimeout` | Number | `5000` | Maximum retry delay in ms |

### Methods

#### `connect(config)`
Establishes a connection to a database.

**Parameters:**
- `config` (Object): Database-specific configuration
  - `type` (String): Database type ('sqlite', 'mysql', 'postgres', 'mongodb')
  - `id` (String, optional): Custom connection ID
  - Additional properties depend on database type

**Returns:** Promise<String> - Connection ID

#### `query(connectionId, query, params?, options?)`
Executes a query on the specified connection.

**Parameters:**
- `connectionId` (String): Connection identifier
- `query` (String|Object): SQL query string or MongoDB operation object
- `params` (Array, optional): Query parameters for prepared statements
- `options` (Object, optional): Query options
  - `cache` (Boolean): Whether to cache this query result

**Returns:** Promise<Any> - Query results

#### `disconnect(connectionId)`
Closes a specific database connection.

**Parameters:**
- `connectionId` (String): Connection identifier

**Returns:** Promise<void>

#### `disconnectAll()`
Closes all database connections.

**Returns:** Promise<void>

#### `getTables(connectionId)`
Lists all tables/collections in the database.

**Parameters:**
- `connectionId` (String): Connection identifier

**Returns:** Promise<Array> - List of table/collection names

#### `getTableSchema(connectionId, tableName)`
Gets the schema/structure of a table.

**Parameters:**
- `connectionId` (String): Connection identifier
- `tableName` (String): Table/collection name

**Returns:** Promise<Array> - Schema information

#### `listConnections()`
Lists all active connections with their metadata.

**Returns:** Array<Object> - Connection information

#### `getConnectionInfo(connectionId)`
Gets detailed information about a specific connection.

**Parameters:**
- `connectionId` (String): Connection identifier

**Returns:** Object|null - Connection details (passwords hidden)

#### `clearCache()`
Clears the query result cache.

**Returns:** void

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --testPathPattern=index.test.js
```

## 📚 Examples

Check out the [examples](./examples) directory for:
- [Basic usage](./examples/basic-usage.js) - Simple connection and queries
- [Complete example](./examples/complete-example.js) - All features demonstrated

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT - See [LICENSE](LICENSE) for details.

## 🔗 Links

- [GitHub Repository](https://github.com/GontrandL/db-reader)
- [NPM Package](https://www.npmjs.com/package/@autoweave/db-reader)
- [AutoWeave Documentation](https://github.com/GontrandL/AutoWeave)
- [Report Issues](https://github.com/GontrandL/db-reader/issues)