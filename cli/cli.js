#!/usr/bin/env node
const { program } = require('commander');
const chalk = require('chalk');
const figlet = require('figlet');
const { version } = require('../package.json');

// Command modules
const userCommands = require('./commands/user');
const authCommands = require('./commands/auth');
const serviceCommands = require('./commands/service');
const docsCommands = require('./commands/docs');

// ASCII art banner
console.log(
    chalk.cyan(
        figlet.textSync('Unknown CLI', { horizontalLayout: 'full' })
    )
);

program
    .version(version)
    .description('CLI for Unknown Server management and operations');

// User management commands
program
    .command('user')
    .description('User management commands')
    .addCommand(userCommands.list)
    .addCommand(userCommands.create)
    .addCommand(userCommands.delete)
    .addCommand(userCommands.role);

// Authentication commands
program
    .command('auth')
    .description('Authentication and authorization commands')
    .addCommand(authCommands.login)
    .addCommand(authCommands.token)
    .addCommand(authCommands.roles);

// Service commands
program
    .command('service')
    .description('Service management commands')
    .addCommand(serviceCommands.status)
    .addCommand(serviceCommands.metrics)
    .addCommand(serviceCommands.routes);

// Documentation commands
program
    .command('docs')
    .description('Documentation management')
    .addCommand(docsCommands.serve)
    .addCommand(docsCommands.generate)
    .addCommand(docsCommands.export);

program.parse(process.argv);