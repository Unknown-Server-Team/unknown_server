export interface SwaggerOperation {
    deprecated?: boolean;
    tags?: string[];
    summary?: string;
    responses?: Record<string, unknown>;
}

export interface SwaggerPathMethods {
    [method: string]: SwaggerOperation;
}

export interface SwaggerSpec {
    info: {
        description: string;
        [key: string]: unknown;
    };
    paths: Record<string, SwaggerPathMethods>;
    [key: string]: unknown;
}

export interface ValidationSummary {
    isValid: boolean;
    errors: string[];
}

export interface VersionManagerDocModule {
    getSupportedVersions(): string[];
    isDeprecated(version: string): boolean;
}
