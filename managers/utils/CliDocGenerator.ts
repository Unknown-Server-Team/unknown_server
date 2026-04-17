import { promises as fs } from 'fs';
import path from 'path';
import type { CliCommand, CliCommands, CliValidationResult } from '../../types/utils';
import type { LogManagerModule } from '../../types/modules';

const LogManager = require('../LogManager') as LogManagerModule;

export class CliDocGenerator {
    static async generateDocs(commands: CliCommands, outputPath: string): Promise<boolean> {
        try {
            const content = this.generateMarkdown(commands);
            await fs.writeFile(outputPath, content, 'utf8');
            LogManager.info(`CLI documentation generated at ${outputPath}`);
            return true;
        } catch (error: unknown) {
            LogManager.error('Failed to generate CLI documentation', error);
            return false;
        }
    }

    static generateMarkdown(commands: CliCommands): string {
        let content = '# Unknown Server CLI\n\n';
        content += '## Overview\n\n';
        content += 'Command-line interface for managing Unknown Server.\n\n';
        content += '## Installation\n\n';
        content += '```bash\nnpm install -g unknown-server\n```\n\n';
        content += '## Usage\n\n';
        content += '```bash\nunknown <command> [options]\n```\n\n';
        content += '## Available Commands\n\n';

        Object.entries(commands.commands).forEach(([command, details]: [string, CliCommand]) => {
            content += `### ${command}\n\n`;
            content += `${details.description}\n\n`;
            content += '#### Subcommands\n\n';

            Object.entries(details.subcommands).forEach(([subcommand, desc]) => {
                content += `- \`${command} ${subcommand}\`: ${desc}\n`;
            });
            content += '\n';
        });

        content += '## Examples\n\n';
        content += this.generateExamples();

        return content;
    }

    private static generateExamples(): string {
        return `### User Management
\`\`\`bash
# List all users
unknown user list

# Create a new user
unknown user create

# Manage user roles
unknown user role <userId> add admin
\`\`\`

### Authentication
\`\`\`bash
# Login to the server
unknown auth login

# Show current token
unknown auth token --show

# List available roles
unknown auth roles --list
\`\`\`

### Service Management
\`\`\`bash
# Check service status
unknown service status --verbose

# View performance metrics
unknown service metrics --time day

# List API routes
unknown service routes --version v1
\`\`\`

### Documentation
\`\`\`bash
# Open API docs in browser
unknown docs serve

# Generate documentation
unknown docs generate --format markdown --output ./docs/api

# Export OpenAPI spec
unknown docs export --format yaml
\`\`\`
`;
    }

    static async validateCommandImplementation(cliRoot: string): Promise<CliValidationResult> {
        const errors: string[] = [];
        const commandFiles = await fs.readdir(path.join(cliRoot, 'commands'));

        for (const file of commandFiles) {
            const commandModule = require(path.join(cliRoot, 'commands', file)) as Record<string, Record<string, unknown>>;
            const commandName = path.basename(file, '.js');

            Object.values(commandModule).forEach((command) => {
                if (!command.description) {
                    errors.push(`${commandName}: Missing command description`);
                }
            });

            Object.values(commandModule).forEach((command) => {
                if (!command.helpInformation) {
                    errors.push(`${commandName}: Missing help configuration`);
                }
            });
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

export default CliDocGenerator;
