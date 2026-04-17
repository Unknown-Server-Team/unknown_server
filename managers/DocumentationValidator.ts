import path from 'path';
import type {
    SwaggerJsdocModule,
    SwaggerSpec,
    SwaggerPathMethods,
    SwaggerOperation,
    ValidationSummary,
    CliDocs,
    RouterLayer,
    RouterRoute,
    RouterLike,
    VersionManagerDocModule
} from '../types/documentation';

const swaggerJsdoc = require('swagger-jsdoc') as SwaggerJsdocModule;
const VersionManager = require('./VersionManager') as VersionManagerDocModule;

class DocumentationValidator {
    static validateVersionedDocs(specs: SwaggerSpec): ValidationSummary {
        const errors: string[] = [];
        const supportedVersions = VersionManager.getSupportedVersions();

        Object.keys(specs.paths).forEach((specPath: string): void => {
            if (specPath.startsWith('/api/')) {
                const hasVersion = supportedVersions.some((version: string): boolean => specPath.includes(`/${version}/`));
                if (!hasVersion) {
                    errors.push(`Path ${specPath} is missing API version`);
                }
            }
        });

        supportedVersions.forEach((version: string): void => {
            if (VersionManager.isDeprecated(version)) {
                const versionPaths = Object.keys(specs.paths).filter((specPath: string): boolean => specPath.includes(`/${version}/`));
                versionPaths.forEach((specPath: string): void => {
                    const methods = specs.paths[specPath];
                    Object.keys(methods).forEach((method: string): void => {
                        if (!methods[method].deprecated) {
                            errors.push(`Deprecated version ${version} path ${specPath} method ${method} missing deprecated flag`);
                        }
                    });
                });
            }
        });

        if (specs.paths) {
            Object.entries(specs.paths).forEach(([specPath, methods]: [string, SwaggerPathMethods]): void => {
                Object.entries(methods).forEach(([method, operation]: [string, SwaggerOperation]): void => {
                    if (!operation.tags || operation.tags.length === 0) {
                        errors.push(`Path ${specPath} method ${method} is missing tags`);
                    }
                    if (!operation.summary) {
                        errors.push(`Path ${specPath} method ${method} is missing summary`);
                    }
                    if (!operation.responses) {
                        errors.push(`Path ${specPath} method ${method} is missing response definitions`);
                    }
                });
            });
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static generateVersionedSpecs(): Record<string, SwaggerSpec> {
        const versions = VersionManager.getSupportedVersions();
        const specs: Record<string, SwaggerSpec> = {};

        versions.forEach((version: string): void => {
            const versionSpecs = swaggerJsdoc({
                definition: {
                    openapi: '3.0.0',
                    info: {
                        title: `Unknown Server API - ${version.toUpperCase()}`,
                        version,
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

    static validateMarkdownDocs(): ValidationSummary {
        const errors: string[] = [];
        const docFiles = [
            'api.md',
            'deployment.md',
            'security.md',
            'roles-and-permissions.md'
        ];

        docFiles.forEach((_file: string): void => {
            const requiredSections = ['Overview', 'Prerequisites', 'Usage'];
            const formattingRules = [
                { pattern: /^# .*$/m, message: 'Missing main title (H1 heading)' },
                { pattern: /^## .*$/m, message: 'Missing sections (H2 headings)' },
                { pattern: /\`\`\`[a-z]*[\s\S]*?\`\`\`/m, message: 'Missing code examples' }
            ];
            void requiredSections;
            void formattingRules;
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static generateCliDocs(): CliDocs {
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

    static validateEndpointVersioning(router: RouterLike): ValidationSummary {
        const errors: string[] = [];
        const routes: RouterRoute[] = [];

        router.stack.forEach((layer: RouterLayer): void => {
            if (layer.route) {
                routes.push(layer.route);
            }
        });

        routes.forEach((route: RouterRoute): void => {
            const routePath = route.path;
            const methods = Object.keys(route.methods);

            if (!routePath.match(/^\/v\d+\//)) {
                errors.push(`Route ${routePath} is missing version prefix`);
            }

            const hasSwaggerDocs = route.stack.some((layer: RouterLayer): boolean => (
                layer.name === 'middleware' &&
                layer.handle.toString().includes('@swagger')
            ));

            if (!hasSwaggerDocs) {
                errors.push(`Route ${routePath} [${methods.join(', ')}] is missing swagger documentation`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = DocumentationValidator;
module.exports.DocumentationValidator = DocumentationValidator;
