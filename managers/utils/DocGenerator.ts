import { promises as fs } from 'fs';
import path from 'path';
import { VersionManager } from '../VersionManager';
import { LogManager } from '../LogManager';
import { markdownValidator } from './MarkdownValidator';

interface DocGenerationOptions {
    includePrivateEndpoints?: boolean;
    formatType?: 'markdown' | 'html' | 'json';
    outputDir?: string;
}

export class DocGenerator {
    static async initialize(): Promise<void> {
        const dirs = [
            path.join(process.cwd(), 'docs', 'versions'),
            path.join(process.cwd(), 'docs', 'migrations')
        ];

        for (const dir of dirs) {
            try {
                await fs.mkdir(dir, { recursive: true });
            } catch (error: any) {
                if (error.code !== 'EEXIST') {
                    LogManager.error(`Failed to create directory: ${dir}`, error);
                }
            }
        }
    }

    static async generateVersionDocs(): Promise<void> {
        try {
            const template = await fs.readFile(
                path.join(process.cwd(), 'docs', 'api-template.md'),
                'utf8'
            );

            const versions = VersionManager.getSupportedVersions();
            for (const version of versions) {
                const content = template.replace(/\{version\}/g, version);
                const outputPath = path.join(
                    process.cwd(),
                    'docs',
                    'versions',
                    `${version}.md`
                );

                await fs.mkdir(path.dirname(outputPath), { recursive: true });
                await fs.writeFile(outputPath, content, 'utf8');

                // Validate generated documentation
                const validation = await markdownValidator.validateFile(outputPath, {
                    requiredSections: [
                        'Overview',
                        'Authentication', 
                        'Endpoints'
                    ],
                    checkCodeBlocks: true,
                    checkLinks: true
                });

                if (!validation.isValid) {
                    LogManager.warning(`Generated docs for ${version} have validation issues`, validation.errors);
                }
            }

            LogManager.info(`Generated documentation for ${versions.length} API versions`);
        } catch (error) {
            LogManager.error('Failed to generate version documentation', error);
            throw error;
        }
    }

    static async generateMigrationGuide(fromVersion: string, toVersion: string): Promise<string> {
        const migrationPath = path.join(
            process.cwd(),
            'docs',
            'migrations',
            `${fromVersion}-to-${toVersion}.md`
        );

        const content = this.buildMigrationContent(fromVersion, toVersion);
        await fs.writeFile(migrationPath, content, 'utf8');
        
        LogManager.info(`Generated migration guide: ${fromVersion} → ${toVersion}`);
        return migrationPath;
    }

    private static buildMigrationContent(fromVersion: string, toVersion: string): string {
        return `# Migration Guide: ${fromVersion} → ${toVersion}

## Overview

This guide helps you migrate from API version ${fromVersion} to ${toVersion}.

## Breaking Changes

- List breaking changes here

## New Features

- List new features here

## Updated Endpoints

- List updated endpoints here

## Deprecated Features

- List deprecated features here

## Code Examples

### Before (${fromVersion})
\`\`\`javascript
// Old API usage example
\`\`\`

### After (${toVersion})
\`\`\`javascript
// New API usage example
\`\`\`

## Migration Steps

1. Step 1
2. Step 2
3. Step 3

## Support

For migration support, please contact [support@unknown-server.com](mailto:support@unknown-server.com).
`;
    }

    static async generateApiReference(options: DocGenerationOptions = {}): Promise<void> {
        const { formatType = 'markdown', outputDir = 'docs/api' } = options;
        
        await fs.mkdir(path.join(process.cwd(), outputDir), { recursive: true });
        
        const versions = VersionManager.getSupportedVersions();
        for (const version of versions) {
            const fileName = `${version}.${formatType}`;
            const filePath = path.join(process.cwd(), outputDir, fileName);
            
            const content = await this.generateVersionReference(version, formatType);
            await fs.writeFile(filePath, content, 'utf8');
        }
        
        LogManager.info(`Generated API reference in ${formatType} format`);
    }

    private static async generateVersionReference(version: string, format: string): Promise<string> {
        // This would be implemented based on your API structure
        // For now, return a basic template
        return `# API Reference - ${version}

## Authentication
All endpoints require authentication unless otherwise specified.

## Endpoints
Documentation for ${version} endpoints would be generated here.
`;
    }

    static async validateAllDocs(): Promise<{ isValid: boolean; errors: string[] }> {
        const docsDir = path.join(process.cwd(), 'docs');
        const errors: string[] = [];
        
        try {
            const files = await this.findMarkdownFiles(docsDir);
            
            for (const file of files) {
                const validation = await markdownValidator.validateFile(file);
                if (!validation.isValid) {
                    errors.push(`${file}: ${validation.errors.join(', ')}`);
                }
            }
            
            return {
                isValid: errors.length === 0,
                errors
            };
        } catch (error: any) {
            LogManager.error('Failed to validate documentation', error);
            return {
                isValid: false,
                errors: [error.message]
            };
        }
    }

    private static async findMarkdownFiles(dir: string): Promise<string[]> {
        const files: string[] = [];
        
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                const subFiles = await this.findMarkdownFiles(fullPath);
                files.push(...subFiles);
            } else if (entry.name.endsWith('.md')) {
                files.push(fullPath);
            }
        }
        
        return files;
    }
}

export default DocGenerator;