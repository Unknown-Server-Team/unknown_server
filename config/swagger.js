const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Unknown Server API Documentation',
            version: '2.0.0',
            description: 'API documentation for Unknown Server',
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT',
            },
            contact: {
                name: 'API Support',
                url: 'https://github.com/yourusername/unknown-server',
            },
        },
        servers: [
            {
                url: process.env.API_URL || 'http://localhost:3000',
                description: 'Development Server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
                sessionAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'sessionId',
                },
            },
        },
        security: [
            { bearerAuth: [] },
            { sessionAuth: [] },
        ],
    },
    apis: [
        './routers/api/*.js',
        './routers/main/*.js',
        './managers/*.js',
    ],
};

const specs = swaggerJsdoc(options);

module.exports = specs;