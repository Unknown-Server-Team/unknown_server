const express = require('express');
const router = express.Router();
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { RatelimitManager } = require('../../managers/RatelimitManager');
const PerformanceManager = require('../../managers/PerformanceManager');
const authRouter = require('./auth');
const usersRouter = require('./users');
const path = require('path');

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Unknown Server API',
            version: '1.0.0',
            description: 'REST API documentation for Unknown Server',
            contact: {
                name: 'API Support',
                email: process.env.SMTP_FROM_EMAIL
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            {
                url: '/api',
                description: 'API Server',
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
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message'
                        },
                        details: {
                            type: 'object',
                            description: 'Detailed error information'
                        }
                    }
                },
                User: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'integer',
                            description: 'User ID'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email'
                        },
                        name: {
                            type: 'string',
                            description: 'User full name'
                        },
                        email_verified: {
                            type: 'boolean',
                            description: 'Email verification status'
                        },
                        created_at: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Account creation timestamp'
                        }
                    }
                }
            },
            responses: {
                UnauthorizedError: {
                    description: 'Access token is missing or invalid',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/Error'
                            }
                        }
                    }
                },
                ForbiddenError: {
                    description: 'The server understood the request but refuses to authorize it',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/Error'
                            }
                        }
                    }
                },
                ValidationError: {
                    description: 'The request data did not pass validation',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/Error'
                            }
                        }
                    }
                }
            }
        },
        tags: [
            {
                name: 'Authentication',
                description: 'Authentication and user management endpoints'
            },
            {
                name: 'System',
                description: 'System health and monitoring endpoints'
            },
            {
                name: 'Authorization',
                description: 'Role and permission management'
            },
            {
                name: 'Users',
                description: 'User profile and management'
            }
        ]
    },
    apis: [
        path.join(__dirname, './*.js'),
        path.join(__dirname, '../../managers/*.js')
    ],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Custom Swagger UI options
const swaggerUiOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Unknown Server API Documentation',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        displayRequestDuration: true
    }
};

// Apply rate limiting to all API routes
router.use(RatelimitManager.createApiLimiter());

// Serve Swagger documentation
router.use('/docs', swaggerUi.serve);
router.get('/docs', swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Get raw OpenAPI spec
router.get('/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});

// Auth routes
router.use('/auth', authRouter);

// Users routes
router.use('/users', usersRouter);

/**
 * @swagger
 * /api/health:
 *   get:
 *     tags:
 *       - System
 *     summary: Get API health status
 *     description: Returns the current health status and performance metrics of the API
 *     responses:
 *       200:
 *         description: Health check information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 uptime:
 *                   type: string
 *                   example: 2d 5h 30m 15s
 *                 memory:
 *                   type: object
 *                   properties:
 *                     heapUsed:
 *                       type: string
 *                     heapTotal:
 *                       type: string
 *                     rss:
 *                       type: string
 *                 cpu:
 *                   type: string
 *                   example: 45.2%
 */
router.get('/health', (req, res) => {
    const metrics = PerformanceManager.getMetrics();
    res.json({
        status: 'healthy',
        uptime: metrics.uptime,
        memory: metrics.memoryUsage,
        cpu: metrics.currentCpuUsage
    });
});

module.exports = router;