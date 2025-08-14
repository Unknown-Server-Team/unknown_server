import mysql from 'mysql';

const LogManager = require('../managers/LogManager');

// Database configuration interface
interface DatabaseConfig {
    host: string;
    user: string;
    password: string;
    database: string;
    waitForConnections: boolean;
    connectionLimit: number;
    queueLimit: number;
}

// Database connection interface
interface DatabaseConnection {
    pool: mysql.Pool;
    query: (sql: string, params?: any[]) => Promise<any>;
    close: () => Promise<void>;
}

// Create database configuration
const config: DatabaseConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'unknown',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool: mysql.Pool = mysql.createPool(config);

// Promisify the pool query method with proper typing
const query = (sql: string, params?: any[]): Promise<any> => {
    return new Promise((resolve, reject) => {
        pool.query(sql, params, (error: mysql.MysqlError | null, results: any) => {
            if (error) {
                LogManager.error('Database Error', error);
                return reject(error);
            }
            resolve(results);
        });
    });
};

// Close database connection pool
const close = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        pool.end((err?: mysql.MysqlError) => {
            if (err) {
                LogManager.error('Error closing database pool', err);
                return reject(err);
            }
            LogManager.info('Database connection pool closed');
            resolve();
        });
    });
};

// Export database connection object
const db: DatabaseConnection = {
    pool,
    query,
    close
};

export = db;