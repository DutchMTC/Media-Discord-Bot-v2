const { triggerStreamCheckAndSave } = require('../services/streamMonitorService');
const { readConfig } = require('../utils/configHelper');
const { scheduleMonthlyReport } = require('../services/reportService');

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) { // Made execute async
        console.log(`Ready! Logged in as ${client.user.tag}`);
        scheduleMonthlyReport(client);

        const config = readConfig();
        const streamCheckIntervalMinutes = config.streamCheckIntervalMinutes || 15; // Default to 15 mins if not set
        const checkIntervalMs = streamCheckIntervalMinutes * 60 * 1000;

        // Perform an initial check immediately
        // Pass the client instance to triggerStreamCheckAndSave
        await triggerStreamCheckAndSave(client);

        // Set up the interval for periodic checks
        // Pass the client instance to triggerStreamCheckAndSave
        setInterval(() => triggerStreamCheckAndSave(client), checkIntervalMs);
        console.log(`Stream checks will be performed every ${streamCheckIntervalMinutes} minutes.`);
    },
};