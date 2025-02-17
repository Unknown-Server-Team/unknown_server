const chalk = require('chalk');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const Table = require('cli-table3');
const figures = require('figures');
const moment = require('moment');
const figlet = require('figlet');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// unknown brand colors using chalk
const unknownColors = {
    primary: chalk.hex('#FF4B91'),
    secondary: chalk.hex('#FFB3B3'),
    success: chalk.hex('#59CE8F'),
    error: chalk.hex('#FF1E1E'),
    warning: chalk.hex('#F7D060'),
    info: chalk.hex('#4B56D2')
};

class LogManager {
    constructor() {
        if (!LogManager.instance) {
            LogManager.instance = this;
            this.initLogger();
        }
        return LogManager.instance;
    }

    initLogger() {
        const logFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const color = level === 'error' ? unknownColors.error :
                         level === 'warn' ? unknownColors.warning :
                         level === 'info' ? unknownColors.info :
                         level === 'debug' ? unknownColors.secondary :
                         unknownColors.primary;

            const symbol = level === 'error' ? figures.cross :
                          level === 'warn' ? figures.warning :
                          level === 'info' ? figures.info :
                          level === 'debug' ? figures.pointer :
                          figures.play;

            let output = `${chalk.gray(moment(timestamp).format('YYYY-MM-DD HH:mm:ss'))} `;
            output += color(`${symbol} [${level.toUpperCase()}] ${message}`);

            if (Object.keys(meta).length > 0) {
                const table = new Table({
                    chars: {
                        'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
                        'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
                        'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
                        'right': '│', 'right-mid': '┤', 'middle': '│'
                    },
                    style: { 'padding-left': 1, 'padding-right': 1 }
                });

                for (const [key, value] of Object.entries(meta)) {
                    if (key !== 'splat') {
                        table.push([unknownColors.info(key), typeof value === 'object' ? 
                            JSON.stringify(value, null, 2) : value.toString()]);
                    }
                }
                output += '\n' + table.toString();
            }
            return output;
        });

        this.logger = winston.createLogger({
            level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] })
            ),
            transports: [
                new winston.transports.Console({
                    format: logFormat
                }),
                new DailyRotateFile({
                    dirname: LOG_DIR,
                    filename: 'application-%DATE%.log',
                    datePattern: 'YYYY-MM-DD',
                    maxFiles: '14d',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.json()
                    )
                }),
                new DailyRotateFile({
                    dirname: LOG_DIR,
                    filename: 'error-%DATE%.log',
                    datePattern: 'YYYY-MM-DD',
                    level: 'error',
                    maxFiles: '14d',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.json()
                    )
                })
            ]
        });
    }

    static getInstance() {
        if (!LogManager.instance) {
            LogManager.instance = new LogManager();
        }
        return LogManager.instance;
    }

    static info(message, meta = {}) {
        LogManager.getInstance().logger.info(message, meta);
    }

    static error(message, error = null) {
        const meta = error ? { error: { message: error.message, stack: error.stack } } : {};
        LogManager.getInstance().logger.error(message, meta);
    }

    static warning(message, meta = {}) {
        LogManager.getInstance().logger.warn(message, meta);
    }

    static success(message, meta = {}) {
        LogManager.getInstance().logger.info(unknownColors.success(`${figures.tick} ${message}`), meta);
    }

    static debug(message, meta = {}) {
        if (process.env.NODE_ENV !== 'production') {
            LogManager.getInstance().logger.debug(message, meta);
        }
    }

    static figlet(text) {
        return new Promise((resolve, reject) => {
            figlet(text, { 
                font: 'Big',
                horizontalLayout: 'default',
                verticalLayout: 'default'
            }, (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(data);
            });
        });
    }

    static requestLogger() {
        return (req, res, next) => {
            if (req.path.startsWith("/health")) return next();
            const start = process.hrtime();
            const requestId = Math.random().toString(36).substring(7);

            LogManager.info(`→ ${req.method} ${req.path}`, {
                method: req.method,
                path: req.path,
                ip: req.ip,
                'request-id': requestId
            });

            res.on('finish', () => {
                const diff = process.hrtime(start);
                const duration = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
                const status = res.statusCode;

                // Colored output for console only
                const statusColor = status >= 500 ? unknownColors.error :
                            status >= 400 ? unknownColors.warning :
                            status >= 300 ? unknownColors.info :
                            unknownColors.success;

                LogManager.info(`← ${req.method} ${req.path}`, {
                    status: status,
                    duration: `${duration}ms`,
                    'request-id': requestId
                });

                if (process.env.NODE_ENV === 'development') {
                    console.log(statusColor(`${status} ${req.method} ${req.path} - ${duration}ms`));
                }
            });

            next();
        };
    }
}

module.exports = LogManager;