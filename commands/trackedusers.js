const { SlashCommandBuilder, PermissionFlagsBits, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const { readConfig } = require('../utils/configHelper.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trackedusers')
        .setDescription('Lists users with tracked channels for management.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const config = readConfig();
        console.log('[TrackedUsersCommand] Raw config object from readConfig():', JSON.stringify(config, null, 2));
        const trackedChannels = config.trackedChannels || [];
        console.log('[TrackedUsersCommand] Extracted trackedChannels array:', JSON.stringify(trackedChannels, null, 2));

        console.log('[TrackedUsersCommand] Length of trackedChannels array before check:', trackedChannels.length);
        if (trackedChannels.length === 0) {
            return interaction.reply({ content: 'No users are currently tracking any channels.', ephemeral: true });
        }

        const uniqueUserIds = [...new Set(trackedChannels.map(channel => channel.targetUserId))];

        if (uniqueUserIds.length === 0) {
            return interaction.reply({ content: 'No unique users found tracking channels.', ephemeral: true });
        }

        const userOptions = [];
        for (const userId of uniqueUserIds) {
            try {
                const user = await interaction.client.users.fetch(userId);
                userOptions.push({
                    label: user.username,
                    value: user.id,
                    description: `Manage channels for ${user.username}`,
                });
            } catch (error) {
                console.error(`Failed to fetch user ${userId}:`, error);
                // Optionally, add a placeholder or skip this user
                userOptions.push({
                    label: `User ID: ${userId} (not found)`,
                    value: userId,
                    description: 'Could not fetch user details.',
                });
            }
        }

        if (userOptions.length === 0) {
            return interaction.reply({ content: 'Could not fetch details for any tracked users.', ephemeral: true });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_tracked_user')
            .setPlaceholder('Select a user')
            .addOptions(userOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: 'Select a user to manage their tracked channels:',
            components: [row],
            ephemeral: true, // Recommended for admin commands
        });
    },
};