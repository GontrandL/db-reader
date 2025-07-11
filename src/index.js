/**
 * @autoweave/db-reader
 * Universal database reader supporting multiple database types
 */

const crypto = require('crypto');

class DatabaseReader {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.connections = new Map();
    this.queryCache = options.enableCache ? new Map() : null;
    this.cacheTimeout = options.cacheTimeout || 5 * 60 * 1000; // 5 minutes
    this.maxConnections = options.maxConnections || 10;
    this.retryOptions = {
      retries: options.retries || 3,
      factor: options.retryFactor || 2,
      minTimeout: options.minRetryTimeout || 1000,
      maxTimeout: options.maxRetryTimeout || 5000
    };
    
    // Lazy load drivers only when needed
    this.drivers = {
      sqlite: null,
      mysql: null,
      postgres: null,
      mongodb: null
    };
  }

  async connect(config) {
    const { type, id = this.generateConnectionId(type), ...connectionOptions } = config;
    
    // Check connection limit
    if (this.connections.size >= this.maxConnections) {
      throw new Error(`Maximum connections (${this.maxConnections}) reached`);
    }
    
    // Validate connection type
    if (!['sqlite', 'mysql', 'postgres', 'mongodb'].includes(type)) {
      throw new Error(`Unsupported database type: ${type}`);
    }
    
    this.logger.info(`Connecting to ${type} database...`);
    
    try {
      let connection;
      
      switch (type) {
        case 'sqlite':
          connection = await this.connectSQLite(connectionOptions);
          break;
        case 'mysql':
          connection = await this.connectMySQL(connectionOptions);
          break;
        case 'postgres':
          connection = await this.connectPostgres(connectionOptions);
          break;
        case 'mongodb':
          connection = await this.connectMongoDB(connectionOptions);
          break;
      }
      
      // Store connection with metadata
      this.connections.set(id, {
        type,
        connection,
        config: connectionOptions,
        createdAt: new Date(),
        lastUsed: new Date(),
        queryCount: 0
      });
      
      this.logger.info(`Connected to ${type} database (ID: ${id})`);
      return id;
      
    } catch (error) {
      this.logger.error(`Failed to connect to ${type}:`, error.message);
      throw error;
    }
  }

  async query(connectionId, query, params = [], options = {}) {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) {
      throw new Error(`No connection found with id: ${connectionId}`);
    }
    
    connectionInfo.lastUsed = new Date();
    connectionInfo.queryCount++;
    
    // Check cache if enabled
    if (this.queryCache && options.cache !== false) {
      const cacheKey = this.getCacheKey(connectionId, query, params);
      const cached = this.queryCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTimeout)) {
        this.logger.debug('Returning cached query result');
        return cached.result;
      }
    }
    
    try {
      // Execute query with retry logic
      const result = await this.executeWithRetry(
        () => this.executeQuery(connectionInfo, query, params),
        this.retryOptions
      );
      
      // Cache result if enabled
      if (this.queryCache && options.cache !== false) {
        const cacheKey = this.getCacheKey(connectionId, query, params);
        this.queryCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });
      }
      
      return result;
      
    } catch (error) {
      this.logger.error(`Query failed on ${connectionInfo.type}:`, error.message);
      throw error;
    }
  }

  async executeQuery(connectionInfo, query, params) {
    const { type, connection } = connectionInfo;
    
    switch (type) {
      case 'sqlite':
        return this.querySQLite(connection, query, params);
      case 'mysql':
        return this.queryMySQL(connection, query, params);
      case 'postgres':
        return this.queryPostgres(connection, query, params);
      case 'mongodb':
        return this.queryMongoDB(connection, query, params);
      default:
        throw new Error(`Unsupported database type: ${type}`);
    }
  }

  async disconnect(connectionId) {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) {
      return;
    }
    
    try {
      const { type, connection } = connectionInfo;
      
      switch (type) {
        case 'sqlite':
          if (connection.close) await connection.close();
          break;
        case 'mysql':
          if (connection.end) await connection.end();
          break;
        case 'postgres':
          if (connection.end) await connection.end();
          break;
        case 'mongodb':
          if (connection.close) await connection.close();
          break;
      }
      
      this.connections.delete(connectionId);
      this.logger.info(`Disconnected from ${type} database (ID: ${connectionId})`);
      
    } catch (error) {
      this.logger.error(`Error disconnecting:`, error.message);
      throw error;
    }
  }

  async disconnectAll() {
    const promises = Array.from(this.connections.keys()).map(id => 
      this.disconnect(id).catch(err => 
        this.logger.error(`Failed to disconnect ${id}:`, err.message)
      )
    );
    
    await Promise.all(promises);
    this.connections.clear();
    this.logger.info('All database connections closed');
  }

  // Database-specific connection methods
  async connectSQLite(options) {
    if (!this.drivers.sqlite) {
      try {
        this.drivers.sqlite = require('sqlite3').verbose();
      } catch (error) {
        throw new Error('sqlite3 driver not installed. Run: npm install sqlite3');
      }
    }
    
    const { filename = ':memory:', mode } = options;
    
    return new Promise((resolve, reject) => {
      const db = new this.drivers.sqlite.Database(filename, mode, (err) => {
        if (err) {
          reject(err);
        } else {
          // Enable foreign keys
          db.run('PRAGMA foreign_keys = ON');
          resolve(db);
        }
      });
    });
  }

  async connectMySQL(options) {
    if (!this.drivers.mysql) {
      try {
        this.drivers.mysql = require('mysql2/promise');
      } catch (error) {
        throw new Error('mysql2 driver not installed. Run: npm install mysql2');
      }
    }
    
    const connection = await this.drivers.mysql.createConnection({
      host: options.host || 'localhost',
      port: options.port || 3306,
      user: options.user,
      password: options.password,
      database: options.database,
      ...options
    });
    
    return connection;
  }

  async connectPostgres(options) {
    if (!this.drivers.postgres) {
      try {
        const { Client } = require('pg');
        this.drivers.postgres = Client;
      } catch (error) {
        throw new Error('pg driver not installed. Run: npm install pg');
      }
    }
    
    const client = new this.drivers.postgres({
      host: options.host || 'localhost',
      port: options.port || 5432,
      user: options.user,
      password: options.password,
      database: options.database,
      ...options
    });
    
    await client.connect();
    return client;
  }

  async connectMongoDB(options) {
    if (!this.drivers.mongodb) {
      try {
        const { MongoClient } = require('mongodb');
        this.drivers.mongodb = MongoClient;
      } catch (error) {
        throw new Error('mongodb driver not installed. Run: npm install mongodb');
      }
    }
    
    const url = options.url || `mongodb://${options.host || 'localhost'}:${options.port || 27017}`;
    const client = new this.drivers.mongodb(url, {
      useUnifiedTopology: true,
      ...options
    });
    
    await client.connect();
    return client.db(options.database);
  }

  // Database-specific query methods
  async querySQLite(db, query, params) {
    return new Promise((resolve, reject) => {
      if (query.trim().toUpperCase().startsWith('SELECT')) {
        db.all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        db.run(query, params, function(err) {
          if (err) reject(err);
          else resolve({
            changes: this.changes,
            lastID: this.lastID
          });
        });
      }
    });
  }

  async queryMySQL(connection, query, params) {
    const [rows] = await connection.execute(query, params);
    return rows;
  }

  async queryPostgres(client, query, params) {
    const result = await client.query(query, params);
    return result.rows;
  }

  async queryMongoDB(db, query, params) {
    const { collection, operation, ...operationParams } = query;
    
    if (!collection || !operation) {
      throw new Error('MongoDB query must specify collection and operation');
    }
    
    const coll = db.collection(collection);
    
    switch (operation) {
      case 'find':
        return coll.find(operationParams.filter || {}, operationParams.options || {}).toArray();
      case 'findOne':
        return coll.findOne(operationParams.filter || {}, operationParams.options || {});
      case 'insertOne':
        return coll.insertOne(operationParams.document);
      case 'insertMany':
        return coll.insertMany(operationParams.documents);
      case 'updateOne':
        return coll.updateOne(operationParams.filter, operationParams.update, operationParams.options);
      case 'updateMany':
        return coll.updateMany(operationParams.filter, operationParams.update, operationParams.options);
      case 'deleteOne':
        return coll.deleteOne(operationParams.filter);
      case 'deleteMany':
        return coll.deleteMany(operationParams.filter);
      case 'aggregate':
        return coll.aggregate(operationParams.pipeline).toArray();
      default:
        throw new Error(`Unsupported MongoDB operation: ${operation}`);
    }
  }

  // Utility methods
  generateConnectionId(type) {
    return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getCacheKey(connectionId, query, params) {
    const hash = crypto.createHash('sha256');
    hash.update(`${connectionId}:${JSON.stringify(query)}:${JSON.stringify(params)}`);
    return hash.digest('hex');
  }

  async executeWithRetry(fn, options) {
    let lastError;
    let delay = options.minTimeout;
    
    for (let i = 0; i <= options.retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (i < options.retries) {
          this.logger.warn(`Retry ${i + 1}/${options.retries} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * options.factor, options.maxTimeout);
        }
      }
    }
    
    throw lastError;
  }

  // Connection pool management
  getConnectionInfo(connectionId) {
    const info = this.connections.get(connectionId);
    if (!info) return null;
    
    return {
      id: connectionId,
      type: info.type,
      createdAt: info.createdAt,
      lastUsed: info.lastUsed,
      queryCount: info.queryCount,
      config: { ...info.config, password: '***' } // Hide password
    };
  }

  listConnections() {
    return Array.from(this.connections.keys()).map(id => this.getConnectionInfo(id));
  }

  clearCache() {
    if (this.queryCache) {
      this.queryCache.clear();
      this.logger.info('Query cache cleared');
    }
  }

  // Table introspection methods
  async getTables(connectionId) {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) {
      throw new Error(`No connection found with id: ${connectionId}`);
    }
    
    const { type } = connectionInfo;
    
    switch (type) {
      case 'sqlite':
        return this.query(connectionId, 
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );
      case 'mysql':
        return this.query(connectionId, 'SHOW TABLES');
      case 'postgres':
        return this.query(connectionId, 
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        );
      case 'mongodb':
        const db = connectionInfo.connection;
        return db.listCollections().toArray();
      default:
        throw new Error(`getTables not implemented for ${type}`);
    }
  }

  async getTableSchema(connectionId, tableName) {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) {
      throw new Error(`No connection found with id: ${connectionId}`);
    }
    
    const { type } = connectionInfo;
    
    switch (type) {
      case 'sqlite':
        return this.query(connectionId, `PRAGMA table_info(${tableName})`);
      case 'mysql':
        return this.query(connectionId, `DESCRIBE ${tableName}`);
      case 'postgres':
        return this.query(connectionId, 
          `SELECT column_name, data_type, is_nullable 
           FROM information_schema.columns 
           WHERE table_name = $1`,
          [tableName]
        );
      case 'mongodb':
        // MongoDB doesn't have fixed schema, sample documents instead
        return this.query(connectionId, {
          collection: tableName,
          operation: 'find',
          options: { limit: 1 }
        });
      default:
        throw new Error(`getTableSchema not implemented for ${type}`);
    }
  }
}

module.exports = { DatabaseReader };