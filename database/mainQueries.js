const LogManager = require('../managers/LogManager');

function initializeQueries() {
    LogManager.warn('Default queries not set up yet!');
}

module.exports = { initializeQueries };