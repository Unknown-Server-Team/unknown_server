#!/usr/bin/env node
require("dotenv").config();
// Suppress punycode deprecation warnings which can break CLI UI
process.env.NODE_NO_WARNINGS = 1;
const { program } = require('commander');
const chalk = require('chalk');
const figlet = require('figlet');
const inquirer = require('inquirer');
const figures = require('figures');
const ora = require('ora');
const { version } = require('../package.json');

// Command modules
const userCommands = require('./commands/user');
const authCommands = require('./commands/auth');
const serviceCommands = require('./commands/service');
const docsCommands = require('./commands/docs');

/**
 * Create a bordered box around text using ASCII characters
 */
function createBox(text, { padding = 1, borderColor = 'cyan', margin = 1 } = {}) {
  const lines = text.split('\n');
  const contentWidth = Math.max(...lines.map(line => line.length));
  const horizontal = '─'.repeat(contentWidth + (padding * 2));
  const top = `╭${horizontal}╮`;
  const bottom = `╰${horizontal}╯`;
  const empty = `│${' '.repeat(contentWidth + (padding * 2))}│`;
  
  const boxContent = lines.map(line => 
    `│${' '.repeat(padding)}${line}${' '.repeat(contentWidth - line.length + padding)}│`
  );
  
  const marginTop = '\n'.repeat(margin);
  const marginBottom = '\n'.repeat(margin);
  
  return [
    marginTop,
    ...([top, ...(padding ? [empty] : []), ...boxContent, ...(padding ? [empty] : []), bottom]
      .map(line => chalk[borderColor](line))),
    marginBottom
  ].join('\n');
}

/**
 * Display the welcome banner with styled text
 */
function displayBanner() {
  console.clear();
  console.log('\n');
  console.log(
    chalk.cyan(
      figlet.textSync('Unknown CLI', { 
        font: 'Standard',
        horizontalLayout: 'full' 
      })
    )
  );
  
  const welcomeMessage = chalk.dim(`v${version} - Interactive CLI for Unknown Server`);
  console.log(createBox(welcomeMessage, { borderColor: 'cyan', margin: 0 }));
}

/**
 * Show the main interactive menu
 */
async function showMainMenu() {
  displayBanner();
  
  const { menuChoice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'menuChoice',
      message: 'What would you like to do?',
      pageSize: 10,
      loop: false,
      prefix: chalk.cyan(figures.pointer),
      choices: [
        { name: chalk.green(`${figures.star} User Management`), value: 'user' },
        { name: chalk.yellow(`${figures.key} Authentication & Authorization`), value: 'auth' },
        { name: chalk.blue(`${figures.circleFilled} Service Operations`), value: 'service' },
        { name: chalk.magenta(`${figures.bookmarkFilled} Documentation`), value: 'docs' },
        new inquirer.Separator(chalk.dim('─'.repeat(50))),
        { name: chalk.dim(`${figures.cross} Exit CLI`), value: 'exit' }
      ]
    }
  ]);

  if (menuChoice === 'exit') {
    console.log(createBox(chalk.cyan('Thank you for using Unknown CLI. Goodbye!'), {
      padding: 1,
      margin: 1,
      borderColor: 'cyan'
    }));
    process.exit(0);
  }

  // Show the submenu for the selected category
  await showSubMenu(menuChoice);
}

/**
 * Show submenu based on main menu selection
 */
async function showSubMenu(category) {
  console.clear();
  displayBanner();

  let choices = [];
  let prefix = '';
  let icon = '';
  
  switch(category) {
    case 'user':
      prefix = chalk.green('Users') + ' ' + chalk.dim('>');
      icon = figures.star;
      choices = [
        { name: `List all users`, value: 'list' },
        { name: `Create new user`, value: 'create' },
        { name: `Delete a user`, value: 'delete' },
        { name: `Manage user roles`, value: 'role' }
      ];
      break;
    case 'auth':
      prefix = chalk.yellow('Auth') + ' ' + chalk.dim('>');
      icon = figures.key;
      choices = [
        { name: `Login to the system`, value: 'login' },
        { name: `Manage access tokens`, value: 'token' },
        { name: `View available roles`, value: 'roles' }
      ];
      break;
    case 'service':
      prefix = chalk.blue('Service') + ' ' + chalk.dim('>');
      icon = figures.circleFilled;
      choices = [
        { name: `Check service status`, value: 'status' },
        { name: `View performance metrics`, value: 'metrics' },
        { name: `List API routes`, value: 'routes' }
      ];
      break;
    case 'docs':
      prefix = chalk.magenta('Docs') + ' ' + chalk.dim('>');
      icon = figures.bookmarkFilled;
      choices = [
        { name: `Serve documentation`, value: 'serve' },
        { name: `Generate documentation`, value: 'generate' },
        { name: `Export documentation`, value: 'export' }
      ];
      break;
  }
  
  // Add icons to choices
  choices = choices.map(choice => {
    choice.name = `${icon} ${choice.name}`;
    return choice;
  });
  
  // Add back and exit options to all submenus
  choices.push(new inquirer.Separator(chalk.dim('─'.repeat(50))));
  choices.push({ name: chalk.dim(`${figures.arrowLeft} Back to main menu`), value: 'back' });
  choices.push({ name: chalk.dim(`${figures.cross} Exit CLI`), value: 'exit' });
  
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `${category.charAt(0).toUpperCase() + category.slice(1)} operations:`,
      prefix,
      pageSize: 10,
      loop: false,
      choices
    }
  ]);
  
  if (action === 'back') {
    return showMainMenu();
  }
  
  if (action === 'exit') {
    console.log(createBox(chalk.cyan('Thank you for using Unknown CLI. Goodbye!'), {
      padding: 1,
      margin: 1,
      borderColor: 'cyan'
    }));
    process.exit(0);
  }
  
  // Execute the selected command
  await executeCommand(category, action);
}

/**
 * Execute the command based on category and action
 */
async function executeCommand(category, action) {
  try {
    let cmd;
    
    switch(category) {
      case 'user':
        cmd = userCommands[action];
        break;
      case 'auth':
        cmd = authCommands[action];
        break;
      case 'service':
        cmd = serviceCommands[action];
        break;
      case 'docs':
        cmd = docsCommands[action];
        break;
    }
    
    if (cmd && cmd.runInteractive) {
      await cmd.runInteractive();
    } else if (cmd) {
      // For backward compatibility with commands that don't have runInteractive
      await cmd.parseAsync([process.argv[0], process.argv[1]]);
    } else {
      console.error(chalk.red(`Command ${action} not found in ${category} category`));
    }
    
    // Pause to see the results
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: chalk.dim('Press ENTER to continue...'),
        prefix: chalk.cyan(figures.info)
      }
    ]);
    
    // Go back to the submenu
    await showSubMenu(category);
    
  } catch (error) {
    console.error(createBox(
      `${chalk.red.bold('ERROR:')} ${chalk.red(error.message)}`,
      { padding: 1, borderColor: 'red' }
    ));
    
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: chalk.dim('Press ENTER to continue...'),
        prefix: chalk.red(figures.warning)
      }
    ]);
    
    await showSubMenu(category);
  }
}

// Handle global errors
process.on('unhandledRejection', (err) => {
  const spinner = ora.promise();
  if (spinner) spinner.stop();
  
  console.error(createBox(
    `${chalk.red.bold('Unhandled Error:')} ${chalk.red(err.message)}`,
    { padding: 1, borderColor: 'red' }
  ));
  
  // Don't exit, let the user continue working with the CLI
});

// Traditional CLI setup (preserving compatibility with existing scripts)
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

// Check if any command line arguments were provided
if (process.argv.length > 2) {
  // Traditional CLI mode
  program.parse(process.argv);
} else {
  // Interactive mode
  showMainMenu().catch(err => {
    // Ensure any active spinner is stopped
    const spinner = ora.promise();
    if (spinner) spinner.stop();
    
    console.error(createBox(
      `${chalk.red.bold('Error:')} ${chalk.red(err.message)}`,
      { padding: 1, borderColor: 'red' }
    ));
    process.exit(1);
  });
}