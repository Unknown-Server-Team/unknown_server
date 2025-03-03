/**
 * Encryption Worker Thread Implementation
 * 
 * This worker thread handles CPU-intensive encryption/decryption operations
 * to prevent blocking the main event loop.
 */

const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');

// Extract task information from worker data
const { taskId, data, options } = workerData || {};

/**
 * Simplified logger for worker threads
 * @param {string} level - Log level (info, error, warning)
 * @param {string} message - Log message
 */
function workerLog(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    
    // Format the log entry
    const logEntry = {
        timestamp,
        level,
        message: `[Worker ${pid}] ${message}`,
        ...meta
    };
    
    console.log(JSON.stringify(logEntry));
}

// Main worker execution function
async function executeTask() {
    try {
        // Log the start of processing
        workerLog('info', `Encryption worker: Starting task ${taskId}`);
        
        // Execute the encryption/decryption task
        const result = await processEncryption(data, options);
        
        // Send the result back to the main thread
        parentPort.postMessage({ result });
        
    } catch (error) {
        // Handle and report any errors
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

/**
 * Process encryption/decryption tasks
 * @param {Object} data - The data to encrypt/decrypt
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - The encryption/decryption result
 */
async function processEncryption(data, options = {}) {
    const { operation = 'encrypt', algorithm = 'aes-256-cbc' } = options;
    
    // Validate required data
    if (!data.text) {
        throw new Error('Missing text to process');
    }
    
    if (!data.key) {
        throw new Error('Missing encryption key');
    }
    
    // Simulate CPU-intensive work with appropriate encryption/decryption
    if (operation === 'encrypt') {
        // Create initialization vector
        const iv = crypto.randomBytes(16);
        
        // Create cipher
        const cipher = crypto.createCipheriv(
            algorithm, 
            Buffer.from(data.key.padEnd(32).slice(0, 32)), 
            iv
        );
        
        // Encrypt data
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
        
        // Create decipher
        const decipher = crypto.createDecipheriv(
            algorithm, 
            Buffer.from(data.key.padEnd(32).slice(0, 32)), 
            Buffer.from(data.iv, 'hex')
        );
        
        // Decrypt data
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

// Start task execution
executeTask();