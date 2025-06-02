const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { triggerStreamCheckAndSave } = require('../services/streamMonitorService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forcecheckstreams')
        .setDescription('Manually triggers a check for all tracked streams and saves data.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        // Defer reply to avoid timeout for longer operations, and make it ephemeral
        await interaction.deferReply({ ephemeral: true });

        console.log(`[${new Date().toISOString()}] /debug_checkstreams command invoked by ${interaction.user.tag} (ID: ${interaction.user.id})`);

        try {
            // Pass the client instance (interaction.client) and true for isManualCheck to triggerStreamCheckAndSave
            await triggerStreamCheckAndSave(interaction.client, true);
            await interaction.editReply({ content: 'Stream check manually triggered with debug announcements. See console for details and progress.', ephemeral: true });
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error executing /debug_checkstreams command:`, error);
            // Ensure a reply is sent even if an error occurs during the main operation
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: 'An error occurred while triggering the stream check. Please check the logs.', ephemeral: true });
            } else {
                // This case should ideally not happen if deferReply was successful
                await interaction.reply({ content: 'An error occurred. Please check the logs.', ephemeral: true });
            }
        }
    },
};