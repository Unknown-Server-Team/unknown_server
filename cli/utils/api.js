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
        try {
            if (fs.existsSync(this.configFile)) {
                const config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
                this.baseUrl = config.apiUrl || 'http://localhost:3000/api';
                this.token = config.token;
            } else {
                this.baseUrl = 'http://localhost:3000/api/v1';
                this.token = null;
            }
        } catch (error) {
            console.error('Failed to load config:', error.message);
            this.baseUrl = `http://localhost:3000/api/v1`;
            this.token = null;
        }
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
            'Accept-Version': 'v1',
            'x-cli-api-key': process.env.CLI_API_KEY
        };

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

            const data = await response.json();

            if (!response.ok) {
                // Enhanced error handling with validation errors
                if (response.status === 400 && data.details) {
                    const errorMessage = Object.entries(data.details)
                        .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
                        .join('\n');
                    throw new Error(errorMessage);
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