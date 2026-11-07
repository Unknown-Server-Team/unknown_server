const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');
const math = require('mathjs');

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
        workerLog('info', `Data processing worker: Starting task ${taskId}`);
        
        let result;
        
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

function anonymizeUserData(userData) {
    const result = { ...userData };
    
    if (result.email) {
        const [username, domain] = result.email.split('@');
        result.email = `${username.substring(0, 2)}${'*'.repeat(username.length - 2)}@${domain}`;
    }
    
    if (result.name) {
        const nameParts = result.name.split(' ');
        result.name = nameParts.map(part => 
            `${part.charAt(0)}${'*'.repeat(part.length - 1)}`
        ).join(' ');
    }
    
    delete result.password;
    delete result.password_reset_token;
    delete result.email_verification_token;
    
    return {
        processed: true,
        operation: 'anonymize',
        data: result
    };
}

function validateUserData(userData) {
    const errors = [];
    
    if (userData.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
            errors.push('Invalid email format');
        }
    } else {
        errors.push('Email is required');
    }
    
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

function generateSecureFields(userData) {
    let apiKey = null;
    if (userData.generateApiKey) {
        apiKey = crypto.randomBytes(16).toString('hex');
    }
    
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

async function validateData(data, options = {}) {
    const { schema } = options;
    
    if (!schema) {
        throw new Error('Validation schema is required');
    }
    
    const errors = [];
    
    Object.entries(schema).forEach(([field, rules]) => {
        const value = data[field];
        
        if (rules.required && (value === undefined || value === null || value === '')) {
            errors.push(`Field '${field}' is required`);
            return;
        }
        
        if (value !== undefined && value !== null && rules.type) {
            const actualType = Array.isArray(value) ? 'array' : typeof value;
            
            if (actualType !== rules.type && !(rules.type === 'array' && Array.isArray(value))) {
                errors.push(`Field '${field}' must be of type ${rules.type}, but got ${actualType}`);
            }
        }
        
        if ((typeof value === 'string' || Array.isArray(value)) && value !== undefined && value !== null) {
            if (rules.minLength !== undefined && value.length < rules.minLength) {
                errors.push(`Field '${field}' must have at least ${rules.minLength} ${typeof value === 'string' ? 'characters' : 'items'}`);
            }
            
            if (rules.maxLength !== undefined && value.length > rules.maxLength) {
                errors.push(`Field '${field}' must have at most ${rules.maxLength} ${typeof value === 'string' ? 'characters' : 'items'}`);
            }
        }
        
        if (typeof value === 'number') {
            if (rules.min !== undefined && value < rules.min) {
                errors.push(`Field '${field}' must be at least ${rules.min}`);
            }
            
            if (rules.max !== undefined && value > rules.max) {
                errors.push(`Field '${field}' must be at most ${rules.max}`);
            }
        }
        
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

async function transformData(data, options = {}) {
    const { transformations } = options;
    
    if (!transformations || !Array.isArray(transformations)) {
        throw new Error('Transformation rules are required as an array');
    }
    
    let result = { ...data };
    
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
                        const date = new Date(result[transform.field]);
                        result[transform.field] = date.toISOString();
                    }
                }
                break;
                
            case 'compute':
                if (transform.formula && transform.target) {
                    try {
                        const scope = {};
                        
                        Object.entries(result).forEach(([key, value]) => {
                            if (typeof value === 'number' || !isNaN(Number(value))) {
                                scope[key] = typeof value === 'number' ? value : Number(value);
                            } else {
                                scope[key] = 0;
                            }
                        });
                        
                        const parsedFormula = transform.formula.replace(/\$\{([^}]+)\}/g, (match, field) => {
                            return field;
                        });
                        
                        result[transform.target] = math.evaluate(parsedFormula, scope);
                        
                        workerLog('info', `Computed field '${transform.target}' using formula: ${transform.formula}`);
                    } catch (error) {
                        workerLog('error', `Error evaluating formula: ${transform.formula}`, { error: error.message });
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

async function calculateStatistics(data, options = {}) {
    const { metrics = ['count', 'sum', 'avg', 'min', 'max'] } = options;
    const { fields } = options;
    const results = {};
    
    if (Array.isArray(data)) {
        const fieldsToAnalyze = fields || Object.keys(data[0] || {}).filter(key => 
            typeof data[0][key] === 'number'
        );
        
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

executeTask();