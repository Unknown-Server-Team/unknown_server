const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');
const Table = require('cli-table3');
const figures = require('figures');
const API = require('../utils/api');
const { validateEmail, validatePassword } = require('../utils/validation');

const MAX_PAGE_SIZE = 100;

const fetchUsersPage = async (page, limit) => {
    const response = await API.get(`/v1/users?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`);
    return {
        users: Array.isArray(response.data) ? response.data : [],
        pagination: response.pagination || { page: Number(page), limit: Number(limit), total: 0, pages: 0 }
    };
};

const fetchAllUsers = async () => {
    const users = [];
    let page = 1;
    let pages = 1;
    do {
        const result = await fetchUsersPage(page, MAX_PAGE_SIZE);
        users.push(...result.users);
        pages = result.pagination.pages;
        page++;
    } while (page <= pages);
    return users;
};

const userRolesPath = (userId, roleName) => {
    const base = `/v1/auth/user/${encodeURIComponent(userId)}/roles`;
    return roleName ? `${base}/${encodeURIComponent(roleName)}` : base;
};

const fetchUserRoles = async (userId) => (await API.get(userRolesPath(userId))).data || [];

const withRoles = async (users) => Promise.all(users.map(async (u) => {
    try {
        return { ...u, roles: (await fetchUserRoles(u.id)).map(r => r.name) };
    } catch (error) {
        return { ...u, roles: null };
    }
}));

const formatRoles = (roles) => {
    if (roles === null) {
        return chalk.dim('unavailable');
    }
    return roles.length > 0 ? chalk.yellow(roles.join(', ')) : chalk.dim('none');
};

const printUsersTable = (users) => {
    const table = new Table({
        head: [
            chalk.cyan('ID'),
            chalk.cyan('Email'),
            chalk.cyan('Name'),
            chalk.cyan('Roles'),
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
            u.name || chalk.dim('-'),
            formatRoles(u.roles),
            u.email_verified ? chalk.green(figures.tick) : chalk.red(figures.cross)
        ]);
    });

    console.log(table.toString());
};

const printPageSummary = (users, pagination) => {
    const pages = Math.max(pagination.pages, 1);
    console.log(chalk.dim(`\nPage ${pagination.page} of ${pages}, showing ${users.length} of ${pagination.total} users`));
};

const showUsersPage = async (page, limit, spinner) => {
    const { users, pagination } = await fetchUsersPage(page, limit);
    const detailed = await withRoles(users);
    spinner.stop();

    if (detailed.length === 0) {
        console.log(chalk.yellow(pagination.total > 0
            ? `\nNo users on page ${pagination.page}; there are ${pagination.pages} page(s).`
            : '\nNo users found.'));
        return detailed;
    }

    printUsersTable(detailed);
    printPageSummary(detailed, pagination);
    return detailed;
};

const list = new Command('list')
    .description('List users')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-l, --limit <number>', `Items per page (max ${MAX_PAGE_SIZE})`, '10')
    .action(async (options) => {
        const spinner = ora('Fetching users...').start();
        try {
            await showUsersPage(options.page, options.limit, spinner);
        } catch (error) {
            spinner.stop();
            console.error(chalk.red('Failed to fetch users:'), chalk.red.dim(error.message));
        }
    });

list.runInteractive = async () => {
    let spinner;
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
                validate: value => value > 0 && value <= MAX_PAGE_SIZE ? true : `Limit must be between 1 and ${MAX_PAGE_SIZE}`
            }
        ]);

        spinner = ora('Fetching users...').start();
        const users = await showUsersPage(page, limit, spinner);

        if (users.length === 0) {
            return;
        }

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

            spinner = ora('Fetching user details...').start();
            const { data: userDetails } = await API.get(`/v1/users/${encodeURIComponent(userId)}`);
            const roles = await fetchUserRoles(userId);
            spinner.stop();

            console.log('\n' + chalk.cyan.bold('User Details:'));
            const detailsTable = new Table();

            Object.entries({ ...userDetails, roles: roles.map(r => r.name) }).forEach(([key, value]) => {
                let displayValue = value;
                if (Array.isArray(value)) {
                    displayValue = value.length > 0 ? value.join(', ') : chalk.dim('None');
                } else if (typeof value === 'boolean' || key === 'email_verified') {
                    displayValue = value ? chalk.green('Yes') : chalk.red('No');
                } else if (value === null || value === undefined) {
                    displayValue = chalk.dim('Not set');
                } else if (typeof value === 'object') {
                    displayValue = JSON.stringify(value);
                }

                const label = key.replace(/_/g, ' ');
                detailsTable.push({
                    [chalk.cyan(label.charAt(0).toUpperCase() + label.slice(1))]: displayValue
                });
            });

            console.log(detailsTable.toString());
        }
    } catch (error) {
        if (spinner) spinner.stop();
        console.error(chalk.red('Failed to fetch users:'), chalk.red.dim(error.message));
    }
};

const printCreatedUser = async (user) => {
    const [detailed] = await withRoles([user]);
    console.log('\n' + chalk.green.bold('User Details:'));
    console.log(chalk.cyan('ID: ') + user.id);
    console.log(chalk.cyan('Email: ') + user.email);
    console.log(chalk.cyan('Name: ') + (user.name || chalk.dim('Not set')));
    console.log(chalk.cyan('Roles: ') + formatRoles(detailed.roles));
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
            const response = await API.post('/v1/auth/register', answers);
            spinner.succeed('User created successfully!');
            await printCreatedUser(response.user);
        } catch (error) {
            console.error(chalk.red('Failed to create user:'), chalk.red.dim(error.message));
        }
    });

create.runInteractive = async () => {
    try {
        console.log(chalk.cyan.bold('\nCreate a new user:'));
        
        const spinner = ora('Fetching available roles...').start();
        const { data: roles } = await API.get('/v1/auth/roles');
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
            const response = await API.post('/v1/auth/register', answers);
            createSpinner.succeed('User created successfully!');
            await printCreatedUser(response.user);
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
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (id, options) => {
        let spinner;
        try {
            if (!options.yes) {
                const { sure } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'sure',
                        message: `Are you sure you want to delete user ${id}?`,
                        default: false
                    }
                ]);
                if (!sure) {
                    console.log(chalk.cyan('User deletion cancelled.'));
                    return;
                }
            }

            spinner = ora('Deleting user...').start();
            await API.delete(`/v1/users/${encodeURIComponent(id)}`);
            spinner.succeed(`User ${id} deleted successfully!`);
        } catch (error) {
            if (spinner) spinner.fail('Failed to delete user');
            console.error(chalk.red('Failed to delete user:'), chalk.red.dim(error.message));
        }
    });

deleteUser.runInteractive = async () => {
    let spinner;
    try {
        spinner = ora('Fetching users...').start();
        const users = await fetchAllUsers();
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
            await API.delete(`/v1/users/${encodeURIComponent(userId)}`);
            spinner.succeed(`User ${userId} deleted successfully!`);
        } else {
            console.log(chalk.cyan('User deletion cancelled.'));
        }
    } catch (error) {
        if (spinner) spinner.fail('Failed to delete user');
        console.error(chalk.red('Failed to delete user:'), chalk.red.dim(error.message));
    }
};

const changeUserRole = async (userId, action, roleName) => {
    const response = action === 'add'
        ? await API.post(userRolesPath(userId, roleName))
        : await API.delete(userRolesPath(userId, roleName));
    return response.data || [];
};

const printRoleNames = (title, roles) => {
    console.log(`\n${title}`);
    if (roles.length > 0) {
        roles.forEach(r => {
            console.log(`  ${chalk.green(figures.tick)} ${r.name}`);
        });
    } else {
        console.log(chalk.yellow('  No roles assigned'));
    }
};

const role = new Command('role')
    .description('Manage user roles')
    .argument('<userId>', 'User ID')
    .argument('<action>', 'Action to perform (add/remove)')
    .argument('<role>', 'Role name to add/remove')
    .action(async (userId, action, roleName) => {
        if (action !== 'add' && action !== 'remove') {
            console.error(chalk.red('Invalid action. Use "add" or "remove"'));
            return;
        }

        const spinner = ora('Managing user role...').start();
        try {
            const updatedRoles = await changeUserRole(userId, action, roleName);
            spinner.succeed(action === 'add'
                ? `Role '${roleName}' added to user ${userId}`
                : `Role '${roleName}' removed from user ${userId}`);
            printRoleNames('Current roles:', updatedRoles);
        } catch (error) {
            spinner.fail('Failed to manage role');
            console.error(chalk.red('Failed to manage role:'), chalk.red.dim(error.message));
        }
    });

role.runInteractive = async () => {
    let spinner;
    try {
        spinner = ora('Fetching users...').start();
        const users = await fetchAllUsers();
        spinner.stop();
        
        if (users.length === 0) {
            console.log(chalk.yellow('\nNo users found.'));
            return;
        }
        
        spinner = ora('Fetching available roles...').start();
        const { data: roles } = await API.get('/v1/auth/roles');
        spinner.stop();
        
        const { userId } = await inquirer.prompt([
            {
                type: 'list',
                name: 'userId',
                message: 'Select a user:',
                choices: users.map(u => ({ 
                    name: `${u.email} (${u.id})`, 
                    value: u.id 
                }))
            }
        ]);
        
        spinner = ora('Fetching user roles...').start();
        const userRoles = await fetchUserRoles(userId);
        spinner.stop();
        
        printRoleNames('Current roles:', userRoles);
        
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
        
        const assigned = new Set(userRoles.map(r => r.name));
        const roleChoices = action === 'add'
            ? roles.filter(r => !assigned.has(r.name)).map(r => ({
                name: `${r.name} - ${r.description || 'No description'}`,
                value: r.name
            }))
            : userRoles.map(r => ({ name: r.name, value: r.name }));
        
        if (roleChoices.length === 0) {
            console.log(chalk.yellow(action === 'add'
                ? '\nUser already has all available roles.'
                : '\nUser has no roles to remove.'));
            return;
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
        const updatedRoles = await changeUserRole(userId, action, selectedRole);
        spinner.succeed(action === 'add'
            ? `Role '${selectedRole}' added to user successfully`
            : `Role '${selectedRole}' removed from user successfully`);
        
        printRoleNames('Updated roles:', updatedRoles);
    } catch (error) {
        if (spinner) spinner.fail('Failed to manage role');
        console.error(chalk.red('Failed to manage role:'), chalk.red.dim(error.message));
    }
};

module.exports = {
    list,
    create,
    delete: deleteUser,
    role
};