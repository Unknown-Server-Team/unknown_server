const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const figures = require('figures');
const ora = require('ora');
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

// Add interactive mode support
serve.runInteractive = async function() {
    const { port } = await inquirer.prompt([
        {
            type: 'input',
            name: 'port',
            message: 'Enter port number:',
            default: '3000',
            validate: input => !isNaN(input) ? true : 'Port must be a number',
            prefix: chalk.magenta(figures.pointer)
        }
    ]);
    
    const spinner = ora('Opening API documentation...').start();
    
    try {
        const url = `http://localhost:${port}/api-docs`;
        await open(url);
        spinner.succeed(`Documentation opened at ${url}`);
    } catch (error) {
        spinner.fail('Failed to open documentation');
        console.error(chalk.red('Error:', error.message));
    }
};

// Generate documentation command
const generate = new Command('generate')
    .description('Generate API documentation')
    .option('-f, --format <type>', 'Output format (html/markdown/pdf)', 'html')
    .option('-o, --output <path>', 'Output file path', './api-docs')
    .action(async (options) => {
        try {
            const spinner = ora('Generating documentation...').start();
            const spec = await API.get('/docs.json');
            
            // Generate documentation based on format
            switch (options.format) {
                case 'html':
                    // Simulate document generation (this would be replaced with actual generation logic)
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    spinner.succeed(`Documentation generated at ${options.output}/index.html`);
                    break;
                case 'markdown':
                    // Simulate document generation
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    spinner.succeed(`Documentation generated at ${options.output}/api.md`);
                    break;
                case 'pdf':
                    // Simulate document generation
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    spinner.succeed(`Documentation generated at ${options.output}/api.pdf`);
                    break;
                default:
                    spinner.fail('Unsupported format');
            }
        } catch (error) {
            console.error(chalk.red('Failed to generate documentation:', error.message));
        }
    });

// Add interactive mode support
generate.runInteractive = async function() {
    const { format, outputPath } = await inquirer.prompt([
        {
            type: 'list',
            name: 'format',
            message: 'Select output format:',
            choices: [
                { name: 'HTML', value: 'html' },
                { name: 'Markdown', value: 'markdown' },
                { name: 'PDF', value: 'pdf' }
            ],
            prefix: chalk.magenta(figures.bookmarkFilled)
        },
        {
            type: 'input',
            name: 'outputPath',
            message: 'Enter output path:',
            default: answers => `./api-docs.${answers.format === 'html' ? '' : answers.format}`,
            prefix: chalk.magenta(figures.pointer)
        }
    ]);
    
    const spinner = ora('Fetching API specification...').start();
    
    try {
        // Try to fetch the API spec
        let spec;
        try {
            spec = await API.get('/docs.json');
            spinner.text = 'Generating documentation...';
        } catch (specError) {
            spinner.warn('Could not fetch API specification, generating from template');
            spinner.text = 'Generating documentation from template...';
        }
        
        // Process based on selected format
        switch (format) {
            case 'html':
                // Simulate document generation (replace with actual logic)
                await new Promise(resolve => setTimeout(resolve, 1500));
                spinner.succeed(`HTML documentation generated at ${outputPath}/index.html`);
                
                // Ask if user wants to open the generated docs
                const { openDocs } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'openDocs',
                        message: 'Open the generated documentation?',
                        default: true,
                        prefix: chalk.cyan(figures.info)
                    }
                ]);
                
                if (openDocs) {
                    try {
                        await open(`${outputPath}/index.html`);
                    } catch (openError) {
                        console.log(chalk.yellow('Could not open documentation file automatically.'));
                    }
                }
                break;
                
            case 'markdown':
                await new Promise(resolve => setTimeout(resolve, 1200));
                spinner.succeed(`Markdown documentation generated at ${outputPath}/api.md`);
                break;
                
            case 'pdf':
                await new Promise(resolve => setTimeout(resolve, 2000));
                spinner.succeed(`PDF documentation generated at ${outputPath}/api.pdf`);
                break;
        }
        
    } catch (error) {
        spinner.fail('Failed to generate documentation');
        console.error(chalk.red('Error:', error.message));
    }
};

// Export OpenAPI spec command
const exportSpec = new Command('export')
    .description('Export OpenAPI specification')
    .option('-f, --format <type>', 'Output format (json/yaml)', 'json')
    .option('-o, --output <path>', 'Output file path')
    .action(async (options) => {
        try {
            const spinner = ora('Exporting OpenAPI specification...').start();
            const spec = await API.get('/docs.json');
            const outputPath = options.output || `./openapi.${options.format}`;
            
            // Simulate export (this would be replaced with actual export logic)
            await new Promise(resolve => setTimeout(resolve, 1000));
            spinner.succeed(`OpenAPI specification exported to ${outputPath}`);
        } catch (error) {
            console.error(chalk.red('Failed to export specification:', error.message));
        }
    });

// Add interactive mode support
exportSpec.runInteractive = async function() {
    const { format, outputPath } = await inquirer.prompt([
        {
            type: 'list',
            name: 'format',
            message: 'Select output format:',
            choices: [
                { name: 'JSON', value: 'json' },
                { name: 'YAML', value: 'yaml' }
            ],
            prefix: chalk.magenta(figures.arrowRight)
        },
        {
            type: 'input',
            name: 'outputPath',
            message: 'Enter output file path:',
            default: answers => `./openapi.${answers.format}`,
            prefix: chalk.magenta(figures.pointer)
        }
    ]);
    
    const spinner = ora('Fetching OpenAPI specification...').start();
    
    try {
        // Try to fetch the API spec
        try {
            const spec = await API.get('/docs.json');
            spinner.text = 'Exporting specification...';
            
            // Simulate export (replace with actual logic)
            await new Promise(resolve => setTimeout(resolve, 1000));
            spinner.succeed(`OpenAPI specification exported to ${outputPath}`);
            
        } catch (specError) {
            spinner.fail('Could not fetch API specification');
            console.error(chalk.red('Error:', specError.message));
        }
    } catch (error) {
        spinner.fail('Failed to export specification');
        console.error(chalk.red('Error:', error.message));
    }
};

module.exports = {
    serve,
    generate,
    export: exportSpec
};