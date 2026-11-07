const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');

const { taskId, data, options } = workerData || {};

function workerLog(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    
    const logEntry = {
        timestamp,
        level,
        message: `[Worker ${pid}] ${message}`,
        ...meta
    };
    
    console.log(JSON.stringify(logEntry));
}

async function executeTask() {
    try {
        workerLog('info', `Encryption worker: Starting task ${taskId}`);
        
        const result = await processEncryption(data, options);
        
        parentPort.postMessage({ result });
        
    } catch (error) {
        workerLog('error', `Error executing task ${taskId}`, { 
            error: error.message,
            stack: error.stack
        });
        parentPort.postMessage({ 
            error: error.message,
            stack: error.stack
        });
    }
}

async function processEncryption(data, options = {}) {
    const { operation = 'encrypt', algorithm = 'aes-256-cbc' } = options;
    
    if (!data.text) {
        throw new Error('Missing text to process');
    }
    
    if (!data.key) {
        throw new Error('Missing encryption key');
    }
    
    if (operation === 'encrypt') {
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(
            algorithm, 
            Buffer.from(data.key.padEnd(32).slice(0, 32)), 
            iv
        );
        
        let encrypted = cipher.update(data.text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return {
            processed: true,
            operation: 'encrypt',
            result: encrypted,
            iv: iv.toString('hex'),
            algorithm
        };
        
    } else if (operation === 'decrypt') {
        if (!data.iv) {
            throw new Error('Missing initialization vector (iv) for decryption');
        }
        
        const decipher = crypto.createDecipheriv(
            algorithm, 
            Buffer.from(data.key.padEnd(32).slice(0, 32)), 
            Buffer.from(data.iv, 'hex')
        );
        
        let decrypted = decipher.update(data.text, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return {
            processed: true,
            operation: 'decrypt',
            result: decrypted,
            algorithm
        };
    } else {
        throw new Error(`Unsupported operation: ${operation}`);
    }
}

executeTask();