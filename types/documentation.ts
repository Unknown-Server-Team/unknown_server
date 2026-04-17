export interface SwaggerDefinition {
    openapi: string;
    info: {
        title: string;
        version: string;
        description: string;
        license: {
            name: string;
            url: string;
        };
    };
    servers: Array<{
        url: string;
        description: string;
    }>;
}

export interface SwaggerJsdocOptions {
    definition: SwaggerDefinition;
    apis: string[];
}

export interface SwaggerJsdocModule {
    (options: SwaggerJsdocOptions): SwaggerSpec;
}

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

export interface CliDocs {
    name: string;
    description: string;
    commands: Record<string, {
        description: string;
        subcommands: Record<string, string>;
    }>;
}

export interface RouterLayer {
    route?: RouterRoute;
    name?: string;
    handle: {
        toString(): string;
    };
}

export interface RouterRoute {
    path: string;
    methods: Record<string, boolean>;
    stack: RouterLayer[];
}

export interface RouterLike {
    stack: RouterLayer[];
}

export interface VersionManagerDocModule {
    getSupportedVersions(): string[];
    isDeprecated(version: string): boolean;
}
