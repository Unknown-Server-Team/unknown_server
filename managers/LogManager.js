const chalk = require('chalk');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const Table = require('cli-table3');
const figures = require('figures');
const figlet = require('figlet');
const dayjs = require('dayjs');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// unknown brand colors using chalk
const unknownColors = {
    debug: chalk.hex('#FFB3B3'),
    success: chalk.hex('#59CE8F'),
    error: chalk.hex('#FF1E1E'),
    warn: chalk.hex('#F7D060'),
    info: chalk.hex('#4B56D2'),
    default: chalk.hex('#FF4B91')
};

const levelSymbols = {
    error: figures.cross,
    warn: figures.warning,
    info: figures.info,
    debug: figures.pointer,
    default: figures.play
}

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
            const color = unknownColors[level] || unknownColors.default

            const symbol = levelSymbols[level] || levelSymbols.default

            let output = `${chalk.gray(dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'))} `;
            output += color(`${symbol} [${level.toUpperCase()}] ${message}`);

            if (Object.keys(meta.metadata).length > 0) {
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

    info(message, meta = {}) {
        this.logger.info(message, meta)
    }

    error(message, error = null) {
        const meta = error ? { error: { message: error.message, stack: error.stack } } : {};
        this.logger.error(message, meta)
    }

    warning(message, meta = {}) {
        this.logger.warn(message, meta)
    }

    success(message, meta = {}) {
        this.logger.info(unknownColors.success(`${figures.tick} ${message}`), meta)
    }

    debug(message, meta = {}) {
        if (process.env.NODE_ENV !== 'production') {
            this.logger.debug(message, meta)
        }
    }

    figlet(text) {
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

    requestLogger() {
        return (req, res, next) => {
            if (req.path.startsWith("/health")) return next();
            const start = process.hrtime();
            const requestId = Math.random().toString(36).substring(7);

            this.info(`→ ${req.method} ${req.path}`, {
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
                            status >= 400 ? unknownColors.warn :
                            status >= 300 ? unknownColors.info :
                            unknownColors.success;

                this.info(`← ${req.method} ${req.path}`, {
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

const logManagerInstance = new LogManager();
Object.freeze(logManagerInstance);

module.exports = logManagerInstance;