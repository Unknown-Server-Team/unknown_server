const mysql = require('mysql');
const LogManager = require('../managers/LogManager');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'unknown',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Promisify the pool query method
const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        pool.query(sql, params, (error, results) => {
            if (error) {
                LogManager.error('Database Error', error);
                return reject(error);
            }
            resolve(results);
        });
    });
};

module.exports = {
    pool,
    query,
    async close() {
        return new Promise((resolve, reject) => {
            pool.end(err => {
                if (err) {
                    LogManager.error('Error closing database pool', err);
                    return reject(err);
                }
                LogManager.info('Database connection pool closed');
                resolve();
            });
        });
    }
};