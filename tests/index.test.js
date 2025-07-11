/**
 * @autoweave/db-reader tests
 */

const { DatabaseReader } = require('../src/index');
const crypto = require('crypto');

// Mock database drivers
jest.mock('sqlite3', () => ({
  verbose: () => ({
    Database: jest.fn()
  })
}));

jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn()
}));

jest.mock('pg', () => ({
  Client: jest.fn()
}));

jest.mock('mongodb', () => ({
  MongoClient: jest.fn()
}));

describe('DatabaseReader', () => {
  let reader;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    reader = new DatabaseReader({ logger: mockLogger });
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const reader = new DatabaseReader();
      expect(reader.logger).toBe(console);
      expect(reader.connections).toBeInstanceOf(Map);
      expect(reader.queryCache).toBeNull();
      expect(reader.maxConnections).toBe(10);
    });

    it('should accept custom options', () => {
      const reader = new DatabaseReader({
        logger: mockLogger,
        enableCache: true,
        cacheTimeout: 1000,
        maxConnections: 5,
        retries: 2
      });
      expect(reader.logger).toBe(mockLogger);
      expect(reader.queryCache).toBeInstanceOf(Map);
      expect(reader.cacheTimeout).toBe(1000);
      expect(reader.maxConnections).toBe(5);
      expect(reader.retryOptions.retries).toBe(2);
    });
  });

  describe('connect', () => {
    it('should validate database type', async () => {
      await expect(reader.connect({ type: 'invalid' }))
        .rejects.toThrow('Unsupported database type: invalid');
    });

    it('should enforce connection limit', async () => {
      reader.maxConnections = 1;
      reader.connections.set('test', {});
      
      await expect(reader.connect({ type: 'sqlite' }))
        .rejects.toThrow('Maximum connections (1) reached');
    });

    it('should generate connection id if not provided', async () => {
      const sqlite3 = require('sqlite3').verbose();
      const mockDb = {
        run: jest.fn()
      };
      sqlite3.Database.mockImplementation((filename, mode, callback) => {
        callback(null);
        return mockDb;
      });

      const connectionId = await reader.connect({ type: 'sqlite' });
      expect(connectionId).toMatch(/^sqlite-\d+-[a-z0-9]+$/);
    });

    it('should store connection metadata', async () => {
      const sqlite3 = require('sqlite3').verbose();
      const mockDb = {
        run: jest.fn()
      };
      sqlite3.Database.mockImplementation((filename, mode, callback) => {
        callback(null);
        return mockDb;
      });

      const connectionId = await reader.connect({ 
        type: 'sqlite',
        id: 'test-conn',
        filename: 'test.db'
      });

      const connInfo = reader.connections.get('test-conn');
      expect(connInfo).toBeDefined();
      expect(connInfo.type).toBe('sqlite');
      expect(connInfo.connection).toBe(mockDb);
      expect(connInfo.config.filename).toBe('test.db');
      expect(connInfo.createdAt).toBeInstanceOf(Date);
      expect(connInfo.queryCount).toBe(0);
    });
  });

  describe('connectSQLite', () => {
    it('should create SQLite connection', async () => {
      const sqlite3 = require('sqlite3').verbose();
      const mockDb = {
        run: jest.fn()
      };
      sqlite3.Database.mockImplementation((filename, mode, callback) => {
        callback(null);
        return mockDb;
      });

      await reader.connect({ type: 'sqlite', filename: 'test.db' });
      
      expect(sqlite3.Database).toHaveBeenCalledWith('test.db', undefined, expect.any(Function));
      expect(mockDb.run).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
    });

    it('should handle connection errors', async () => {
      const sqlite3 = require('sqlite3').verbose();
      sqlite3.Database.mockImplementation((filename, mode, callback) => {
        callback(new Error('Connection failed'));
      });

      await expect(reader.connect({ type: 'sqlite' }))
        .rejects.toThrow('Connection failed');
    });

    it('should provide helpful error for missing driver', async () => {
      reader.drivers.sqlite = null;
      jest.resetModules();
      jest.doMock('sqlite3', () => {
        throw new Error('Module not found');
      });

      await expect(reader.connectSQLite({}))
        .rejects.toThrow('sqlite3 driver not installed. Run: npm install sqlite3');
    });
  });

  describe('connectMySQL', () => {
    it('should create MySQL connection', async () => {
      const mysql2 = require('mysql2/promise');
      const mockConnection = {};
      mysql2.createConnection.mockResolvedValue(mockConnection);

      await reader.connect({ 
        type: 'mysql',
        user: 'root',
        password: 'pass',
        database: 'testdb'
      });

      expect(mysql2.createConnection).toHaveBeenCalledWith({
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'pass',
        database: 'testdb'
      });
    });
  });

  describe('query', () => {
    let connectionId;

    beforeEach(async () => {
      const sqlite3 = require('sqlite3').verbose();
      const mockDb = {
        run: jest.fn(),
        all: jest.fn()
      };
      sqlite3.Database.mockImplementation((filename, mode, callback) => {
        callback(null);
        return mockDb;
      });

      connectionId = await reader.connect({ type: 'sqlite' });
    });

    it('should throw error for invalid connection', async () => {
      await expect(reader.query('invalid-id', 'SELECT 1'))
        .rejects.toThrow('No connection found with id: invalid-id');
    });

    it('should update connection metadata on query', async () => {
      const connInfo = reader.connections.get(connectionId);
      const lastUsed = connInfo.lastUsed;
      
      // Mock implementation
      reader.executeQuery = jest.fn().mockResolvedValue([]);
      
      await reader.query(connectionId, 'SELECT 1');
      
      expect(connInfo.queryCount).toBe(1);
      expect(connInfo.lastUsed.getTime()).toBeGreaterThan(lastUsed.getTime());
    });

    it('should use cache when enabled', async () => {
      reader.queryCache = new Map();
      reader.executeQuery = jest.fn().mockResolvedValue([{ id: 1 }]);
      
      // First query
      const result1 = await reader.query(connectionId, 'SELECT 1');
      expect(reader.executeQuery).toHaveBeenCalledTimes(1);
      
      // Second query (should be cached)
      const result2 = await reader.query(connectionId, 'SELECT 1');
      expect(reader.executeQuery).toHaveBeenCalledTimes(1);
      expect(result2).toEqual(result1);
    });

    it('should skip cache when disabled in options', async () => {
      reader.queryCache = new Map();
      reader.executeQuery = jest.fn().mockResolvedValue([{ id: 1 }]);
      
      await reader.query(connectionId, 'SELECT 1');
      await reader.query(connectionId, 'SELECT 1', [], { cache: false });
      
      expect(reader.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('should retry on failure', async () => {
      reader.executeQuery = jest.fn()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce([{ id: 1 }]);
      
      const result = await reader.query(connectionId, 'SELECT 1');
      
      expect(reader.executeQuery).toHaveBeenCalledTimes(2);
      expect(result).toEqual([{ id: 1 }]);
      expect(mockLogger.warn).toHaveBeenCalledWith('Retry 1/3 after 1000ms');
    });
  });

  describe('querySQLite', () => {
    it('should execute SELECT queries', async () => {
      const mockDb = {
        all: jest.fn((query, params, callback) => {
          callback(null, [{ id: 1, name: 'test' }]);
        })
      };

      const result = await reader.querySQLite(mockDb, 'SELECT * FROM users', []);
      
      expect(mockDb.all).toHaveBeenCalledWith('SELECT * FROM users', [], expect.any(Function));
      expect(result).toEqual([{ id: 1, name: 'test' }]);
    });

    it('should execute INSERT/UPDATE queries', async () => {
      const mockDb = {
        run: jest.fn(function(query, params, callback) {
          this.changes = 1;
          this.lastID = 42;
          callback.call(this, null);
        })
      };

      const result = await reader.querySQLite(mockDb, 'INSERT INTO users VALUES (?)', ['test']);
      
      expect(mockDb.run).toHaveBeenCalledWith('INSERT INTO users VALUES (?)', ['test'], expect.any(Function));
      expect(result).toEqual({ changes: 1, lastID: 42 });
    });
  });

  describe('queryMongoDB', () => {
    it('should execute find operation', async () => {
      const mockCollection = {
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: '1', name: 'test' }])
        })
      };
      const mockDb = {
        collection: jest.fn().mockReturnValue(mockCollection)
      };

      const result = await reader.queryMongoDB(mockDb, {
        collection: 'users',
        operation: 'find',
        filter: { name: 'test' }
      });

      expect(mockDb.collection).toHaveBeenCalledWith('users');
      expect(mockCollection.find).toHaveBeenCalledWith({ name: 'test' }, {});
      expect(result).toEqual([{ _id: '1', name: 'test' }]);
    });

    it('should validate MongoDB query format', async () => {
      const mockDb = {};
      
      await expect(reader.queryMongoDB(mockDb, {}))
        .rejects.toThrow('MongoDB query must specify collection and operation');
    });

    it('should handle unsupported operations', async () => {
      const mockDb = {
        collection: jest.fn().mockReturnValue({})
      };

      await expect(reader.queryMongoDB(mockDb, {
        collection: 'users',
        operation: 'unsupported'
      })).rejects.toThrow('Unsupported MongoDB operation: unsupported');
    });
  });

  describe('disconnect', () => {
    it('should close connection and remove from map', async () => {
      const mockDb = {
        close: jest.fn().mockResolvedValue()
      };
      
      reader.connections.set('test-id', {
        type: 'sqlite',
        connection: mockDb
      });

      await reader.disconnect('test-id');
      
      expect(mockDb.close).toHaveBeenCalled();
      expect(reader.connections.has('test-id')).toBe(false);
    });

    it('should handle non-existent connections gracefully', async () => {
      await expect(reader.disconnect('non-existent')).resolves.not.toThrow();
    });

    it('should handle different database types', async () => {
      const connections = [
        { type: 'mysql', connection: { end: jest.fn().mockResolvedValue() } },
        { type: 'postgres', connection: { end: jest.fn().mockResolvedValue() } },
        { type: 'mongodb', connection: { close: jest.fn().mockResolvedValue() } }
      ];

      connections.forEach((conn, index) => {
        reader.connections.set(`conn-${index}`, conn);
      });

      await Promise.all(connections.map((_, index) => reader.disconnect(`conn-${index}`)));

      expect(connections[0].connection.end).toHaveBeenCalled();
      expect(connections[1].connection.end).toHaveBeenCalled();
      expect(connections[2].connection.close).toHaveBeenCalled();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all connections', async () => {
      const connections = ['conn1', 'conn2', 'conn3'];
      connections.forEach(id => {
        reader.connections.set(id, {
          type: 'sqlite',
          connection: { close: jest.fn().mockResolvedValue() }
        });
      });

      await reader.disconnectAll();
      
      expect(reader.connections.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('All database connections closed');
    });
  });

  describe('utility methods', () => {
    it('should generate unique connection ids', () => {
      const id1 = reader.generateConnectionId('mysql');
      const id2 = reader.generateConnectionId('mysql');
      
      expect(id1).toMatch(/^mysql-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should generate consistent cache keys', () => {
      const key1 = reader.getCacheKey('conn1', 'SELECT 1', []);
      const key2 = reader.getCacheKey('conn1', 'SELECT 1', []);
      const key3 = reader.getCacheKey('conn1', 'SELECT 2', []);
      
      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash
    });

    it('should clear cache', () => {
      reader.queryCache = new Map();
      reader.queryCache.set('key1', { result: [] });
      reader.queryCache.set('key2', { result: [] });
      
      reader.clearCache();
      
      expect(reader.queryCache.size).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('Query cache cleared');
    });

    it('should list connections with hidden passwords', () => {
      reader.connections.set('conn1', {
        type: 'mysql',
        config: { host: 'localhost', password: 'secret' },
        createdAt: new Date(),
        lastUsed: new Date(),
        queryCount: 5
      });

      const list = reader.listConnections();
      
      expect(list).toHaveLength(1);
      expect(list[0].config.password).toBe('***');
      expect(list[0].config.host).toBe('localhost');
    });
  });

  describe('getTables', () => {
    it('should get tables for SQLite', async () => {
      reader.connections.set('test', { type: 'sqlite' });
      reader.query = jest.fn().mockResolvedValue([{ name: 'users' }, { name: 'posts' }]);
      
      const tables = await reader.getTables('test');
      
      expect(reader.query).toHaveBeenCalledWith('test', 
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      expect(tables).toEqual([{ name: 'users' }, { name: 'posts' }]);
    });

    it('should get tables for MySQL', async () => {
      reader.connections.set('test', { type: 'mysql' });
      reader.query = jest.fn().mockResolvedValue([{ Tables_in_db: 'users' }]);
      
      await reader.getTables('test');
      
      expect(reader.query).toHaveBeenCalledWith('test', 'SHOW TABLES');
    });

    it('should handle MongoDB collections', async () => {
      const mockDb = {
        listCollections: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ name: 'users' }])
        })
      };
      reader.connections.set('test', { type: 'mongodb', connection: mockDb });
      
      const collections = await reader.getTables('test');
      
      expect(collections).toEqual([{ name: 'users' }]);
    });
  });

  describe('getTableSchema', () => {
    it('should get schema for different database types', async () => {
      const testCases = [
        {
          type: 'sqlite',
          expectedQuery: 'PRAGMA table_info(users)',
          expectedParams: undefined
        },
        {
          type: 'mysql',
          expectedQuery: 'DESCRIBE users',
          expectedParams: undefined
        },
        {
          type: 'postgres',
          expectedQuery: expect.stringContaining('information_schema.columns'),
          expectedParams: ['users']
        }
      ];

      for (const testCase of testCases) {
        reader.connections.set('test', { type: testCase.type });
        reader.query = jest.fn().mockResolvedValue([]);
        
        await reader.getTableSchema('test', 'users');
        
        if (testCase.expectedParams) {
          expect(reader.query).toHaveBeenCalledWith('test', testCase.expectedQuery, testCase.expectedParams);
        } else {
          expect(reader.query).toHaveBeenCalledWith('test', testCase.expectedQuery);
        }
      }
    });
  });
});
