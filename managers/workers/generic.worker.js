const { workerData, parentPort } = require('worker_threads');

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
        workerLog('info', `Starting task ${taskId}`);

        const result = await processData(data, options);

        if (parentPort) {
            parentPort.postMessage({ result });
        }
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        workerLog('error', `Error executing task ${taskId}`, {
            error: err.message,
            stack: err.stack
        });

        if (parentPort) {
            parentPort.postMessage({ error: err.message });
        }
    }
}

async function processData(inputData, inputOptions) {
    return {
        processed: true,
        originalData: inputData,
        appliedOptions: inputOptions,
        timestamp: new Date().toISOString(),
        workerId: process.pid
    };
}

executeTask();