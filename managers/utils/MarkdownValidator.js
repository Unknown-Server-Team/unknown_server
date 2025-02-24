const fs = require('fs').promises;
const path = require('path');
const LogManager = require('../LogManager');

class MarkdownValidator {
    static async validateFile(filePath, options = {}) {
        const errors = [];
        try {
            const content = await fs.readFile(filePath, 'utf8');
            
            // Check main title
            if (!content.match(/^# .+$/m)) {
                errors.push(`${path.basename(filePath)}: Missing main title (H1 heading)`);
            }

            // Check required sections
            const sections = (options.requiredSections || []).map(section => 
                new RegExp(`^## ${section}`, 'm')
            );
            
            sections.forEach((sectionRegex, index) => {
                if (!content.match(sectionRegex)) {
                    errors.push(`${path.basename(filePath)}: Missing required section "${options.requiredSections[index]}"`);
                }
            });

            // Check code examples
            if (options.requireCodeExamples && !content.match(/\`\`\`[a-z]*[\s\S]*?\`\`\`/m)) {
                errors.push(`${path.basename(filePath)}: Missing code examples`);
            }

            // Check section nesting
            const headings = content.match(/^#{1,6} .+$/gm) || [];
            let previousLevel = 1;
            headings.forEach(heading => {
                const level = heading.match(/^#{1,6}/)[0].length;
                if (level > previousLevel + 1) {
                    errors.push(`${path.basename(filePath)}: Invalid heading nesting - ${heading.trim()}`);
                }
                previousLevel = level;
            });

            // Check links
            const links = content.match(/\[.+?\]\(.+?\)/g) || [];
            for (const link of links) {
                const url = link.match(/\((.+?)\)/)[1];
                if (url.startsWith('./') || url.startsWith('../')) {
                    const resolvedPath = path.resolve(path.dirname(filePath), url);
                    try {
                        await fs.access(resolvedPath);
                    } catch {
                        errors.push(`${path.basename(filePath)}: Broken internal link - ${url}`);
                    }
                }
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        } catch (error) {
            LogManager.error(`Failed to validate markdown file: ${filePath}`, error);
            return {
                isValid: false,
                errors: [`Failed to read or validate file: ${error.message}`]
            };
        }
    }

    static validateApiEndpointDocs(content) {
        const errors = [];
        const requiredSections = ['Parameters', 'Response', 'Example'];
        
        // Check endpoint documentation structure
        const endpoints = content.match(/^### .+$/gm) || [];
        
        endpoints.forEach(endpoint => {
            const endpointSection = this.getSection(content, endpoint);
            
            // Check HTTP method
            if (!endpoint.match(/GET|POST|PUT|DELETE|PATCH/)) {
                errors.push(`${endpoint}: Missing HTTP method`);
            }
            
            // Check required sections
            requiredSections.forEach(section => {
                if (!endpointSection.match(new RegExp(`^#### ${section}`, 'm'))) {
                    errors.push(`${endpoint}: Missing ${section} section`);
                }
            });
            
            // Check response examples
            if (!endpointSection.match(/\`\`\`json[\s\S]*?\`\`\`/)) {
                errors.push(`${endpoint}: Missing JSON response example`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static getSection(content, heading) {
        const index = content.indexOf(heading);
        if (index === -1) return '';
        
        const nextHeading = content.slice(index + heading.length)
            .match(/^###? .+$/m);
        
        if (!nextHeading) {
            return content.slice(index);
        }
        
        return content.slice(
            index,
            index + heading.length + content.slice(index + heading.length).indexOf(nextHeading[0])
        );
    }
}

module.exports = MarkdownValidator;