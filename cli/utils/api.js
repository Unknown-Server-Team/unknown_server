const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const os = require('os');

class API {
    constructor() {
        this.configFile = path.join(os.homedir(), '.unknown-cli.json');
        this.loadConfig();
    }

    loadConfig() {
        const defaultUrl = process.env.API_URL || 'http://localhost:3000';
        this.baseUrl = API.normalizeBaseUrl(defaultUrl);
        this.token = null;

        try {
            if (fs.existsSync(this.configFile)) {
                const config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
                this.baseUrl = API.normalizeBaseUrl(config.apiUrl || defaultUrl);
                this.token = config.token || null;
            }
        } catch (error) {
            console.error('Failed to load config:', error.message);
        }
    }

    static normalizeBaseUrl(url) {
        const trimmed = url.replace(/\/+$/, '').replace(/\/v\d+$/, '');
        return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
    }

    static formatDetails(details) {
        if (Array.isArray(details)) {
            return details.join('\n');
        }
        if (typeof details !== 'object') {
            return String(details);
        }
        return Object.entries(details)
            .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`)
            .join('\n');
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configFile, JSON.stringify({
                apiUrl: this.baseUrl,
                token: this.token
            }, null, 2));
        } catch (error) {
            console.error('Failed to save config:', error.message);
        }
    }

    setToken(token) {
        this.token = token;
        this.saveConfig();
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Version': 'v1'
        };

        if (process.env.CLI_API_KEY) {
            headers['x-cli-api-key'] = process.env.CLI_API_KEY;
        }

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...headers,
                    ...options.headers
                }
            });

            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (parseError) {
                throw new Error(`Unexpected non-JSON response (HTTP ${response.status}) from ${url}`);
            }

            if (!response.ok) {
                if (response.status === 400 && data.details) {
                    throw new Error(API.formatDetails(data.details));
                }
                throw new Error(data.error || data.message || 'Request failed');
            }

            return data;
        } catch (error) {
            if (error.message.includes('fetch')) {
                throw new Error(`Connection failed: ${error.message}`);
            }
            throw error;
        }
    }

    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }

    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}

module.exports = new API();