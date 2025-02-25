const swaggerJsdoc = require('swagger-jsdoc');
const DocumentationValidator = require('../managers/DocumentationValidator');
const VersionManager = require('../managers/VersionManager');
const LogManager = require('../managers/LogManager');
const path = require('path');

// Get the supported API versions
const supportedVersions = VersionManager.getSupportedVersions();

// Define the OpenAPI options directly here rather than using DocumentationValidator
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Unknown Server API Documentation',
      version: process.env.VERSION || '2.2.0',
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
    // Include versioned API routes - dynamically include all supported versions
    ...supportedVersions.map(version => path.join(process.cwd(), `routers/api/${version}/**/*.js`)),
    // Include managers that might have API documentation
    path.join(process.cwd(), 'managers/*.js')
  ]
};

// Generate the OpenAPI specification
const specs = swaggerJsdoc(options);

// Validate the documentation
const validation = DocumentationValidator.validateVersionedDocs(specs);
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

module.exports = specs;