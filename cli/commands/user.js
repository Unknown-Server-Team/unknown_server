const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');
const Table = require('cli-table3');
const figures = require('figures');
const API = require('../utils/api');
const { validateEmail, validatePassword } = require('../utils/validation');

const list = new Command('list')
    .description('List all users')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-l, --limit <number>', 'Items per page', '10')
    .action(async (options) => {
        try {
            const spinner = ora('Fetching users...').start();
            const users = await API.get(`/users?page=${options.page}&limit=${options.limit}`);
            spinner.stop();

            if (users.length === 0) {
                console.log(chalk.yellow('\nNo users found.'));
                return;
            }

            const table = new Table({
                head: [
                    chalk.cyan('ID'),
                    chalk.cyan('Email'),
                    chalk.cyan('Role'),
                    chalk.cyan('Verified')
                ],
                style: {
                    head: [],
                    border: []
                }
            });

            users.forEach(u => {
                table.push([
                    u.id,
                    u.email,
                    chalk.yellow(u.roles.join(', ')),
                    u.email_verified ? chalk.green(figures.tick) : chalk.red(figures.cross)
                ]);
            });

            console.log(table.toString());
            console.log(chalk.dim(`\nPage ${options.page} of users, showing ${users.length} of ${users.length} results`));
        } catch (error) {
            console.error(chalk.red('Failed to fetch users:'), chalk.red.dim(error.message));
        }
    });

list.runInteractive = async () => {
    try {
        const { page, limit } = await inquirer.prompt([
            {
                type: 'number',
                name: 'page',
                message: 'Page number:',
                default: 1,
                validate: value => value > 0 ? true : 'Page must be greater than 0'
            },
            {
                type: 'number',
                name: 'limit',
                message: 'Items per page:',
                default: 10,
                validate: value => value > 0 ? true : 'Limit must be greater than 0'
            }
        ]);

        const spinner = ora('Fetching users...').start();
        const users = await API.get(`/users?page=${page}&limit=${limit}`);
        spinner.succeed('Users fetched successfully');

        if (users.length === 0) {
            console.log(chalk.yellow('\nNo users found.'));
            return;
        }

        const table = new Table({
            head: [
                chalk.cyan('ID'),
                chalk.cyan('Email'),
                chalk.cyan('Role'),
                chalk.cyan('Verified')
            ],
            style: {
                head: [],
                border: []
            }
        });

        users.forEach(u => {
            table.push([
                u.id,
                u.email,
                chalk.yellow(u.roles.join(', ')),
                u.email_verified ? chalk.green(figures.tick) : chalk.red(figures.cross)
            ]);
        });

        console.log(table.toString());
        console.log(chalk.dim(`\nPage ${page} of users, showing ${users.length} of ${users.length} results`));

        const { viewDetails } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'viewDetails',
                message: 'Do you want to view details for a specific user?',
                default: false
            }
        ]);

        if (viewDetails) {
            const { userId } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'userId',
                    message: 'Select a user to view:',
                    choices: users.map(u => ({ name: `${u.email} (${u.id})`, value: u.id }))
                }
            ]);

            const spinner = ora('Fetching user details...').start();
            const userDetails = await API.get(`/users/${userId}`);
            spinner.stop();

            console.log('\n' + chalk.cyan.bold('User Details:'));
            const detailsTable = new Table();

            Object.entries(userDetails).forEach(([key, value]) => {
                let displayValue = value;
                if (Array.isArray(value)) {
                    displayValue = value.join(', ');
                } else if (typeof value === 'boolean') {
                    displayValue = value ? chalk.green('Yes') : chalk.red('No');
                } else if (value === null || value === undefined) {
                    displayValue = chalk.dim('Not set');
                } else if (typeof value === 'object') {
                    displayValue = JSON.stringify(value);
                }

                detailsTable.push({
                    [chalk.cyan(key.replace(/_/g, ' ').charAt(0).toUpperCase() + key.replace(/_/g, ' ').slice(1))]: displayValue
                });
            });

            console.log(detailsTable.toString());
        }
    } catch (error) {
        console.error(chalk.red('Failed to fetch users:'), chalk.red.dim(error.message));
    }
};

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

            const spinner = ora('Creating user...').start();
            const response = await API.post('/auth/register', answers);
            spinner.succeed('User created successfully!');

            console.log('\n' + chalk.green.bold('User Details:'));
            console.log(chalk.cyan('ID: ') + response.user.id);
            console.log(chalk.cyan('Email: ') + response.user.email);
            console.log(chalk.cyan('Name: ') + response.user.name);
            const roles = response.roles || [];
            console.log(chalk.cyan('Roles: ') + chalk.yellow(roles.join(', ')));
        } catch (error) {
            console.error(chalk.red('Failed to create user:'), chalk.red.dim(error.message));
        }
    });

create.runInteractive = async () => {
    try {
        console.log(chalk.cyan.bold('\nCreate a new user:'));

        const spinner = ora('Fetching available roles...').start();
        const roles = await API.get('/auth/roles');
        spinner.stop();

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
            },
            {
                type: 'checkbox',
                name: 'roles',
                message: 'Select roles:',
                choices: roles.map(role => ({
                    name: `${role.name} ${chalk.dim(`- ${role.description || 'No description'}`)}`,
                    value: role.name
                })),
                when: roles && roles.length > 0
            }
        ]);

        const createSpinner = ora('Creating user...').start();
        try {
            const response = await API.post('/auth/register', answers);
            createSpinner.succeed('User created successfully!');

            console.log('\n' + chalk.green.bold('User Details:'));
            console.log(chalk.cyan('ID: ') + response.user.id);
            console.log(chalk.cyan('Email: ') + response.user.email);
            console.log(chalk.cyan('Name: ') + response.user.name);
            console.log(chalk.cyan('Roles: ') + chalk.yellow((response.roles || []).join(', ') || 'No roles assigned'));

            console.log(chalk.dim('\nA verification email has been sent to the user.'));
        } catch (error) {
            createSpinner.fail('Failed to create user');
            throw error;
        }
    } catch (error) {
        console.error(chalk.red('Failed to create user:'), chalk.red.dim(error.message));
    }
};

const deleteUser = new Command('delete')
    .description('Delete a user')
    .argument('<id>', 'User ID to delete')
    .action(async (id) => {
        let spinner;
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
                spinner = ora('Deleting user...').start();
                await API.delete(`/users/${id}`);
                spinner.succeed('User deleted successfully!');
            }
        } catch (error) {
            console.error(chalk.red('Failed to delete user:'), chalk.red.dim(error.message));
            if (spinner) spinner.fail('Failed to delete user');
        }
    });

deleteUser.runInteractive = async () => {
    let spinner;
    try {
        spinner = ora('Fetching users...').start();
        const users = await API.get('/users?limit=50');
        spinner.stop();

        if (users.length === 0) {
            console.log(chalk.yellow('\nNo users available to delete.'));
            return;
        }

        const { userId } = await inquirer.prompt([
            {
                type: 'list',
                name: 'userId',
                message: 'Select the user to delete:',
                choices: users.map(u => ({
                    name: `${u.email} (${u.id})`,
                    value: u.id
                }))
            }
        ]);

        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: chalk.yellow(`Are you sure you want to delete this user? This action cannot be undone.`),
                default: false
            }
        ]);

        if (confirm) {
            spinner = ora('Deleting user...').start();
            await API.delete(`/users/${userId}`);
            spinner.succeed(`User ${userId} deleted successfully!`);
        } else {
            console.log(chalk.cyan('User deletion cancelled.'));
            if (spinner) spinner.stop();
        }
    } catch (error) {
        console.error(chalk.red('Failed to delete user:'), chalk.red.dim(error.message));
        if (spinner) spinner.fail('Failed to delete user');
    }
};

const role = new Command('role')
    .description('Manage user roles')
    .argument('<userId>', 'User ID')
    .argument('<action>', 'Action to perform (add/remove)')
    .argument('<role>', 'Role to add/remove')
    .action(async (userId, action, role) => {
        try {
            const spinner = ora('Managing user role...').start();

            if (action === 'add') {
                await API.post(`/auth/user/${userId}/roles/${role}`);
                spinner.succeed(`Role '${role}' added to user ${userId}`);
            } else if (action === 'remove') {
                await API.delete(`/auth/user/${userId}/roles/${role}`);
                spinner.succeed(`Role '${role}' removed from user ${userId}`);
            } else {
                spinner.fail('Invalid action');
                console.error(chalk.red('Invalid action. Use "add" or "remove"'));
            }
        } catch (error) {
            console.error(chalk.red('Failed to manage role:'), chalk.red.dim(error.message));
        }
    });

role.runInteractive = async () => {
    try {
        let spinner = ora('Fetching users...').start();
        const users = await API.get('/users');
        spinner.stop();

        if (users.length === 0) {
            console.log(chalk.yellow('\nNo users found.'));
            return;
        }

        spinner = ora('Fetching available roles...').start();
        const roles = await API.get('/roles');
        spinner.stop();

        const { userId } = await inquirer.prompt([
            {
                type: 'list',
                name: 'userId',
                message: 'Select a user:',
                choices: users.map(u => ({
                    name: `${u.email} (${u.id}) - Roles: ${u.roles?.join(', ') || 'none'}`,
                    value: u.id
                }))
            }
        ]);

        spinner = ora('Fetching user details...').start();
        const user = await API.get(`/users/${userId}`);
        spinner.stop();

        console.log('\nCurrent roles:');
        if (user.roles && user.roles.length > 0) {
            user.roles.forEach(role => {
                console.log(`  ${chalk.green(figures.tick)} ${role}`);
            });
        } else {
            console.log(chalk.yellow('  No roles assigned'));
        }

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { name: 'Add a role', value: 'add' },
                    { name: 'Remove a role', value: 'remove' }
                ]
            }
        ]);

        let roleChoices = [];

        if (action === 'add') {
            roleChoices = roles.filter(r => !user.roles?.includes(r.name)).map(r => ({
                name: `${r.name} - ${r.description || 'No description'}`,
                value: r.name
            }));

            if (roleChoices.length === 0) {
                console.log(chalk.yellow('\nUser already has all available roles.'));
                return;
            }
        } else {
            roleChoices = user.roles?.map(r => ({
                name: r,
                value: r
            })) || [];

            if (roleChoices.length === 0) {
                console.log(chalk.yellow('\nUser has no roles to remove.'));
                return;
            }
        }

        const { selectedRole } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedRole',
                message: `Select role to ${action}:`,
                choices: roleChoices
            }
        ]);

        spinner = ora(`${action === 'add' ? 'Adding' : 'Removing'} role...`).start();

        if (action === 'add') {
            await API.post(`/auth/user/${userId}/roles/${selectedRole}`);
            spinner.succeed(`Role '${selectedRole}' added to user successfully`);
        } else {
            await API.delete(`/auth/user/${userId}/roles/${selectedRole}`);
            spinner.succeed(`Role '${selectedRole}' removed from user successfully`);
        }

        spinner = ora('Fetching updated user details...').start();
        const updatedUser = await API.get(`/users/${userId}`);
        spinner.stop();

        console.log('\nUpdated roles:');
        if (updatedUser.roles && updatedUser.roles.length > 0) {
            updatedUser.roles.forEach(role => {
                console.log(`  ${chalk.green(figures.tick)} ${role}`);
            });
        } else {
            console.log(chalk.yellow('  No roles assigned'));
        }
    } catch (error) {
        console.error(chalk.red('Failed to manage role:'), chalk.red.dim(error.message));
    }
};

module.exports = {
    list,
    create,
    delete: deleteUser,
    role
};