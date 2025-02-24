const { Command } = require('commander');
const chalk = require('chalk');
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
            console.log(chalk.cyan('Version:'), process.env.VERSION || '2.2.0');
            console.log(chalk.cyan('Timestamp:'), health.timestamp);

            if (options.verbose) {
                const metrics = await API.get('/metrics');
                console.log('\n', chalk.bold('Detailed Metrics:'));
                console.table({
                    'CPU Usage': `${metrics.cpu.usage}%`,
                    'Memory Used': `${metrics.memory.heapUsed}`,
                    'Total Memory': `${metrics.memory.heapTotal}`,
                    'Requests/min': metrics.requests.perMinute,
                    'Avg Response Time': `${metrics.requests.avgResponseTime}ms`
                });
            }
        } catch (error) {
            console.error(chalk.red('Failed to fetch service status:', error.message));
        }
    });

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
                'CPU Usage': `${data.cpu.usage}%`,
                'Memory Usage': `${data.memory.used} / ${data.memory.total}`,
                'Disk Usage': `${data.disk.used} / ${data.disk.total}`
            });

            console.log(chalk.cyan('\nRequest Statistics:'));
            console.table({
                'Total Requests': data.requests.total,
                'Success Rate': `${data.requests.successRate}%`,
                'Avg Response Time': `${data.requests.avgResponseTime}ms`,
                'Error Rate': `${data.requests.errorRate}%`
            });
        } catch (error) {
            console.error(chalk.red('Failed to fetch metrics:', error.message));
        }
    });

// Route information command
const routes = new Command('routes')
    .description('List API routes')
    .option('-v, --version <version>', 'API version', 'v1')
    .action(async (options) => {
        try {
            const versions = await API.get('/versions');
            if (!versions.versions.includes(options.version)) {
                throw new Error(`Invalid API version. Available versions: ${versions.versions.join(', ')}`);
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

module.exports = {
    status,
    metrics,
    routes
};