const swaggerJsdoc = require('swagger-jsdoc');
const VersionManager = require('./VersionManager');
const LogManager = require('./LogManager');
const path = require('path');

class DocumentationValidator {
    static validateVersionedDocs(specs) {
        const errors = [];
        const supportedVersions = VersionManager.getSupportedVersions();
        
        // Check paths for proper versioning
        Object.keys(specs.paths).forEach(path => {
            // API paths should include version
            if (path.startsWith('/api/')) {
                const hasVersion = supportedVersions.some(v => path.includes(`/${v}/`));
                if (!hasVersion) {
                    errors.push(`Path ${path} is missing API version`);
                }
            }
        });

        // Check deprecation notices
        supportedVersions.forEach(version => {
            if (VersionManager.isDeprecated(version)) {
                const versionPaths = Object.keys(specs.paths).filter(p => p.includes(`/${version}/`));
                versionPaths.forEach(path => {
                    const methods = specs.paths[path];
                    Object.keys(methods).forEach(method => {
                        if (!methods[method].deprecated) {
                            errors.push(`Deprecated version ${version} path ${path} method ${method} missing deprecated flag`);
                        }
                    });
                });
            }
        });

        // Validate tags and descriptions
        if (specs.paths) {
            Object.entries(specs.paths).forEach(([path, methods]) => {
                Object.entries(methods).forEach(([method, operation]) => {
                    if (!operation.tags || operation.tags.length === 0) {
                        errors.push(`Path ${path} method ${method} is missing tags`);
                    }
                    if (!operation.summary) {
                        errors.push(`Path ${path} method ${method} is missing summary`);
                    }
                    if (!operation.responses) {
                        errors.push(`Path ${path} method ${method} is missing response definitions`);
                    }
                });
            });
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static generateVersionedSpecs() {
        const versions = VersionManager.getSupportedVersions();
        const specs = {};

        versions.forEach(version => {
            const versionSpecs = swaggerJsdoc({
                definition: {
                    openapi: '3.0.0',
                    info: {
                        title: `Unknown Server API - ${version.toUpperCase()}`,
                        version: version,
                        description: `API documentation for ${version.toUpperCase()}`,
                        license: {
                            name: 'MIT',
                            url: 'https://opensource.org/licenses/MIT'
                        }
                    },
                    servers: [
                        {
                            url: `/api/${version}`,
                            description: `${version.toUpperCase()} Server`
                        }
                    ]
                },
                apis: [
                    path.join(process.cwd(), `routers/api/${version}/**/*.js`),
                    path.join(process.cwd(), 'managers/*.js')
                ]
            });

            if (VersionManager.isDeprecated(version)) {
                versionSpecs.info.description += ' (DEPRECATED)';
            }

            specs[version] = versionSpecs;
        });

        return specs;
    }

    static validateMarkdownDocs() {
        const errors = [];
        const docFiles = [
            'api.md',
            'deployment.md',
            'security.md',
            'roles-and-permissions.md'
        ];

        docFiles.forEach(file => {
            // Check required sections
            const requiredSections = ['Overview', 'Prerequisites', 'Usage'];
            // Check formatting
            const formattingRules = [
                { pattern: /^# .*$/m, message: 'Missing main title (H1 heading)' },
                { pattern: /^## .*$/m, message: 'Missing sections (H2 headings)' },
                { pattern: /\`\`\`[a-z]*[\s\S]*?\`\`\`/m, message: 'Missing code examples' }
            ];
            // Add errors if found
            // Note: Actual file reading and checking would be done here
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static generateCliDocs() {
        return {
            name: 'unknown',
            description: 'Unknown Server CLI',
            commands: {
                user: {
                    description: 'User management commands',
                    subcommands: {
                        list: 'List all users',
                        create: 'Create a new user',
                        delete: 'Delete a user',
                        role: 'Manage user roles'
                    }
                },
                auth: {
                    description: 'Authentication commands',
                    subcommands: {
                        login: 'Login to the server',
                        token: 'Manage authentication tokens',
                        roles: 'List and manage roles'
                    }
                },
                service: {
                    description: 'Service management',
                    subcommands: {
                        status: 'Check service status',
                        metrics: 'View service metrics',
                        routes: 'List API routes'
                    }
                },
                docs: {
                    description: 'Documentation tools',
                    subcommands: {
                        serve: 'Open documentation in browser',
                        generate: 'Generate API documentation',
                        export: 'Export OpenAPI specification'
                    }
                }
            }
        };
    }

    static validateEndpointVersioning(router) {
        const errors = [];
        const routes = [];

        // Extract all routes from the router
        router.stack.forEach(layer => {
            if (layer.route) {
                routes.push(layer.route);
            }
        });

        routes.forEach(route => {
            const path = route.path;
            const methods = Object.keys(route.methods);

            // Check if route has proper version prefix
            if (!path.match(/^\/v\d+\//)) {
                errors.push(`Route ${path} is missing version prefix`);
            }

            // Ensure route has swagger documentation
            const hasSwaggerDocs = route.stack.some(layer => 
                layer.name === 'middleware' && 
                layer.handle.toString().includes('@swagger')
            );

            if (!hasSwaggerDocs) {
                errors.push(`Route ${path} [${methods.join(', ')}] is missing swagger documentation`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = DocumentationValidator;