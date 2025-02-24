const fs = require('fs').promises;
const path = require('path');
const LogManager = require('../LogManager');

class CliDocGenerator {
    static async generateDocs(commands, outputPath) {
        try {
            const content = this.generateMarkdown(commands);
            await fs.writeFile(outputPath, content, 'utf8');
            LogManager.info(`CLI documentation generated at ${outputPath}`);
            return true;
        } catch (error) {
            LogManager.error('Failed to generate CLI documentation', error);
            return false;
        }
    }

    static generateMarkdown(commands) {
        let content = '# Unknown Server CLI\n\n';
        content += '## Overview\n\n';
        content += 'Command-line interface for managing Unknown Server.\n\n';
        content += '## Installation\n\n';
        content += '```bash\nnpm install -g unknown-server\n```\n\n';
        content += '## Usage\n\n';
        content += '```bash\nunknown <command> [options]\n```\n\n';
        content += '## Available Commands\n\n';

        Object.entries(commands.commands).forEach(([command, details]) => {
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

    static generateExamples() {
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

    static async validateCommandImplementation(cliRoot) {
        const errors = [];
        const commandFiles = await fs.readdir(path.join(cliRoot, 'commands'));

        for (const file of commandFiles) {
            const commandModule = require(path.join(cliRoot, 'commands', file));
            const commandName = path.basename(file, '.js');

            // Check if all commands have descriptions
            Object.values(commandModule).forEach(command => {
                if (!command.description) {
                    errors.push(`${commandName}: Missing command description`);
                }
            });

            // Check if help is properly configured
            Object.values(commandModule).forEach(command => {
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

module.exports = CliDocGenerator;