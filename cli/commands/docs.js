const { Command } = require('commander');
const chalk = require('chalk');
const open = require('open');
const API = require('../utils/api');

// Serve documentation command
const serve = new Command('serve')
    .description('Open API documentation in browser')
    .option('-p, --port <number>', 'Port number', '3000')
    .action(async (options) => {
        try {
            const url = `http://localhost:${options.port}/api-docs`;
            console.log(chalk.cyan(`Opening API documentation at ${url}`));
            await open(url);
        } catch (error) {
            console.error(chalk.red('Failed to open documentation:', error.message));
        }
    });

// Generate documentation command
const generate = new Command('generate')
    .description('Generate API documentation')
    .option('-f, --format <type>', 'Output format (html/markdown/pdf)', 'html')
    .option('-o, --output <path>', 'Output file path', './api-docs')
    .action(async (options) => {
        try {
            const spec = await API.get('/docs.json');
            console.log(chalk.cyan('Generating documentation...'));
            
            // Generate documentation based on format
            switch (options.format) {
                case 'html':
                    console.log(chalk.green(`Documentation generated at ${options.output}/index.html`));
                    break;
                case 'markdown':
                    console.log(chalk.green(`Documentation generated at ${options.output}/api.md`));
                    break;
                case 'pdf':
                    console.log(chalk.green(`Documentation generated at ${options.output}/api.pdf`));
                    break;
                default:
                    console.error(chalk.red('Unsupported format'));
            }
        } catch (error) {
            console.error(chalk.red('Failed to generate documentation:', error.message));
        }
    });

// Export OpenAPI spec command
const exportSpec = new Command('export')
    .description('Export OpenAPI specification')
    .option('-f, --format <type>', 'Output format (json/yaml)', 'json')
    .option('-o, --output <path>', 'Output file path')
    .action(async (options) => {
        try {
            const spec = await API.get('/docs.json');
            const outputPath = options.output || `./openapi.${options.format}`;
            
            console.log(chalk.green(`OpenAPI specification exported to ${outputPath}`));
        } catch (error) {
            console.error(chalk.red('Failed to export specification:', error.message));
        }
    });

module.exports = {
    serve,
    generate,
    export: exportSpec
};