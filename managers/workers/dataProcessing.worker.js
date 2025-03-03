/**
 * Data Processing Worker Thread
 * 
 * This worker thread handles CPU-intensive data processing operations
 * such as data transformation, validation, and complex calculations.
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
        workerLog('info', `Data processing worker: Starting task ${taskId}`);
        
        let result;
        
        // Process different types of data tasks
        switch (options.operation) {
            case 'validateData':
                result = await validateData(data, options);
                break;
                
            case 'transformData':
                result = await transformData(data, options);
                break;
                
            case 'calculateStatistics':
                result = await calculateStatistics(data, options);
                break;
                
            case 'processUserData':
                result = await processUserData(data, options);
                break;
                
            default:
                throw new Error(`Unknown operation: ${options.operation}`);
        }
        
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
 * Process user data operations
 * @param {Object} data - The user data to process
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - The processing result
 */
async function processUserData(data, options = {}) {
    const { action } = options;
    
    switch (action) {
        case 'anonymize':
            return anonymizeUserData(data);
            
        case 'validate':
            return validateUserData(data);
            
        case 'generateSecureFields':
            return generateSecureFields(data);
            
        default:
            throw new Error(`Unknown user data action: ${action}`);
    }
}

/**
 * Anonymize user data by masking PII
 * @param {Object} userData - The user data to anonymize
 * @returns {Object} - Anonymized user data
 */
function anonymizeUserData(userData) {
    const result = { ...userData };
    
    // Mask email
    if (result.email) {
        const [username, domain] = result.email.split('@');
        result.email = `${username.substring(0, 2)}${'*'.repeat(username.length - 2)}@${domain}`;
    }
    
    // Mask name
    if (result.name) {
        const nameParts = result.name.split(' ');
        result.name = nameParts.map(part => 
            `${part.charAt(0)}${'*'.repeat(part.length - 1)}`
        ).join(' ');
    }
    
    // Remove sensitive fields
    delete result.password;
    delete result.password_reset_token;
    delete result.email_verification_token;
    
    return {
        processed: true,
        operation: 'anonymize',
        data: result
    };
}

/**
 * Validate user data against schema rules
 * @param {Object} userData - The user data to validate
 * @returns {Object} - Validation results
 */
function validateUserData(userData) {
    const errors = [];
    
    // Email validation
    if (userData.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
            errors.push('Invalid email format');
        }
    } else {
        errors.push('Email is required');
    }
    
    // Password validation
    if (userData.password) {
        if (userData.password.length < 8) {
            errors.push('Password must be at least 8 characters long');
        }
        if (!/[A-Z]/.test(userData.password)) {
            errors.push('Password must contain at least one uppercase letter');
        }
        if (!/[a-z]/.test(userData.password)) {
            errors.push('Password must contain at least one lowercase letter');
        }
        if (!/\d/.test(userData.password)) {
            errors.push('Password must contain at least one number');
        }
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(userData.password)) {
            errors.push('Password must contain at least one special character');
        }
    } else {
        errors.push('Password is required');
    }
    
    // Name validation
    if (userData.name) {
        if (userData.name.length < 2) {
            errors.push('Name must be at least 2 characters long');
        }
        if (/[0-9]/.test(userData.name)) {
            errors.push('Name should not contain numbers');
        }
    } else {
        errors.push('Name is required');
    }
    
    return {
        processed: true,
        operation: 'validate',
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Generate secure fields for user data
 * @param {Object} userData - The user data
 * @returns {Object} - User data with secure fields
 */
function generateSecureFields(userData) {
    // Generate API key if requested
    let apiKey = null;
    if (userData.generateApiKey) {
        apiKey = crypto.randomBytes(16).toString('hex');
    }
    
    // Generate recovery codes
    const recoveryCodes = [];
    const codeCount = 8;
    for (let i = 0; i < codeCount; i++) {
        recoveryCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    
    return {
        processed: true,
        operation: 'generateSecureFields',
        user: {
            ...userData,
            apiKey,
            recoveryCodes,
            secureFieldsGeneratedAt: new Date().toISOString()
        }
    };
}

/**
 * Validate data against schema
 * @param {any} data - The data to validate
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} - Validation results
 */
async function validateData(data, options = {}) {
    const { schema } = options;
    
    if (!schema) {
        throw new Error('Validation schema is required');
    }
    
    // Implement schema validation logic
    // This is a simplified example
    const errors = [];
    
    // Process each field in the schema
    Object.entries(schema).forEach(([field, rules]) => {
        const value = data[field];
        
        // Required check
        if (rules.required && (value === undefined || value === null || value === '')) {
            errors.push(`Field '${field}' is required`);
            return;
        }
        
        // Type check
        if (value !== undefined && value !== null && rules.type) {
            const actualType = Array.isArray(value) ? 'array' : typeof value;
            
            if (actualType !== rules.type && !(rules.type === 'array' && Array.isArray(value))) {
                errors.push(`Field '${field}' must be of type ${rules.type}, but got ${actualType}`);
            }
        }
        
        // Min/max for strings and arrays
        if ((typeof value === 'string' || Array.isArray(value)) && value !== undefined && value !== null) {
            if (rules.minLength !== undefined && value.length < rules.minLength) {
                errors.push(`Field '${field}' must have at least ${rules.minLength} ${typeof value === 'string' ? 'characters' : 'items'}`);
            }
            
            if (rules.maxLength !== undefined && value.length > rules.maxLength) {
                errors.push(`Field '${field}' must have at most ${rules.maxLength} ${typeof value === 'string' ? 'characters' : 'items'}`);
            }
        }
        
        // Min/max for numbers
        if (typeof value === 'number') {
            if (rules.min !== undefined && value < rules.min) {
                errors.push(`Field '${field}' must be at least ${rules.min}`);
            }
            
            if (rules.max !== undefined && value > rules.max) {
                errors.push(`Field '${field}' must be at most ${rules.max}`);
            }
        }
        
        // Pattern matching
        if (typeof value === 'string' && rules.pattern) {
            const regex = new RegExp(rules.pattern);
            if (!regex.test(value)) {
                errors.push(`Field '${field}' does not match required pattern`);
            }
        }
    });
    
    return {
        processed: true,
        operation: 'validateData',
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Transform data based on transformation rules
 * @param {any} data - The data to transform
 * @param {Object} options - Transformation options
 * @returns {Promise<Object>} - Transformed data
 */
async function transformData(data, options = {}) {
    const { transformations } = options;
    
    if (!transformations || !Array.isArray(transformations)) {
        throw new Error('Transformation rules are required as an array');
    }
    
    let result = { ...data };
    
    // Apply each transformation in sequence
    for (const transform of transformations) {
        switch (transform.type) {
            case 'rename':
                if (result[transform.from] !== undefined) {
                    result[transform.to] = result[transform.from];
                    delete result[transform.from];
                }
                break;
                
            case 'remove':
                delete result[transform.field];
                break;
                
            case 'format':
                if (result[transform.field] !== undefined) {
                    if (transform.format === 'uppercase') {
                        result[transform.field] = result[transform.field].toString().toUpperCase();
                    } else if (transform.format === 'lowercase') {
                        result[transform.field] = result[transform.field].toString().toLowerCase();
                    } else if (transform.format === 'date' && transform.dateFormat) {
                        // Simple date formatting - would use moment.js in a real implementation
                        const date = new Date(result[transform.field]);
                        result[transform.field] = date.toISOString();
                    }
                }
                break;
                
            case 'compute':
                if (transform.formula && transform.target) {
                    // This is a simplified formula evaluator
                    // In a real implementation, you would use a proper formula parser
                    try {
                        // Using Function constructor is not safe for production
                        // This is for demonstration only
                        const formula = transform.formula.replace(/\$\{([^}]+)\}/g, (match, field) => {
                            return result[field] !== undefined ? result[field] : 0;
                        });
                        
                        // eslint-disable-next-line no-new-func
                        result[transform.target] = new Function(`return ${formula}`)();
                    } catch (error) {
                        console.error(`Error evaluating formula: ${transform.formula}`, error);
                    }
                }
                break;
        }
    }
    
    return {
        processed: true,
        operation: 'transformData',
        data: result
    };
}

/**
 * Calculate statistics on data
 * @param {Array|Object} data - The data to analyze
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} - Statistics results
 */
async function calculateStatistics(data, options = {}) {
    const { metrics = ['count', 'sum', 'avg', 'min', 'max'] } = options;
    const { fields } = options;
    const results = {};
    
    // If data is an array of objects
    if (Array.isArray(data)) {
        // If no fields specified, auto-detect numeric fields
        const fieldsToAnalyze = fields || Object.keys(data[0] || {}).filter(key => 
            typeof data[0][key] === 'number'
        );
        
        // Calculate statistics for each field
        fieldsToAnalyze.forEach(field => {
            const values = data.map(item => item[field]).filter(v => typeof v === 'number');
            
            const fieldStats = {};
            
            if (metrics.includes('count')) {
                fieldStats.count = values.length;
            }
            
            if (metrics.includes('sum')) {
                fieldStats.sum = values.reduce((sum, val) => sum + val, 0);
            }
            
            if (metrics.includes('avg')) {
                fieldStats.avg = values.length > 0 ? 
                    values.reduce((sum, val) => sum + val, 0) / values.length : 0;
            }
            
            if (metrics.includes('min')) {
                fieldStats.min = values.length > 0 ? 
                    Math.min(...values) : null;
            }
            
            if (metrics.includes('max')) {
                fieldStats.max = values.length > 0 ? 
                    Math.max(...values) : null;
            }
            
            results[field] = fieldStats;
        });
    } else if (typeof data === 'object') {
        // If it's a single object, just return its properties
        const fieldsToAnalyze = fields || Object.keys(data).filter(key => 
            typeof data[key] === 'number'
        );
        
        fieldsToAnalyze.forEach(field => {
            results[field] = { value: data[field] };
        });
    }
    
    return {
        processed: true,
        operation: 'calculateStatistics',
        statistics: results
    };
}

// Start task execution
executeTask();