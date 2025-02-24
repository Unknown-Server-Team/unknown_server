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
            'Accept-Version': 'v1'
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            console.log(`Making request to ${url} with options:`, options);
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...headers,
                    ...options.headers
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            throw new Error(`API request failed: ${error.message}`);
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