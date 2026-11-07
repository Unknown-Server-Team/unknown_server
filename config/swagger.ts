import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import type { SwaggerSpec } from '../types/documentation';
import { APP_VERSION } from './version';

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Unknown Server API Documentation',
            version: APP_VERSION,
            description: 'Complete API documentation for all versions',
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            {
                url: process.env.API_URL || 'http://localhost:3000',
                description: 'Development Server'
            }
        ],
        tags: [
            {
                name: 'System',
                description: 'System health and monitoring endpoints'
            },
            {
                name: 'Authentication',
                description: 'Authentication and user management'
            },
            {
                name: 'Authorization',
                description: 'Role and permission management'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                },
                sessionAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'sessionId'
                }
            }
        },
        security: [
            { bearerAuth: [] },
            { sessionAuth: [] }
        ]
    },
    apis: [path.join(process.cwd(), 'config/openapi/*.yaml')]
};

const specs = swaggerJsdoc(options) as SwaggerSpec;

export const swaggerCustomCss = `
    .swagger-ui {
        background-color: #1a1a1a;
        color: #ffffff;
    }
    .swagger-ui .info .title,
    .swagger-ui .info .description,
    .swagger-ui .scheme-container,
    .swagger-ui table thead tr th,
    .swagger-ui .parameters-col_name {
        color: #ffffff;
    }
    .swagger-ui .opblock {
        background: #2d2d2d;
        border-color: #404040;
    }
    .swagger-ui .opblock .opblock-summary-method {
        background: #4a4a4a;
    }
    .swagger-ui .opblock .opblock-summary-description,
    .swagger-ui .parameter__name,
    .swagger-ui .parameter__type,
    .swagger-ui table.model tr td {
        color: #cccccc;
    }
    .swagger-ui .tab li {
        color: #ffffff;
    }
    .swagger-ui input[type=text],
    .swagger-ui textarea {
        background-color: #333333;
        color: #ffffff;
    }
    .swagger-ui .topbar {
        background-color: #2d2d2d;
    }
    .swagger-ui .model-box {
        background-color: #2d2d2d;
    }
    .swagger-ui section.models {
        background: #2d2d2d;
    }
    .swagger-ui .response-col_status {
        color: #ffffff;
    }
    .swagger-ui .responses-inner h4,
    .swagger-ui .responses-inner h5 {
        color: #ffffff;
    }
    .swagger-ui .opblock-tag {
        color: #ffffff;
        border-color: #404040;
    }
`;

export default specs;