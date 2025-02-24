const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
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

module.exports = {
    login,
    token,
    roles
};