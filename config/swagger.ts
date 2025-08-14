import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const DocumentationValidator = require('../managers/DocumentationValidator');
const VersionManager = require('../managers/VersionManager');
const LogManager = require('../managers/LogManager');

// Interface for swagger specifications
interface SwaggerSpecs {
    customCss?: string;
    [key: string]: any;
}

// Interface for validation result
interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

// Get the supported API versions
const supportedVersions: string[] = VersionManager.getSupportedVersions();

// Define the OpenAPI options directly here rather than using DocumentationValidator
const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Unknown Server API Documentation',
            version: process.env.VERSION || '1.0.0',
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
    // Search for API routes in all version folders
    apis: [
        // Include base API routes
        path.join(process.cwd(), 'routers/api/*.js'),
        path.join(process.cwd(), 'routers/api/*.ts'),
        // Include versioned API routes - dynamically include all supported versions
        ...supportedVersions.flatMap(version => [
            path.join(process.cwd(), `routers/api/${version}/**/*.js`),
            path.join(process.cwd(), `routers/api/${version}/**/*.ts`)
        ]),
        // Include managers that might have API documentation
        path.join(process.cwd(), 'managers/*.js'),
        path.join(process.cwd(), 'managers/*.ts')
    ]
};

// Generate the OpenAPI specification
const specs: SwaggerSpecs = swaggerJsdoc(options);

// Validate the documentation
const validation: ValidationResult = DocumentationValidator.validateVersionedDocs(specs);
if (!validation.isValid) {
    LogManager.warning('API Documentation validation failed', { errors: validation.errors });
}

// Add custom CSS for dark theme
specs.customCss = `
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

export = specs;