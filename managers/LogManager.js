const chalk = require('chalk');
const moment = require('moment');
const fs = require('fs');
const path = require('path');

class LogManager {
    static logLevel = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        SUCCESS: 4,
        SYSTEM: 5
    };

    static symbols = {
        DEBUG: '◈',
        INFO: '◉',
        WARN: '⚠',
        ERROR: '✖',
        SUCCESS: '✔',
        SYSTEM: '⚡'
    };

    static currentLevel = LogManager.logLevel.DEBUG;
    static logToFile = true;
    static logFolder = path.join(process.cwd(), 'logs');
    static logFile = path.join(LogManager.logFolder, `${moment().format('YYYY-MM-DD')}.log`);
    static lastTimestamp = '';

    static initialize() {
        if (LogManager.logToFile) {
            if (!fs.existsSync(LogManager.logFolder)) {
                fs.mkdirSync(LogManager.logFolder, { recursive: true });
            }
        }
        // Create header in log file
        this.writeLogHeader();
    }

    static writeLogHeader() {
        if (!LogManager.logToFile) return;
        const date = moment().format('YYYY-MM-DD');
        const header = [
            '╔════════════════════════════════════════════════════════════════════╗',
            '║                        Unknown Server Logs                          ║',
            `║                          Date: ${date}                           ║`,
            '╚════════════════════════════════════════════════════════════════════╝',
            ''
        ].join('\n');
        fs.writeFileSync(LogManager.logFile, header + '\n');
    }

    static createGradient(startColor, endColor, steps) {
        const start = {
            r: parseInt(startColor.slice(1, 3), 16),
            g: parseInt(startColor.slice(3, 5), 16),
            b: parseInt(startColor.slice(5, 7), 16)
        };
        const end = {
            r: parseInt(endColor.slice(1, 3), 16),
            g: parseInt(endColor.slice(3, 5), 16),
            b: parseInt(endColor.slice(5, 7), 16)
        };

        return Array.from({length: steps}, (_, i) => {
            const ratio = i / (steps - 1);
            const r = Math.round(start.r + (end.r - start.r) * ratio);
            const g = Math.round(start.g + (end.g - start.g) * ratio);
            const b = Math.round(start.b + (end.b - start.b) * ratio);
            return chalk.rgb(r, g, b);
        });
    }

    static writeToFile(message, type = 'INFO') {
        if (!LogManager.logToFile) return;
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss.SSS');
        const logMessage = `[${timestamp}] ${type.padEnd(7)} │ ${message}\n`;
        fs.appendFileSync(LogManager.logFile, logMessage);
    }

    static formatTimestamp() {
        const now = moment();
        return chalk.dim(now.format('HH:mm:ss.SSS'));
    }

    static log(type, message, color, error = null) {
        const timestamp = this.formatTimestamp();
        const symbol = this.symbols[type];
        const boxColor = chalk[color];
        const messageColor = type === 'ERROR' ? chalk.red : chalk.white;
        
        // Simple but elegant log format
        console.log(
            boxColor(`${symbol} `) +
            timestamp +
            boxColor(' │ ') +
            messageColor(message)
        );

        if (error && error.stack) {
            const stackLines = error.stack.split('\n');
            console.log(boxColor('   ┌─ Stack Trace:'));
            stackLines.forEach((line, i) => {
                console.log(boxColor('   │ '), chalk.dim(line.trim()));
            });
            console.log(boxColor('   └─────────────'));
        }

        this.writeToFile(message, type);
    }

    static debug(message) {
        if (LogManager.currentLevel <= LogManager.logLevel.DEBUG) {
            this.log('DEBUG', message, 'gray');
        }
    }

    static info(message) {
        if (LogManager.currentLevel <= LogManager.logLevel.INFO) {
            this.log('INFO', message, 'blue');
        }
    }

    static warn(message) {
        if (LogManager.currentLevel <= LogManager.logLevel.WARN) {
            this.log('WARN', message, 'yellow');
        }
    }

    static error(message, error = null) {
        if (LogManager.currentLevel <= LogManager.logLevel.ERROR) {
            this.log('ERROR', message, 'red', error);
        }
    }

    static success(message) {
        if (LogManager.currentLevel <= LogManager.logLevel.SUCCESS) {
            this.log('SUCCESS', message, 'green');
        }
    }

    static system(message) {
        if (LogManager.currentLevel <= LogManager.logLevel.SYSTEM) {
            this.log('SYSTEM', message, 'magenta');
        }
    }

    static generatePattern(width, height) {
        const pattern = [];
        for (let y = 0; y < height; y++) {
            let line = '';
            for (let x = 0; x < width; x++) {
                const distance = Math.sqrt(Math.pow(x - width/2, 2) + Math.pow(y - height/2, 2));
                const char = '·▪▫■□▢▣▤▥▦▧▨▩▪▫▬▭▮▯▰▱▲▼◄►◆◇○●◐◑◒◓◔◕';
                line += char[Math.floor(distance) % char.length];
            }
            pattern.push(line);
        }
        return pattern;
    }

    static generateAsciiText(text) {
        const font = {
            'U': [
                ' ██  ██ ',
                ' ██  ██ ',
                ' ██  ██ ',
                ' ██  ██ ',
                ' ██████ ',
                '        '
            ],
            'N': [
                ' ██████ ',
                ' ███ ██ ',
                ' ██ ███ ',
                ' ██  ██ ',
                ' ██  ██ ',
                '        '
            ],
            'K': [
                ' ██  ██ ',
                ' ██ ██  ',
                ' ████   ',
                ' ██ ██  ',
                ' ██  ██ ',
                '        '
            ],
            'O': [
                ' ██████ ',
                ' ██  ██ ',
                ' ██  ██ ',
                ' ██  ██ ',
                ' ██████ ',
                '        '
            ],
            'W': [
                ' ██  ██ ',
                ' ██  ██ ',
                ' ██  ██ ',
                ' ██████ ',
                '  ████  ',
                '        '
            ]
        };

        const lines = ['', '', '', '', '', ''];
        text.split('').forEach(char => {
            const letterArt = font[char] || font['?'];
            lines.forEach((_, i) => {
                lines[i] += letterArt[i] + ' ';
            });
        });
        return lines;
    }

    static ascii() {
        const gradientColors = this.createGradient('#9B4BFF', '#E84BFF', 6);
        
        // Create borders
        const width = 50;
        const topBorder = '╭' + '═'.repeat(width - 2) + '╮';
        const bottomBorder = '╰' + '═'.repeat(width - 2) + '╯';
        
        console.log('\n' + gradientColors[0](topBorder));
        
        // Generate and print ASCII art
        const asciiArt = this.generateAsciiText('UNKNOWN');
        asciiArt.forEach((line, i) => {
            const colorIndex = i % gradientColors.length;
            const paddedLine = line.padStart((width + line.length) / 2).padEnd(width);
            console.log(gradientColors[0]('│') + gradientColors[colorIndex](paddedLine) + gradientColors[0]('│'));
        });

        console.log(gradientColors[0](bottomBorder));
        
        // Print tagline
        const tagline = "✧ Modern Express Server Solution ✧";
        const centeredTagline = tagline.padStart((width + tagline.length) / 2).padEnd(width);
        console.log(gradientColors[3](centeredTagline) + '\n');

        this.writeToFile('Server ASCII Art displayed', 'SYSTEM');
    }

    static clearLogs(daysToKeep = 7) {
        const files = fs.readdirSync(LogManager.logFolder);
        const now = moment();
        let removed = 0;
        
        files.forEach(file => {
            const filePath = path.join(LogManager.logFolder, file);
            const fileDate = moment(file.split('.')[0], 'YYYY-MM-DD');
            
            if (now.diff(fileDate, 'days') > daysToKeep) {
                fs.unlinkSync(filePath);
                removed++;
            }
        });

        if (removed > 0) {
            this.system(`Cleaned up ${removed} old log files`);
        }
    }
}

// Initialize the log directory
LogManager.initialize();

module.exports = LogManager;