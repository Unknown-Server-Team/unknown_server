const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const figures = require('figures');
const ora = require('ora');
const open = require('open');
const API = require('../utils/api');

const docsUrl = () => `${API.baseUrl}/docs`;

const openDocs = async () => {
    const url = docsUrl();
    await open(url);
    return url;
};

const serve = new Command('serve')
    .description('Open the Swagger UI served by the API in a browser')
    .action(async () => {
        try {
            console.log(chalk.cyan(`Opening API documentation at ${docsUrl()}`));
            await openDocs();
        } catch (error) {
            console.error(chalk.red('Failed to open documentation:', error.message));
        }
    });

serve.runInteractive = async function() {
    const spinner = ora('Opening API documentation...').start();

    try {
        const url = await openDocs();
        spinner.succeed(`Documentation opened at ${url}`);
    } catch (error) {
        spinner.fail('Failed to open documentation');
        console.error(chalk.red('Error:', error.message));
    }
};

const writeSpec = async (outputPath) => {
    const spec = await API.get('/docs.json');
    const resolved = path.resolve(outputPath);
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
    return resolved;
};

const exportSpec = new Command('export')
    .description('Export the OpenAPI specification as JSON')
    .option('-o, --output <path>', 'Output file path', './openapi.json')
    .action(async (options) => {
        const spinner = ora('Exporting OpenAPI specification...').start();
        try {
            const written = await writeSpec(options.output);
            spinner.succeed(`OpenAPI specification exported to ${written}`);
        } catch (error) {
            spinner.fail('Failed to export specification');
            console.error(chalk.red('Error:', error.message));
        }
    });

exportSpec.runInteractive = async function() {
    const { outputPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'outputPath',
            message: 'Enter output file path:',
            default: './openapi.json',
            prefix: chalk.magenta(figures.pointer)
        }
    ]);

    const spinner = ora('Exporting OpenAPI specification...').start();

    try {
        const written = await writeSpec(outputPath);
        spinner.succeed(`OpenAPI specification exported to ${written}`);
    } catch (error) {
        spinner.fail('Failed to export specification');
        console.error(chalk.red('Error:', error.message));
    }
};

module.exports = {
    serve,
    export: exportSpec
};
