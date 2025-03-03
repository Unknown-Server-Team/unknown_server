/**
 * Generic Worker Thread Implementation
 * 
 * This is a template worker thread that handles communication with the main thread
 * and provides a basic structure for task execution. Specific worker implementations
 * can extend this pattern.
 */

const { workerData, parentPort } = require('worker_threads');

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
        workerLog('info', `Starting task ${taskId}`);
        
        // Execute the task (this would be replaced with actual task logic in specific workers)
        const result = await processData(data, options);
        
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
 * Generic data processing function - to be overridden in specific worker implementations
 * @param {any} data - The data to process
 * @param {Object} options - Processing options
 * @returns {Promise<any>} - The processed result
 */
async function processData(data, options) {
    // This is a placeholder - specific workers would implement their own logic here
    return {
        processed: true,
        originalData: data,
        appliedOptions: options,
        timestamp: new Date().toISOString(),
        workerId: process.pid
    };
}

// Start task execution
executeTask();