const mysql = require('mysql2');
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

const promisePool = pool.promise();

module.exports = {
    pool: promisePool,
    async query(sql, params) {
        try {
            const [rows] = await promisePool.execute(sql, params);
            return rows;
        } catch (error) {
            LogManager.error(`Database Error: ${error.message}`);
            throw error;
        }
    },
    async close() {
        try {
            await promisePool.end();
            LogManager.info('Database connection pool closed');
        } catch (error) {
            LogManager.error(`Error closing database pool: ${error.message}`);
            throw error;
        }
    }
};