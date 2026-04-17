import { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import dayjs from 'dayjs';
import figlet from 'figlet';
import Table from 'cli-table3';
import chalk from 'chalk';
import figures from 'figures';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import type { LogMetadata, LogInfo } from '../types/index';

const LOG_DIR = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const unknownColors = {
    debug: chalk.hex('#FFB3B3'),
    success: chalk.hex('#59CE8F'),
    error: chalk.hex('#FF1E1E'),
    warn: chalk.hex('#F7D060'),
    info: chalk.hex('#4B56D2'),
    default: chalk.hex('#FF4B91')
} as const;

const levelSymbols = {
    error: figures.cross,
    warn: figures.warning,
    info: figures.info,
    debug: figures.pointer,
    default: figures.play
} as const;

interface ErrorMetadata {
    error: {
        message: string;
        stack: string | undefined;
    };
}

class LogManager {
    private static instance: LogManager;
    private logger!: winston.Logger;

    constructor() {
        if (!LogManager.instance) {
            LogManager.instance = this;
            this.logger = this.initLogger();
        }
        return LogManager.instance;
    }

    private initLogger(): winston.Logger {
        const logFormat = winston.format.printf((info: any) => {
            const { level, message, timestamp, ...meta } = info as LogInfo;
            const color = unknownColors[level as keyof typeof unknownColors] || unknownColors.default;
            const symbol = levelSymbols[level as keyof typeof levelSymbols] || levelSymbols.default;

            let output = `${chalk.gray(dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'))} `;
            output += color(`${symbol} [${level.toUpperCase()}] ${message}`);

            const metadata = meta.metadata || {};

            if (Object.keys(metadata).length > 0) {
                const table = new Table({
                    chars: {
                        top: '─',
                        'top-mid': '┬',
                        'top-left': '┌',
                        'top-right': '┐',
                        bottom: '─',
                        'bottom-mid': '┴',
                        'bottom-left': '└',
                        'bottom-right': '┘',
                        left: '│',
                        'left-mid': '├',
                        mid: '─',
                        'mid-mid': '┼',
                        right: '│',
                        'right-mid': '┤',
                        middle: '│'
                    },
                    style: { 'padding-left': 1, 'padding-right': 1 }
                });

                for (const [key, value] of Object.entries(meta)) {
                    if (key !== 'splat') {
                        table.push([unknownColors.info(key), typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)]);
                    }
                }
                output += `\n${table.toString()}`;
            }
            return output;
        });

        return winston.createLogger({
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

    info(message: string, meta: LogMetadata = {}): void {
        this.logger.info(message, meta);
    }

    error(message: string, error: Error | null = null): void {
        const meta: ErrorMetadata | Record<string, never> = error ? { error: { message: error.message, stack: error.stack } } : {};
        this.logger.error(message, meta);
    }

    warning(message: string, meta: LogMetadata = {}): void {
        this.logger.warn(message, meta);
    }

    success(message: string, meta: LogMetadata = {}): void {
        this.logger.info(unknownColors.success(`${figures.tick} ${message}`), meta);
    }

    debug(message: string, meta: LogMetadata = {}): void {
        if (process.env.NODE_ENV !== 'production') {
            this.logger.debug(message, meta);
        }
    }

    figlet(text: string): Promise<string> {
        return new Promise((resolve, reject) => {
            figlet(
                text,
                {
                    font: 'Big',
                    horizontalLayout: 'default',
                    verticalLayout: 'default'
                },
                (err: Error | null, data?: string) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(data as string);
                }
            );
        });
    }

    requestLogger(): (req: Request, res: Response, next: NextFunction) => void {
        return (req: Request, res: Response, next: NextFunction): void => {
            if (req.path.startsWith('/health')) {
                return next();
            }
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
                const statusColor = status >= 500 ? unknownColors.error : status >= 400 ? unknownColors.warn : status >= 300 ? unknownColors.info : unknownColors.success;

                this.info(`← ${req.method} ${req.path}`, {
                    status,
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

export = logManagerInstance;
