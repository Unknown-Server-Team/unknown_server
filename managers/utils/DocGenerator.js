const fs = require('fs').promises;
const path = require('path');
const VersionManager = require('../VersionManager');
const LogManager = require('../LogManager');
const MarkdownValidator = require('./MarkdownValidator');

class DocGenerator {
    static async initialize() {
        const dirs = [
            path.join(process.cwd(), 'docs', 'versions'),
            path.join(process.cwd(), 'docs', 'migrations')
        ];

        for (const dir of dirs) {
            try {
                await fs.mkdir(dir, { recursive: true });
            } catch (error) {
                if (error.code !== 'EEXIST') {
                    LogManager.error(`Failed to create directory: ${dir}`, error);
                }
            }
        }
    }

    static async generateVersionDocs() {
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
                const validation = await MarkdownValidator.validateFile(outputPath, {
                    requiredSections: [
                        'Overview',
                        'Authentication',
                        'Endpoints',
                        'Error Handling'
                    ],
                    requireCodeExamples: true
                });

                if (!validation.isValid) {
                    LogManager.warning(`Documentation validation issues for ${version}:`, 
                        validation.errors
                    );
                }

                // Add deprecation notice if needed
                if (VersionManager.isDeprecated(version)) {
                    const deprecationNotice = `
> ⚠️ **Deprecation Notice**
> This API version is deprecated and will be removed in a future release.
> Please migrate to the latest version.

`;
                    const currentContent = await fs.readFile(outputPath, 'utf8');
                    await fs.writeFile(
                        outputPath,
                        deprecationNotice + currentContent,
                        'utf8'
                    );
                }
            }

            // Generate main API documentation that links to all versions
            await this.generateMainDoc(versions);
            
            return true;
        } catch (error) {
            LogManager.error('Failed to generate version documentation', error);
            return false;
        }
    }

    static async generateMainDoc(versions) {
        const content = `# Unknown Server API Documentation

## Available Versions

${versions.map(v => {
    const status = VersionManager.isDeprecated(v) ? '(Deprecated)' : '(Active)';
    return `- [${v.toUpperCase()}](./versions/${v}.md) ${status}`;
}).join('\n')}

## Version Policy

- New features are added in the latest version
- Breaking changes trigger a new version
- Deprecated versions are supported for 6 months
- Security fixes are backported to all supported versions

## Migration Guides

${versions.slice(1).map(v => {
    const prevVersion = versions[versions.indexOf(v) - 1];
    return `- [${prevVersion} → ${v}](./migrations/${prevVersion}-to-${v}.md)`;
}).join('\n')}

## SDK Support

| Version | JavaScript | Python | Go | Ruby |
|---------|------------|--------|----|----|
${versions.map(v => `| ${v} | ✓ | ✓ | ✓ | ✓ |`).join('\n')}

## Additional Resources

- [Getting Started](./getting-started.md)
- [Authentication Guide](./authentication.md)
- [Error Handling](./errors.md)
- [Best Practices](./best-practices.md)
`;

        await fs.writeFile(
            path.join(process.cwd(), 'docs', 'api.md'),
            content,
            'utf8'
        );
    }

    static async validateAllDocs() {
        const docsPath = path.join(process.cwd(), 'docs');
        const errors = [];

        try {
            const files = await fs.readdir(docsPath);
            for (const file of files) {
                if (file.endsWith('.md')) {
                    const validation = await MarkdownValidator.validateFile(
                        path.join(docsPath, file)
                    );
                    if (!validation.isValid) {
                        errors.push(...validation.errors);
                    }
                }
            }
        } catch (error) {
            LogManager.error('Documentation validation failed', error);
            errors.push(error.message);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = DocGenerator;