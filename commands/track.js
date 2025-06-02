const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const { readConfig, writeConfig } = require('../utils/configHelper.js');
const { resolveYouTubeIdentifierToChannelId } = require('../services/youtubeService.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('track')
        .setDescription('Adds a Twitch or YouTube channel to the monitoring list.')
        .addStringOption(option =>
            option.setName('platform')
                .setDescription('The platform of the channel.')
                .setRequired(true)
                .addChoices(
                    { name: 'Twitch', value: 'Twitch' },
                    { name: 'YouTube', value: 'YouTube' },
                ))
        .addStringOption(option =>
            option.setName('channel_link')
                .setDescription('The URL of the streamer\'s channel.')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('target_user')
                .setDescription('The Discord user whose ID is used for data storage.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const platform = interaction.options.getString('platform');
        const channelLink = interaction.options.getString('channel_link');
        const targetUser = interaction.options.getUser('target_user');

        try {
            const config = await readConfig();

            let channelId = channelLink; // Default to full link
            let resolvedChannelName = 'N/A'; // Default name

            if (platform === 'Twitch') {
                const match = channelLink.match(/twitch\.tv\/([^/?#&]+)/);
                if (match && match[1]) {
                    channelId = match[1]; // This is the Twitch username/login
                    resolvedChannelName = channelId; // For Twitch, username is often used as display name
                } else {
                    // If it's not a full URL, assume it's the channel name/ID directly
                    channelId = channelLink; // Use the input as is if not a URL
                    resolvedChannelName = channelLink;
                }
            } else if (platform === 'YouTube') {
                // The resolveYouTubeIdentifierToChannelId function now handles various inputs including full URLs, handles, IDs.
                // We pass the raw channelLink directly to it.
                console.log(`[TrackCommand] Attempting to resolve YouTube identifier using provided input: "${channelLink}"`);
                const resolvedInfo = await resolveYouTubeIdentifierToChannelId(channelLink);

                if (resolvedInfo && resolvedInfo.channelId) {
                    channelId = resolvedInfo.channelId;
                    resolvedChannelName = resolvedInfo.channelName; // Store the resolved channel name
                    console.log(`[TrackCommand] Successfully resolved to YouTube Channel ID: "${channelId}", Name: "${resolvedChannelName}"`);
                } else {
                    await interaction.reply({ content: `Could not find or verify a valid YouTube channel for the provided link/identifier: "${channelLink}". Please ensure it's a correct channel URL, handle, or ID.`, ephemeral: true });
                    return; // Stop execution if resolution fails
                }
            }

            const newChannel = {
                platform: platform,
                channelId: channelId, // This is the canonical ID for YouTube, or username/login for Twitch
                channelName: resolvedChannelName, // The resolved/fetched name for YouTube, or Twitch username
                channelLink: channelLink, // Original link for reference or display
                targetUserId: targetUser.id,
            };

            if (!config.trackedChannels) {
                config.trackedChannels = [];
            }

            // Check for duplicates before adding
            const existingChannel = config.trackedChannels.find(
                ch => ch.platform === platform &&
                      ch.channelId === channelId &&
                      ch.targetUserId === targetUser.id
            );

            if (existingChannel) {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Yellow)
                    .setTitle('Channel Already Tracked')
                    .setDescription(`This ${platform} channel is already being tracked for ${targetUser}.`)
                    .addFields(
                        { name: 'Platform', value: platform, inline: true },
                        { name: 'Channel Name', value: resolvedChannelName, inline: true },
                        { name: 'Tracked For', value: `${targetUser}`, inline: true },
                        { name: 'Original Link', value: channelLink }
                    )
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
                return;
            }
            
            config.trackedChannels.push(newChannel);

            await writeConfig(config);

            const successEmbed = new EmbedBuilder()
                .setTitle('Channel Tracking Added')
                .setDescription(`Successfully started tracking a new channel.`)
                .addFields(
                    { name: 'Platform', value: platform, inline: true },
                    { name: 'Channel Name', value: `[${resolvedChannelName}](${platform === 'Twitch' ? `https://twitch.tv/${newChannel.channelId}` : `https://youtube.com/channel/${newChannel.channelId}`})`, inline: true },
                    { name: 'Tracked For', value: `${targetUser}`, inline: true },
                    { name: 'Original Input', value: channelLink }
                )
                .setTimestamp();

            if (platform === 'Twitch') {
                successEmbed.setColor(Colors.Purple);
            } else if (platform === 'YouTube') {
                successEmbed.setColor(Colors.Red);
            }

            await interaction.reply({ embeds: [successEmbed] });
        } catch (error) {
            console.error('Error executing track command:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setTitle('Error Tracking Channel')
                .setDescription('An error occurred while trying to add the channel. Please check the logs.')
                .setTimestamp();
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },
};