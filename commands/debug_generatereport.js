const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const reportService = require('../services/reportService.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forcegeneratereport')
        .setDescription('Manually generates and sends the monthly activity report.')
        .addIntegerOption(option =>
            option.setName('year')
                .setDescription('The year for the report (e.g., 2023).')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('month')
                .setDescription('The month for the report (1-12).')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(12))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const inputYear = interaction.options.getInteger('year');
            const inputMonth = interaction.options.getInteger('month'); // 1-12

            let yearToReport;
            let monthToReportOneIndexed;

            if (inputYear && inputMonth) {
                yearToReport = inputYear;
                monthToReportOneIndexed = inputMonth;
            } else {
                // Default to the previous month
                const now = new Date();
                yearToReport = now.getFullYear();
                let previousMonthZeroIndexed = now.getMonth() - 1; // 0-11 for Jan-Dec

                if (previousMonthZeroIndexed < 0) { // If current month was January (0), previous month was December (11) of last year
                    previousMonthZeroIndexed = 11; // December
                    yearToReport -= 1;
                }
                monthToReportOneIndexed = previousMonthZeroIndexed + 1; // Convert 0-11 to 1-12
            }

            const resultMessage = await reportService.generateReport(interaction.client, yearToReport, monthToReportOneIndexed);
            await interaction.followUp({ content: resultMessage || `Successfully triggered report generation for ${yearToReport}-${String(monthToReportOneIndexed).padStart(2, '0')}.`, ephemeral: true });

        } catch (error) {
            console.error('Error executing /debug_generatereport command:', error.message || error);
            const errorMessage = error.message || 'There was an error while trying to generate the report.';
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    },
};