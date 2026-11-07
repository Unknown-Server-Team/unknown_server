export interface DocGenerationOptions {
    includePrivateEndpoints?: boolean;
    formatType?: 'markdown' | 'html' | 'json';
    outputDir?: string;
}

export interface ValidationOptions {
    requiredSections?: string[];
    checkCodeBlocks?: boolean;
    checkLinks?: boolean;
    allowEmptySections?: boolean;
}

export interface MarkdownValidationResult {
    isValid: boolean;
    errors: string[];
    warnings?: string[];
}

export interface MarkdownValidatorModule {
    validateFile(filePath: string, options?: ValidationOptions): Promise<MarkdownValidationResult>;
    validateContent(content: string, options?: ValidationOptions): MarkdownValidationResult;
}
