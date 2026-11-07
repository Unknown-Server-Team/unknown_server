import type {
    SwaggerSpec,
    SwaggerPathMethods,
    SwaggerOperation,
    ValidationSummary,
    VersionManagerDocModule
} from '../types/documentation';
import VersionManagerImport from './VersionManager';

const VersionManager = VersionManagerImport as unknown as VersionManagerDocModule;

const VERSION_SEGMENT = /^\/api\/(v\d+)(\/|$)/;

class DocumentationValidator {
    static validateVersionedDocs(specs: SwaggerSpec): ValidationSummary {
        const errors: string[] = [];
        const supportedVersions = VersionManager.getSupportedVersions();
        const paths = specs.paths || {};

        Object.keys(paths).forEach((specPath: string): void => {
            const match = VERSION_SEGMENT.exec(specPath);
            if (match && !supportedVersions.includes(match[1])) {
                errors.push(`Path ${specPath} references unsupported API version ${match[1]}`);
            }
        });

        supportedVersions.forEach((version: string): void => {
            if (!VersionManager.isDeprecated(version)) {
                return;
            }
            Object.keys(paths)
                .filter((specPath: string): boolean => specPath.startsWith(`/api/${version}/`))
                .forEach((specPath: string): void => {
                    const methods = paths[specPath];
                    Object.keys(methods).forEach((method: string): void => {
                        if (!methods[method].deprecated) {
                            errors.push(`Deprecated version ${version} path ${specPath} method ${method} missing deprecated flag`);
                        }
                    });
                });
        });

        Object.entries(paths).forEach(([specPath, methods]: [string, SwaggerPathMethods]): void => {
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

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

export = DocumentationValidator;
