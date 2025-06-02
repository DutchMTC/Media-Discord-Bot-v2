const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { readConfig, writeConfig } = require('../utils/configHelper');
const twitchService = require('../services/twitchService');
const youtubeService = require('../services/youtubeService');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing ${interaction.commandName}`);
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_tracked_user') {
                const selectedUserId = interaction.values[0];
                try {
                    const user = await interaction.client.users.fetch(selectedUserId);

                    const viewButton = new ButtonBuilder()
                        .setCustomId(`view_user_channels_${selectedUserId}`)
                        .setLabel('View Channels')
                        .setStyle(ButtonStyle.Primary);

                    const addButton = new ButtonBuilder()
                        .setCustomId(`add_user_channel_${selectedUserId}`)
                        .setLabel('Add Channel')
                        .setStyle(ButtonStyle.Success);

                    const removeButton = new ButtonBuilder()
                        .setCustomId(`remove_user_channel_${selectedUserId}`)
                        .setLabel('Remove Channel')
                        .setStyle(ButtonStyle.Danger);

                    const row = new ActionRowBuilder()
                        .addComponents(viewButton, addButton, removeButton);

                    await interaction.reply({
                        content: `Managing channels for **${user.username}**. What would you like to do?`,
                        components: [row],
                        ephemeral: true,
                    });
                } catch (error) {
                    console.error('Error fetching user or replying to select menu interaction:', error);
                    await interaction.reply({ content: 'There was an error processing your selection.', ephemeral: true });
                }
            } else if (interaction.customId.startsWith('select_channel_to_remove_')) {
                const targetUserId = interaction.customId.substring('select_channel_to_remove_'.length);
                const selectedValue = interaction.values[0];
                // const [platformToRemove, channelIdToRemove] = selectedValue.split('_'); // Old logic
                const parts = selectedValue.split('_');
                const platformToRemove = parts.shift(); // Extracts the first part (platform)
                const channelIdToRemove = parts.join('_'); // Joins all remaining parts to form the full channel ID

                console.log(`[InteractionCreate] Selected value for removal: ${selectedValue}`);
                console.log(`[InteractionCreate] Extracted platformToRemove: ${platformToRemove}`);
                console.log(`[InteractionCreate] Extracted channelIdToRemove: ${channelIdToRemove}`);

                try {
                    const user = await interaction.client.users.fetch(targetUserId);
                    let config = await readConfig();
                    const initialChannelCount = config.trackedChannels ? config.trackedChannels.length : 0;

                    config.trackedChannels = (config.trackedChannels || []).filter(channel =>
                        !(channel.targetUserId === targetUserId &&
                          channel.platform === platformToRemove &&
                          channel.channelId === channelIdToRemove)
                    );

                    const channelRemoved = config.trackedChannels.length < initialChannelCount;

                    if (channelRemoved) {
                        await writeConfig(config);
                        // Attempt to find the channel name for a friendlier message, fallback to ID
                        // This part is a bit tricky as the original channelName might not be in selectedValue
                        // For simplicity, we'll use platform and ID.
                        // If channelName was consistently part of the value or easily retrievable, it could be used.
                        await interaction.reply({
                            content: `Successfully removed **${platformToRemove} - ${channelIdToRemove}** from being tracked for user **${user.username}**.`,
                            ephemeral: true,
                        });
                    } else {
                        // This case should ideally not be reached if the select menu is populated correctly
                        await interaction.reply({
                            content: `Could not find the specified channel (${platformToRemove} - ${channelIdToRemove}) for user **${user.username}** to remove. It might have been already removed.`,
                            ephemeral: true,
                        });
                    }
                } catch (error) {
                    console.error('Error processing select_channel_to_remove_ interaction:', error);
                    await interaction.reply({ content: 'There was an error removing the channel.', ephemeral: true });
                }
            }
        } else if (interaction.isButton()) {
            if (interaction.customId.startsWith('view_user_channels_')) {
                const targetUserId = interaction.customId.split('_').pop();
                try {
                    const user = await interaction.client.users.fetch(targetUserId);
                    const config = await readConfig();
                    const trackedChannels = config.trackedChannels || [];

                    const userChannels = trackedChannels.filter(channel => channel.targetUserId === targetUserId);

                    if (userChannels.length === 0) {
                        await interaction.reply({
                            content: `No channels are currently monitored for **${user.username}**.`,
                            ephemeral: true,
                        });
                        return;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`Monitored Channels for ${user.username}`)
                        .setColor(0x00AE86);

                    let description = '';
                    userChannels.forEach(channel => {
                        description += `${channel.platform} - ${channel.channelName || channel.channelId} (ID: ${channel.channelId})\n`;
                    });
                    embed.setDescription(description);

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true,
                    });

                } catch (error) {
                    console.error('Error processing view_user_channels interaction:', error);
                    await interaction.reply({ content: 'There was an error retrieving the channel list.', ephemeral: true });
                }
            } else if (interaction.customId.startsWith('add_user_channel_')) {
                const targetUserId = interaction.customId.split('_').pop();
                try {
                    const user = await interaction.client.users.fetch(targetUserId); // Fetch user for username
                    const modal = new ModalBuilder()
                        .setCustomId(`add_channel_modal_${targetUserId}`)
                        .setTitle(`Add Channel for ${user.username}`);

                    const platformInput = new TextInputBuilder()
                        .setCustomId('platform_input')
                        .setLabel("Platform (Twitch or YouTube)")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const channelLinkInput = new TextInputBuilder()
                        .setCustomId('channellink_input')
                        .setLabel("Channel Link or ID")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    const firstActionRow = new ActionRowBuilder().addComponents(platformInput);
                    const secondActionRow = new ActionRowBuilder().addComponents(channelLinkInput);

                    modal.addComponents(firstActionRow, secondActionRow);

                    await interaction.showModal(modal);
                } catch (error) {
                    console.error('Error creating or showing add channel modal:', error);
                    await interaction.reply({ content: 'There was an error preparing the form to add a channel.', ephemeral: true });
                }
            } else if (interaction.customId.startsWith('remove_user_channel_')) {
                const targetUserId = interaction.customId.split('_').pop();
                try {
                    const user = await interaction.client.users.fetch(targetUserId);
                    const config = await readConfig();
                    const trackedChannels = config.trackedChannels || [];

                    const userChannelsToRemove = trackedChannels.filter(channel => channel.targetUserId === targetUserId);

                    if (userChannelsToRemove.length === 0) {
                        await interaction.reply({
                            content: `No channels are currently monitored for **${user.username}** to remove.`,
                            ephemeral: true,
                        });
                        return;
                    }

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`select_channel_to_remove_${targetUserId}`)
                        .setPlaceholder('Select a channel to remove');

                    userChannelsToRemove.forEach(channel => {
                        selectMenu.addOptions({
                            label: `${channel.platform} - ${channel.channelName || channel.channelId}`,
                            value: `${channel.platform}_${channel.channelId}`,
                            description: `ID: ${channel.channelId}`,
                        });
                    });

                    const row = new ActionRowBuilder().addComponents(selectMenu);

                    await interaction.reply({
                        content: `Select a channel to remove for **${user.username}**:`,
                        components: [row],
                        ephemeral: true,
                    });

                } catch (error) {
                    console.error('Error processing remove_user_channel interaction:', error);
                    await interaction.reply({ content: 'There was an error preparing the channel removal list.', ephemeral: true });
                }
            }
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('add_channel_modal_')) {
                const targetUserId = interaction.customId.split('_').pop();
                const platform = interaction.fields.getTextInputValue('platform_input').trim();
                const channelLinkOrId = interaction.fields.getTextInputValue('channellink_input').trim();

                let normalizedPlatform;
                if (platform.toLowerCase() === 'twitch') {
                    normalizedPlatform = 'Twitch';
                } else if (platform.toLowerCase() === 'youtube') {
                    normalizedPlatform = 'YouTube';
                } else {
                    await interaction.reply({ content: 'Invalid platform. Please enter "Twitch" or "YouTube".', ephemeral: true });
                    return;
                }

                try {
                    let resolvedChannelId;
                    let channelName;
                    let targetUser;

                    try {
                        targetUser = await interaction.client.users.fetch(targetUserId);
                    } catch (fetchError) {
                        console.error(`Error fetching target user ${targetUserId}:`, fetchError);
                        await interaction.reply({ content: 'Could not find the user to add the channel for.', ephemeral: true });
                        return;
                    }


                    if (normalizedPlatform === 'Twitch') {
                        const twitchChannelInfo = await twitchService.getChannelInfo(channelLinkOrId);
                        if (!twitchChannelInfo || !twitchChannelInfo.id) {
                            await interaction.reply({ content: `Could not find or verify the Twitch channel: ${channelLinkOrId}. Please check the channel name or link.`, ephemeral: true });
                            return;
                        }
                        resolvedChannelId = twitchChannelInfo.id;
                        channelName = twitchChannelInfo.display_name;
                    } else if (normalizedPlatform === 'YouTube') {
                        // The resolveYouTubeIdentifierToChannelId function now returns { channelId, channelName } or null
                        const resolvedInfo = await youtubeService.resolveYouTubeIdentifierToChannelId(channelLinkOrId);

                        if (!resolvedInfo || !resolvedInfo.channelId) {
                            await interaction.reply({ content: `Could not find or verify the YouTube channel: ${channelLinkOrId}. Please check the channel link, handle, or ID.`, ephemeral: true });
                            return;
                        }
                        resolvedChannelId = resolvedInfo.channelId;
                        channelName = resolvedInfo.channelName; // This should now be populated
                    }

                    const config = await readConfig();
                    if (!config.trackedChannels) {
                        config.trackedChannels = [];
                    }

                    const existingChannel = config.trackedChannels.find(
                        ch => ch.platform === normalizedPlatform && ch.channelId === resolvedChannelId && ch.targetUserId === targetUserId
                    );

                    if (existingChannel) {
                        await interaction.reply({ content: `The ${normalizedPlatform} channel **${channelName}** is already being tracked for ${targetUser.username}.`, ephemeral: true });
                        return;
                    }

                    config.trackedChannels.push({
                        platform: normalizedPlatform,
                        channelId: resolvedChannelId,
                        channelName: channelName,
                        channelLink: channelLinkOrId, // Original input
                        targetUserId: targetUserId,
                    });

                    await writeConfig(config);

                    await interaction.reply({
                        content: `Successfully added ${normalizedPlatform} channel **${channelName}** for user **${targetUser.username}**.`,
                        ephemeral: true,
                    });

                } catch (error) {
                    console.error('Error processing add_channel_modal submission:', error);
                    await interaction.reply({ content: 'There was an error adding the channel. Please try again.', ephemeral: true });
                }
            }
        }
    },
};