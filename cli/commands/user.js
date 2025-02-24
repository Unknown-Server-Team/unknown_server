const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const API = require('../utils/api');
const { validateEmail, validatePassword } = require('../utils/validation');

// User list command
const list = new Command('list')
    .description('List all users')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-l, --limit <number>', 'Items per page', '10')
    .action(async (options) => {
        try {
            const users = await API.get(`/users?page=${options.page}&limit=${options.limit}`);
            console.table(users.map(u => ({
                ID: u.id,
                Email: u.email,
                Role: u.roles.join(', '),
                Verified: u.email_verified ? '✓' : '✗'
            })));
        } catch (error) {
            console.error(chalk.red('Failed to fetch users:', error.message));
        }
    });

// Create user command
const create = new Command('create')
    .description('Create a new user')
    .action(async () => {
        try {
            const answers = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'email',
                    message: 'User email:',
                    validate: validateEmail
                },
                {
                    type: 'password',
                    name: 'password',
                    message: 'User password:',
                    validate: validatePassword
                },
                {
                    type: 'input',
                    name: 'name',
                    message: 'User name:'
                }
            ]);

            const user = await API.post('/users', answers);
            console.log(chalk.green('User created successfully!'));
            console.log(chalk.cyan('User ID:'), user.id);
        } catch (error) {
            console.error(chalk.red('Failed to create user:', error.message));
        }
    });

// Delete user command
const deleteUser = new Command('delete')
    .description('Delete a user')
    .argument('<id>', 'User ID to delete')
    .action(async (id) => {
        try {
            const confirm = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'sure',
                    message: `Are you sure you want to delete user ${id}?`,
                    default: false
                }
            ]);

            if (confirm.sure) {
                await API.delete(`/users/${id}`);
                console.log(chalk.green('User deleted successfully!'));
            }
        } catch (error) {
            console.error(chalk.red('Failed to delete user:', error.message));
        }
    });

// Role management command
const role = new Command('role')
    .description('Manage user roles')
    .argument('<userId>', 'User ID')
    .argument('<action>', 'Action to perform (add/remove)')
    .argument('<role>', 'Role to add/remove')
    .action(async (userId, action, role) => {
        try {
            if (action === 'add') {
                await API.post(`/auth/user/${userId}/roles/${role}`);
                console.log(chalk.green(`Role '${role}' added to user ${userId}`));
            } else if (action === 'remove') {
                await API.delete(`/auth/user/${userId}/roles/${role}`);
                console.log(chalk.green(`Role '${role}' removed from user ${userId}`));
            } else {
                console.error(chalk.red('Invalid action. Use "add" or "remove"'));
            }
        } catch (error) {
            console.error(chalk.red('Failed to manage role:', error.message));
        }
    });

module.exports = {
    list,
    create,
    delete: deleteUser,
    role
};