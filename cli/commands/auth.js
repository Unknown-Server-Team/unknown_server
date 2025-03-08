const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const figures = require('figures');
const ora = require('ora');
const API = require('../utils/api');

// Login command
const login = new Command('login')
    .description('Authenticate with the server')
    .action(async () => {
        try {
            const credentials = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'email',
                    message: 'Email:'
                },
                {
                    type: 'password',
                    name: 'password',
                    message: 'Password:'
                }
            ]);

            const response = await API.post('/auth/login', credentials);
            API.setToken(response.token);
            console.log(chalk.green('Successfully logged in!'));
        } catch (error) {
            console.error(chalk.red('Login failed:', error.message));
        }
    });

// Login already has interactive capabilities, just making it consistent
login.runInteractive = async function() {
    const credentials = await inquirer.prompt([
        {
            type: 'input',
            name: 'email',
            message: 'Email:',
            prefix: chalk.cyan(figures.pointer)
        },
        {
            type: 'password',
            name: 'password',
            message: 'Password:',
            prefix: chalk.cyan(figures.pointer)
        }
    ]);

    const spinner = ora('Logging in...').start();
    
    try {
        const response = await API.post('/auth/login', credentials);
        API.setToken(response.token);
        spinner.succeed('Successfully logged in!');
    } catch (error) {
        spinner.fail('Login failed');
        console.error(chalk.red('Error:', error.message));
    }
};

// Token management command
const token = new Command('token')
    .description('Token management')
    .option('-s, --show', 'Show current token')
    .option('-c, --clear', 'Clear current token')
    .action((options) => {
        if (options.show) {
            const token = API.token;
            if (token) {
                console.log(chalk.cyan('Current token:'), token);
            } else {
                console.log(chalk.yellow('No token set'));
            }
        } else if (options.clear) {
            API.setToken(null);
            console.log(chalk.green('Token cleared successfully'));
        } else {
            console.log(chalk.yellow('Please specify an action (--show or --clear)'));
        }
    });

// Add interactive mode support
token.runInteractive = async function() {
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Token management:',
            choices: [
                { name: `${figures.eye} Show current token`, value: 'show' },
                { name: `${figures.cross} Clear current token`, value: 'clear' }
            ],
            prefix: chalk.cyan(figures.key)
        }
    ]);
    
    if (action === 'show') {
        const token = API.token;
        if (token) {
            console.log(chalk.cyan('\nCurrent token:'), token);
        } else {
            console.log(chalk.yellow('\nNo token set'));
        }
    } else if (action === 'clear') {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to clear the token?',
                default: false,
                prefix: chalk.yellow(figures.warning)
            }
        ]);
        
        if (confirm) {
            API.setToken(null);
            console.log(chalk.green('\nToken cleared successfully'));
        } else {
            console.log(chalk.cyan('\nToken clearing cancelled'));
        }
    }
};

// Role management commands
const roles = new Command('roles')
    .description('Role management commands')
    .option('-l, --list', 'List all roles')
    .option('-u, --user <id>', 'List roles for specific user')
    .action(async (options) => {
        try {
            if (options.list) {
                const roles = await API.get('/auth/roles');
                console.table(roles.map(r => ({
                    ID: r.id,
                    Name: r.name,
                    Description: r.description
                })));
            } else if (options.user) {
                const roles = await API.get(`/auth/user/${options.user}/roles`);
                console.table(roles.map(r => ({
                    ID: r.id,
                    Name: r.name,
                    Description: r.description
                })));
            } else {
                console.log(chalk.yellow('Please specify an action (--list or --user)'));
            }
        } catch (error) {
            console.error(chalk.red('Failed to fetch roles:', error.message));
        }
    });

// Add interactive mode support
roles.runInteractive = async function() {
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Role management:',
            choices: [
                { name: `${figures.arrowDown} List all roles`, value: 'list' },
                { name: `${figures.user} List roles for specific user`, value: 'user' }
            ],
            prefix: chalk.yellow(figures.key)
        }
    ]);
    
    const spinner = ora();
    
    try {
        if (action === 'list') {
            spinner.text = 'Fetching all roles...';
            spinner.start();
            
            const roles = await API.get('/auth/roles');
            spinner.succeed('Roles retrieved');
            
            if (roles.length === 0) {
                console.log(chalk.yellow('\nNo roles found'));
            } else {
                console.log(chalk.bold('\nAvailable Roles:'));
                console.table(roles.map(r => ({
                    ID: r.id,
                    Name: r.name,
                    Description: r.description
                })));
            }
        } else if (action === 'user') {
            const { userId } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'userId',
                    message: 'Enter user ID:',
                    prefix: chalk.yellow(figures.pointer)
                }
            ]);
            
            spinner.text = `Fetching roles for user ${userId}...`;
            spinner.start();
            
            const roles = await API.get(`/auth/user/${userId}/roles`);
            spinner.succeed('User roles retrieved');
            
            if (roles.length === 0) {
                console.log(chalk.yellow(`\nNo roles found for user ${userId}`));
            } else {
                console.log(chalk.bold(`\nRoles for User ${userId}:`));
                console.table(roles.map(r => ({
                    ID: r.id,
                    Name: r.name,
                    Description: r.description
                })));
            }
        }
    } catch (error) {
        spinner.fail('Failed to fetch roles');
        console.error(chalk.red('Error:', error.message));
    }
};

module.exports = {
    login,
    token,
    roles
};