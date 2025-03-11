const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const figures = require('figures');
const ora = require('ora');
const API = require('../utils/api');

// Service status command
const status = new Command('status')
    .description('Check service status')
    .option('-v, --verbose', 'Show detailed status')
    .action(async (options) => {
        try {
            const health = await API.get('/health');
            console.log(chalk.bold('\nService Status:'));
            console.log(chalk.cyan('Status:'), health.status);
            console.log(chalk.cyan('Version:'), process.env.VERSION);
            console.log(chalk.cyan('Timestamp:'), health.timestamp);

            if (options.verbose) {
                try {
                    const metrics = await API.get('/metrics');
                    console.log('\n', chalk.bold('Detailed Metrics:'));
                    console.table({
                        'CPU Usage': metrics.cpu.usage,
                        'Memory Used': metrics.memory.heapUsed,
                        'Total Memory': metrics.memory.heapTotal,
                        'Requests/min': metrics.requests.perMinute,
                        'Avg Response Time': `${metrics.requests.avgResponseTime}ms`
                    });
                } catch (metricError) {
                    console.log(chalk.yellow('\nDetailed metrics unavailable:', metricError.message));
                }
            }
        } catch (error) {
            console.error(chalk.red('Failed to fetch service status:', error.message));
        }
    });

// Add interactive mode support
status.runInteractive = async function() {
    const spinner = ora('Fetching service status...').start();
    
    try {
        const health = await API.get('/health');
        spinner.succeed('Service status retrieved');
        
        console.log(chalk.bold('\nService Status:'));
        console.log(chalk.cyan('Status:'), health.status);
        console.log(chalk.cyan('Version:'), process.env.VERSION);
        console.log(chalk.cyan('Timestamp:'), health.timestamp);
        
        const { showDetailed } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'showDetailed',
                message: 'Show detailed metrics?',
                default: false,
                prefix: chalk.cyan(figures.info)
            }
        ]);
        
        if (showDetailed) {
            spinner.text = 'Fetching detailed metrics...';
            spinner.start();
            
            try {
                const metrics = await API.get('/metrics');
                spinner.succeed('Metrics retrieved');
                
                console.log('\n', chalk.bold('Detailed Metrics:'));
                console.table({
                    'CPU Usage': metrics.cpu.usage,
                    'Memory Used': metrics.memory.heapUsed,
                    'Total Memory': metrics.memory.heapTotal,
                    'Requests/min': metrics.requests.perMinute,
                    'Avg Response Time': `${metrics.requests.avgResponseTime}ms`
                });
            } catch (metricError) {
                spinner.fail('Could not retrieve detailed metrics');
                console.log(chalk.yellow('\nDetailed metrics unavailable:', metricError.message));
            }
        }
    } catch (error) {
        spinner.fail('Failed to fetch service status');
        console.error(chalk.red('Error:', error.message));
    }
};

// Service metrics command
const metrics = new Command('metrics')
    .description('View service metrics')
    .option('-t, --time <period>', 'Time period (hour/day/week)', 'hour')
    .action(async (options) => {
        try {
            const data = await API.get(`/metrics?period=${options.time}`);
            
            console.log(chalk.bold('\nPerformance Metrics:'));
            console.log(chalk.cyan('\nResource Usage:'));
            console.table({
                'CPU Usage': data.cpu.usage,
                'Memory Used': data.memory.heapUsed,
                'Memory Total': data.memory.heapTotal,
                'RSS Memory': data.memory.rss,
                'External Memory': data.memory.external
            });

            console.log(chalk.cyan('\nRequest Statistics:'));
            console.table({
                'Total Requests': data.requests.total,
                'Success Rate': data.requests.successRate + '%',
                'Avg Response Time': data.requests.avgResponseTime + 'ms',
                'Error Rate': data.requests.errorRate + '%',
                'Requests/min': data.requests.perMinute.toFixed(2)
            });
            
            if (data.topEndpoints && Object.keys(data.topEndpoints).length > 0) {
                console.log(chalk.cyan('\nTop Endpoints:'));
                const endpointTable = {};
                Object.entries(data.topEndpoints).forEach(([endpoint, stats]) => {
                    endpointTable[endpoint] = {
                        'Requests': stats.count,
                        'Avg Time (ms)': stats.avgResponseTime
                    };
                });
                console.table(endpointTable);
            }
        } catch (error) {
            console.error(chalk.red('Failed to fetch metrics:', error.message));
        }
    });

// Add interactive mode support
metrics.runInteractive = async function() {
    const periods = ['hour', 'day', 'week'];
    
    const { selectedPeriod } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedPeriod',
            message: 'Select time period for metrics:',
            choices: periods.map(p => ({
                name: p.charAt(0).toUpperCase() + p.slice(1),
                value: p
            })),
            prefix: chalk.cyan(figures.bar)
        }
    ]);
    
    const spinner = ora(`Fetching ${selectedPeriod} metrics...`).start();
    
    try {
        const data = await API.get(`/metrics?period=${selectedPeriod}`);
        spinner.succeed('Metrics retrieved');
        
        console.log(chalk.bold('\nPerformance Metrics:'));
        console.log(chalk.cyan('\nResource Usage:'));
        console.table({
            'CPU Usage': data.cpu.usage,
            'Memory Used': data.memory.heapUsed,
            'Memory Total': data.memory.heapTotal,
            'RSS Memory': data.memory.rss,
            'External Memory': data.memory.external
        });

        console.log(chalk.cyan('\nRequest Statistics:'));
        console.table({
            'Total Requests': data.requests.total,
            'Success Rate': data.requests.successRate + '%',
            'Avg Response Time': data.requests.avgResponseTime + 'ms',
            'Error Rate': data.requests.errorRate + '%',
            'Requests/min': data.requests.perMinute.toFixed(2)
        });
        
        if (data.topEndpoints && Object.keys(data.topEndpoints).length > 0) {
            console.log(chalk.cyan('\nTop Endpoints:'));
            const endpointTable = {};
            Object.entries(data.topEndpoints).forEach(([endpoint, stats]) => {
                endpointTable[endpoint] = {
                    'Requests': stats.count,
                    'Avg Time (ms)': stats.avgResponseTime
                };
            });
            console.table(endpointTable);
        }
        
        if (data.slowestEndpoints && data.slowestEndpoints.length > 0) {
            console.log(chalk.cyan('\nSlowest Endpoints:'));
            console.table(data.slowestEndpoints.map(item => ({
                'Endpoint': item.endpoint,
                'Response Time (ms)': item.responseTime,
                'Timestamp': new Date(item.timestamp).toLocaleTimeString()
            })));
        }
    } catch (error) {
        spinner.fail('Failed to fetch metrics');
        console.error(chalk.red('Error:', error.message));
    }
};

// Route information command
const routes = new Command('routes')
    .description('List API routes')
    .option('-v, --version <version>', 'API version', 'v1')
    .action(async (options) => {
        try {
            try {
                const versions = await API.get('/versions');
                if (!versions.versions.includes(options.version)) {
                    console.warn(chalk.yellow(`Warning: API version ${options.version} not found in available versions. Available versions: ${versions.versions.join(', ')}`));
                }
            } catch (versionError) {
                // Silently continue if versions endpoint is not available
            }

            const routes = await API.get(`/${options.version}/routes`);
            console.log(chalk.bold(`\nAPI Routes (${options.version}):`));
            
            const groupedRoutes = routes.reduce((acc, route) => {
                const group = route.path.split('/')[1];
                if (!acc[group]) acc[group] = [];
                acc[group].push(route);
                return acc;
            }, {});

            for (const [group, routes] of Object.entries(groupedRoutes)) {
                console.log(chalk.cyan(`\n${group.toUpperCase()} Endpoints:`));
                console.table(
                    routes.map(r => ({
                        Method: r.method.toUpperCase(),
                        Path: r.path,
                        Protected: r.protected ? '✓' : '✗'
                    }))
                );
            }
        } catch (error) {
            console.error(chalk.red('Failed to fetch routes:', error.message));
        }
    });

// Add interactive mode support
routes.runInteractive = async function() {
    const spinner = ora('Fetching available API versions...').start();
    
    try {
        let versions = ['v1'];
        try {
            const versionData = await API.get('/versions');
            versions = versionData.versions || versions;
            spinner.succeed('Available API versions retrieved');
        } catch (versionError) {
            spinner.warn('Could not fetch available API versions, using default');
        }
        
        const { selectedVersion } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedVersion',
                message: 'Select API version:',
                choices: versions.map(v => ({
                    name: v,
                    value: v
                })),
                prefix: chalk.cyan(figures.arrowRight)
            }
        ]);
        
        spinner.text = `Fetching ${selectedVersion} routes...`;
        spinner.start();
        
        const routes = await API.get(`/${selectedVersion}/routes`);
        spinner.succeed('Routes retrieved');
        
        console.log(chalk.bold(`\nAPI Routes (${selectedVersion}):`));
        
        const groupedRoutes = routes.reduce((acc, route) => {
            const group = route.path.split('/')[1];
            if (!acc[group]) acc[group] = [];
            acc[group].push(route);
            return acc;
        }, {});

        for (const [group, routes] of Object.entries(groupedRoutes)) {
            console.log(chalk.cyan(`\n${group.toUpperCase()} Endpoints:`));
            console.table(
                routes.map(r => ({
                    Method: r.method.toUpperCase(),
                    Path: r.path,
                    Protected: r.protected ? '✓' : '✗'
                }))
            );
        }
    } catch (error) {
        spinner.fail('Failed to fetch routes');
        console.error(chalk.red('Error:', error.message));
    }
};

module.exports = {
    status,
    metrics,
    routes
};