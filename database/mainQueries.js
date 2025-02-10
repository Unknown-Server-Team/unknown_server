const LogManager = require('../managers/LogManager');

function initializeQueries() {
    LogManager.warning('Default queries not set up yet!', {
        hint: 'Configure your queries in database/mainQueries.js'
    });
}

module.exports = { initializeQueries };