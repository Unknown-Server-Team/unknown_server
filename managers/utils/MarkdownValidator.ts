import { promises as fs } from 'fs';
import path from 'path';
import type { ValidationOptions, MarkdownValidationResult } from '../../types/utils';
import type { LogManagerModule } from '../../types/modules';

const LogManager = require('../LogManager') as LogManagerModule;

export class MarkdownValidator {
    static async validateFile(filePath: string, options: ValidationOptions = {}): Promise<MarkdownValidationResult> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return this.validateContent(content, options);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            LogManager.error(`Failed to read markdown file: ${filePath}`, error);
            return {
                isValid: false,
                errors: [`Unable to read file: ${message}`]
            };
        }
    }

    static validateContent(content: string, options: ValidationOptions = {}): MarkdownValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        const {
            requiredSections = [],
            checkCodeBlocks = true,
            checkLinks = false,
            allowEmptySections = false
        } = options;

        for (const section of requiredSections) {
            const sectionRegex = new RegExp(`^#+\\s+${section}`, 'mi');
            if (!sectionRegex.test(content)) {
                errors.push(`Missing required section: ${section}`);
            }
        }

        if (checkCodeBlocks) {
            const codeBlockErrors = this.validateCodeBlocks(content);
            errors.push(...codeBlockErrors);
        }

        if (checkLinks) {
            const linkWarnings = this.validateLinks(content);
            warnings.push(...linkWarnings);
        }

        if (!allowEmptySections) {
            const emptySectionErrors = this.findEmptySections(content);
            warnings.push(...emptySectionErrors);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    private static validateCodeBlocks(content: string): string[] {
        const errors: string[] = [];

        const codeBlockRegex = /```\s*\n[\s\S]*?\n```/g;
        const matches = content.match(codeBlockRegex);

        if (matches) {
            matches.forEach((block, index) => {
                if (block.startsWith('```\n')) {
                    errors.push(`Code block ${index + 1} is missing language specification`);
                }
            });
        }

        const backtickCount = (content.match(/```/g) || []).length;
        if (backtickCount % 2 !== 0) {
            errors.push('Unmatched code block delimiters (```)');
        }

        return errors;
    }

    private static validateLinks(content: string): string[] {
        const warnings: string[] = [];

        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
            const [, linkText, url] = match;

            if (!url.trim()) {
                warnings.push(`Empty link found: [${linkText}]()`);
                continue;
            }

            if (url.includes('localhost') || url.includes('127.0.0.1')) {
                warnings.push(`Local link found: [${linkText}](${url}) - may not work in production`);
            }

            if (url.startsWith('#')) {
                const anchorId = url.slice(1).toLowerCase().replace(/\s+/g, '-');
                const hasAnchor = content.toLowerCase().includes(`id="${anchorId}"`) ||
                                content.includes(`<a name="${anchorId}">`) ||
                                new RegExp(`^#+.*${anchorId.replace(/-/g, '\\s+')}`, 'mi').test(content);

                if (!hasAnchor) {
                    warnings.push(`Broken internal link: ${url}`);
                }
            }
        }

        return warnings;
    }

    private static findEmptySections(content: string): string[] {
        const warnings: string[] = [];

        const sections = content.split(/^#+\s+/m);

        sections.forEach((section, index) => {
            if (index === 0) return;

            const lines = section.split('\n');
            const title = lines[0];
            const contentLines = lines.slice(1).filter(line => line.trim());

            if (contentLines.length === 0) {
                warnings.push(`Empty section found: ${title}`);
            }
        });

        return warnings;
    }

    static async validateDirectory(dirPath: string, options: ValidationOptions = {}): Promise<MarkdownValidationResult> {
        const allErrors: string[] = [];
        const allWarnings: string[] = [];

        try {
            const files = await this.findMarkdownFiles(dirPath);

            for (const file of files) {
                const result = await this.validateFile(file, options);

                if (!result.isValid) {
                    allErrors.push(...result.errors.map(error => `${file}: ${error}`));
                }

                if (result.warnings) {
                    allWarnings.push(...result.warnings.map(warning => `${file}: ${warning}`));
                }
            }

            return {
                isValid: allErrors.length === 0,
                errors: allErrors,
                warnings: allWarnings
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                isValid: false,
                errors: [`Failed to validate directory: ${message}`]
            };
        }
    }

    private static async findMarkdownFiles(dir: string): Promise<string[]> {
        const files: string[] = [];

        try {
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
        } catch (error: unknown) {
            LogManager.error(`Error reading directory ${dir}`, error);
        }

        return files;
    }

    static generateValidationReport(results: MarkdownValidationResult[]): string {
        let report = '# Markdown Validation Report\n\n';

        const totalFiles = results.length;
        const validFiles = results.filter(r => r.isValid).length;
        const invalidFiles = totalFiles - validFiles;

        report += `## Summary\n\n`;
        report += `- **Total files**: ${totalFiles}\n`;
        report += `- **Valid files**: ${validFiles}\n`;
        report += `- **Invalid files**: ${invalidFiles}\n\n`;

        if (invalidFiles > 0) {
            report += `## Issues Found\n\n`;

            results.forEach((result, index) => {
                if (!result.isValid) {
                    report += `### File ${index + 1}\n\n`;
                    result.errors.forEach(error => {
                        report += `- ${error}\n`;
                    });

                    if (result.warnings && result.warnings.length > 0) {
                        result.warnings.forEach(warning => {
                            report += `- ${warning}\n`;
                        });
                    }
                    report += '\n';
                }
            });
        }

        return report;
    }
}

export const markdownValidator = new MarkdownValidator();
export default MarkdownValidator;
