const twitchService = require('./twitchService');
const youtubeService = require('./youtubeService');
const configHelper = require('../utils/configHelper');
const dataManager = require('../utils/dataManager');
const { EmbedBuilder, Colors } = require('discord.js');

const announcedStreams = new Map();
const DEFAULT_ANNOUNCEMENT_COOLDOWN_MINUTES = 15;

/**
 * Checks all tracked channels for live streams, filters them by title, prepares data, and handles announcements.
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {boolean} [isManualCheck=false] - Whether the check is manually triggered.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of "munchy" live stream data objects.
 */
async function checkAllTrackedChannels(client, isManualCheck = false) {
    const liveMunchyStreams = [];
    let config;

    try {
        config = await configHelper.readConfig();
    } catch (error) {
        console.error('Error reading configuration in streamMonitorService:', error);
        return []; // Return empty if config fails to load
    }

    if (!config || !config.trackedChannels || config.trackedChannels.length === 0) {
        console.log('No tracked channels found in configuration.');
        return [];
    }

    const announcementCooldownMs = (config.announcementCooldownMinutes || DEFAULT_ANNOUNCEMENT_COOLDOWN_MINUTES) * 60 * 1000;

    for (const channel of config.trackedChannels) {
        try {
            let streamDetails;
            if (channel.platform === 'Twitch') {
                streamDetails = await twitchService.getStreamStatus(channel.channelId);
            } else if (channel.platform === 'YouTube') {
                streamDetails = await youtubeService.getStreamStatus(channel.channelId);
            } else {
                console.warn(`Unsupported platform: ${channel.platform} for channelId: ${channel.channelId}`);
                continue;
            }

            if (streamDetails && streamDetails.isLive) {
                console.log(`[StreamMonitor] Live stream found for ${channel.platform} channel ${channel.channelName} (User: ${channel.targetUserId}): Title - "${streamDetails.title}"`);
                if (streamDetails.title && streamDetails.title.toLowerCase().includes('munchy')) {
                    const streamData = {
                        streamUrl: streamDetails.streamUrl,
                        startedAt: streamDetails.startedAt,
                        title: streamDetails.title,
                        platform: channel.platform,
                        streamerChannelId: channel.channelId,
                        targetUserId: channel.targetUserId,
                        channelName: channel.channelName,
                        thumbnailUrl: streamDetails.thumbnailUrl
                    };
                    liveMunchyStreams.push(streamData);

                    const streamId = `${channel.platform}_${channel.channelId}`; // Cooldown per streamer

                    // Prevent re-announcement of already known streams on startup/regular checks
                    if (!isManualCheck) {
                        try {
                            // Use streamerChannelId from streamData as it's consistent
                            const userActivity = await dataManager.readUserActivity(streamData.targetUserId, streamData.platform, streamData.streamerChannelId);
                            if (userActivity && userActivity.streamSessions) {
                                const alreadyKnownStream = userActivity.streamSessions.find(
                                    session => session.startedAt === streamData.startedAt
                                );
                                if (alreadyKnownStream) {
                                    // This specific stream instance was already saved.
                                    // Prime the announcement cooldown for this streamer as if it was just announced by this session.
                                    announcedStreams.set(streamId, Date.now());
                                    console.log(`[StreamMonitor] Stream ${streamData.channelName} (started: ${new Date(streamData.startedAt).toISOString()}) already known. Priming cooldown, no new announcement on this cycle.`);
                                }
                            }
                        } catch (error) {
                            console.error(`[StreamMonitor] Error checking existing stream sessions for ${streamData.channelName} (ID: ${streamData.streamerChannelId}):`, error);
                        }
                    }

                    // Announcement logic
                    const now = Date.now();
                    const lastAnnouncedTime = announcedStreams.get(streamId) || 0;
                    let shouldAnnounce = false;

                    if (isManualCheck) {
                        shouldAnnounce = true;
                        console.log(`[StreamMonitor] Manual check for ${streamData.channelName}, bypassing cooldown for announcement.`);
                    } else {
                        if (now - lastAnnouncedTime > announcementCooldownMs) {
                            shouldAnnounce = true;
                        } else {
                            console.log(`[StreamMonitor] Munchy stream for ${streamData.channelName} is on announcement cooldown. Last announced: ${new Date(lastAnnouncedTime).toISOString()}, Next possible: ${new Date(lastAnnouncedTime + announcementCooldownMs).toISOString()}`);
                        }
                    }

                    if (shouldAnnounce) {
                        if (client && config.munchyStreamChannelId) {
                            try {
                                const munchyStreamChannel = await client.channels.fetch(config.munchyStreamChannelId);
                                if (munchyStreamChannel && munchyStreamChannel.isTextBased()) {
                                    const embed = new EmbedBuilder()
                                        .setTitle(`${streamData.channelName} just went live on MunchyMC!`)
                                        .setURL(streamData.streamUrl)
                                        .addFields(
                                            { name: 'Discord User', value: `<@${streamData.targetUserId}>` },
                                            { name: 'Title', value: streamData.title },
                                            { name: 'Link', value: streamData.streamUrl }
                                        )
                                        .setTimestamp(); // Sets to current time (detection time)

                                     if (streamData.platform === 'YouTube') {
                                         embed.setColor(Colors.Red);
                                     } else if (streamData.platform === 'Twitch') {
                                         embed.setColor(Colors.Purple);
                                     }

                                     if (streamData.thumbnailUrl) {
                                         embed.setThumbnail(streamData.thumbnailUrl);
                                     }

                                     // Add "Streams this month" to footer
                                     let streamsThisMonthCount = 0;
                                     try {
                                        const channelIdInConfig = streamData.streamerChannelId; // channel.channelId from the loop
                                        const userActivity = await dataManager.readUserActivity(streamData.targetUserId, streamData.platform, channelIdInConfig);
                                        if (userActivity && userActivity.streamSessions) {
                                            const currentDate = new Date();
                                            const currentYear = currentDate.getFullYear();
                                            const currentMonth = currentDate.getMonth(); // 0-indexed

                                            streamsThisMonthCount = userActivity.streamSessions.filter(session => {
                                                const sessionDate = new Date(session.startedAt);
                                                return sessionDate.getFullYear() === currentYear && sessionDate.getMonth() === currentMonth;
                                            }).length;
                                        }
                                     } catch (error) {
                                         console.error(`[StreamMonitor] Error reading user activity for footer:`, error);
                                         // streamsThisMonthCount remains 0
                                     }
                                     embed.setFooter({ text: `Streams this month: ${streamsThisMonthCount}` });
                                     // embed.setTimestamp() is already called and will be placed after the footer text by Discord.js

                                     let messageContent = isManualCheck ? "**DEBUG ANNOUNCEMENT:**" : null;

                                     await munchyStreamChannel.send({ content: messageContent, embeds: [embed] })
                                        .then(() => {
                                            if (!isManualCheck) {
                                                announcedStreams.set(streamId, now);
                                                console.log(`[${new Date().toISOString()}] Announced munchy stream for ${streamData.channelName} (Regular) to ${config.munchyStreamChannelId}. Cooldown updated.`);
                                            } else {
                                                console.log(`[${new Date().toISOString()}] Sent DEBUG ANNOUNCEMENT for ${streamData.channelName} to ${config.munchyStreamChannelId}. Cooldown not affected.`);
                                            }
                                        })
                                        .catch(sendError => {
                                            console.error(`[${new Date().toISOString()}] Error sending munchy stream announcement for ${streamData.channelName} to ${config.munchyStreamChannelId}:`, sendError);
                                        });
                                } else {
                                    console.warn(`[${new Date().toISOString()}] Munchy stream announce channel ${config.munchyStreamChannelId} not found or not a text channel.`);
                                }
                            } catch (fetchChannelError) {
                                console.error(`[${new Date().toISOString()}] Error fetching munchy stream announce channel ${config.munchyStreamChannelId}:`, fetchChannelError);
                            }
                        } else {
                            console.warn(`[${new Date().toISOString()}] Cannot announce munchy stream: Client missing or munchyStreamChannelId not configured.`);
                        }
                    }
                }
            } else if (streamDetails && streamDetails.error) {
                console.error(`[StreamMonitor] Error checking ${channel.platform} channel ${channel.channelId}: ${streamDetails.error}`);
            }
        } catch (error) {
            console.error(`Error checking stream status for ${channel.platform} channel ${channel.channelId} (User: ${channel.targetUserId}):`, error);
        }
    }
    return liveMunchyStreams;
}

/**
 * Performs stream checks for all tracked channels and saves data for live "munchy" streams.
 * Announcements are handled by checkAllTrackedChannels.
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {boolean} [isManualCheck=false] - Whether the check is manually triggered.
 */
async function triggerStreamCheckAndSave(client, isManualCheck = false) {
    console.log(`[${new Date().toISOString()}] Triggering stream checks... (Manual: ${isManualCheck})`);
    try {
        const liveMunchyStreams = await checkAllTrackedChannels(client, isManualCheck);

        if (liveMunchyStreams && liveMunchyStreams.length > 0) {
            console.log(`[${new Date().toISOString()}] Found ${liveMunchyStreams.length} live "munchy" stream(s) during ${isManualCheck ? 'manual' : 'regular'} check.`);

            for (const streamData of liveMunchyStreams) {
                if (streamData && streamData.streamUrl && streamData.startedAt && streamData.targetUserId) {
                    await dataManager.saveStreamData(streamData); // wasNewStreamAdded is not used for announcements here
                } else {
                    console.warn(`[${new Date().toISOString()}] Invalid stream data object received, skipping save:`, streamData);
                }
            }
            console.log(`[${new Date().toISOString()}] Finished processing ${liveMunchyStreams.length} "munchy" stream(s) for saving.`);
        } else {
            console.log(`[${new Date().toISOString()}] No live "munchy" streams found during ${isManualCheck ? 'manual' : 'regular'} check.`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error during stream check and save (Manual: ${isManualCheck}):`, error);
    }
}

/**
 * Checks tracked channels for a specific user for live streams, filters them by title, prepares data, handles announcements, and saves data.
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {string} targetUserId - The Discord User ID to check streams for.
 * @returns {Promise<string>} A promise that resolves to a summary message of the check.
 */
async function checkUserStreams(client, targetUserId) {
    let config;
    try {
        config = await configHelper.readConfig();
    } catch (error) {
        console.error('[StreamMonitor] Error reading configuration in checkUserStreams:', error);
        return 'Error reading configuration. Cannot check streams.';
    }

    if (!config || !config.trackedChannels || config.trackedChannels.length === 0) {
        return 'No tracked channels found in configuration.';
    }

    const userChannels = config.trackedChannels.filter(ch => ch.targetUserId === targetUserId);

    if (userChannels.length === 0) {
        return `No channels are being tracked for the user <@${targetUserId}>.`;
    }

    console.log(`[StreamMonitor] Starting stream check for user ${targetUserId} across ${userChannels.length} channel(s).`);
    let liveMunchyStreamsFound = 0;
    let announcementsMade = 0;
    let errorsEncountered = 0;
    const announcementCooldownMs = (config.announcementCooldownMinutes || DEFAULT_ANNOUNCEMENT_COOLDOWN_MINUTES) * 60 * 1000;

    for (const channel of userChannels) {
        try {
            let streamDetails;
            if (channel.platform === 'Twitch') {
                streamDetails = await twitchService.getStreamStatus(channel.channelId);
            } else if (channel.platform === 'YouTube') {
                streamDetails = await youtubeService.getStreamStatus(channel.channelId);
            } else {
                console.warn(`[StreamMonitor] Unsupported platform: ${channel.platform} for channelId: ${channel.channelId} (User: ${targetUserId})`);
                errorsEncountered++;
                continue;
            }

            if (streamDetails && streamDetails.isLive) {
                console.log(`[StreamMonitor] Live stream found for ${channel.platform} channel ${channel.channelName} (User: ${targetUserId}): Title - "${streamDetails.title}"`);
                if (streamDetails.title && streamDetails.title.toLowerCase().includes('munchy')) {
                    liveMunchyStreamsFound++;
                    const streamData = {
                        streamUrl: streamDetails.streamUrl,
                        startedAt: streamDetails.startedAt,
                        title: streamDetails.title,
                        platform: channel.platform,
                        streamerChannelId: channel.channelId,
                        targetUserId: channel.targetUserId, // Should be the same as input targetUserId
                        channelName: channel.channelName,
                        thumbnailUrl: streamDetails.thumbnailUrl
                    };

                    // Save stream data first
                    await dataManager.saveStreamData(streamData);

                    // Announcement logic (always treat as manual for this specific user check)
                    const streamId = `${channel.platform}_${channel.channelId}`;
                    const now = Date.now();
                    const lastAnnouncedTime = announcedStreams.get(streamId) || 0;

                    // For a direct user check, we bypass the normal cooldown if it's a "munchy" stream
                    // but still respect a very short "just announced by this command" cooldown to avoid spam if command is run multiple times quickly.
                    // However, the primary goal is to announce if it's live and munchy.
                    // Let's simplify: if it's a munchy stream, announce it unless it was *just* announced by a previous call to *this specific user check*.
                    // The global announcedStreams map helps with regular checks. For this, we'll announce.
                    // We will use isManualCheck = true effectively.

                    if (client && config.munchyStreamChannelId) {
                        try {
                            const munchyStreamChannel = await client.channels.fetch(config.munchyStreamChannelId);
                            if (munchyStreamChannel && munchyStreamChannel.isTextBased()) {
                                const embed = new EmbedBuilder()
                                    .setTitle(`${streamData.channelName} (for <@${streamData.targetUserId}>) just went live on MunchyMC! (Manual Check)`)
                                    .setURL(streamData.streamUrl)
                                    .addFields(
                                        { name: 'Discord User', value: `<@${streamData.targetUserId}>` },
                                        { name: 'Title', value: streamData.title },
                                        { name: 'Link', value: streamData.streamUrl }
                                    )
                                    .setTimestamp();

                                if (streamData.platform === 'YouTube') embed.setColor(Colors.Red);
                                else if (streamData.platform === 'Twitch') embed.setColor(Colors.Purple);
                                if (streamData.thumbnailUrl) embed.setThumbnail(streamData.thumbnailUrl);

                                let streamsThisMonthCount = 0;
                                try {
                                    const userActivity = await dataManager.readUserActivity(streamData.targetUserId, streamData.platform, streamData.streamerChannelId);
                                    if (userActivity && userActivity.streamSessions) {
                                        const currentDate = new Date();
                                        streamsThisMonthCount = userActivity.streamSessions.filter(session => {
                                            const sessionDate = new Date(session.startedAt);
                                            return sessionDate.getFullYear() === currentDate.getFullYear() && sessionDate.getMonth() === currentDate.getMonth();
                                        }).length;
                                    }
                                } catch (err) {
                                    console.error(`[StreamMonitor] Error reading user activity for footer (user check):`, err);
                                }
                                embed.setFooter({ text: `Streams this month: ${streamsThisMonthCount} • Manual Check` });

                                await munchyStreamChannel.send({ embeds: [embed] });
                                announcedStreams.set(streamId, now); // Update cooldown after manual announcement
                                announcementsMade++;
                                console.log(`[StreamMonitor] Manually announced munchy stream for ${streamData.channelName} (User: ${targetUserId})`);
                            }
                        } catch (fetchChannelError) {
                            console.error(`[StreamMonitor] Error fetching/sending to munchy stream announce channel (user check):`, fetchChannelError);
                            errorsEncountered++;
                        }
                    } else {
                         console.warn(`[StreamMonitor] Cannot announce munchy stream (user check): Client missing or munchyStreamChannelId not configured.`);
                    }
                }
            } else if (streamDetails && streamDetails.error) {
                console.error(`[StreamMonitor] Error checking ${channel.platform} channel ${channel.channelId} (User: ${targetUserId}): ${streamDetails.error}`);
                errorsEncountered++;
            }
        } catch (error) {
            console.error(`[StreamMonitor] Error during stream check for ${channel.platform} channel ${channel.channelId} (User: ${targetUserId}):`, error);
            errorsEncountered++;
        }
    }

    let summary = `Stream check for <@${targetUserId}> complete.\n`;
    summary += `- Checked ${userChannels.length} channel(s) tracked for this user.\n`;
    summary += `- Found ${liveMunchyStreamsFound} live "munchy" stream(s).\n`;
    summary += `- Made ${announcementsMade} announcement(s).\n`;
    if (errorsEncountered > 0) {
        summary += `- Encountered ${errorsEncountered} error(s) during the check. See console for details.`;
    }
    return summary;
}

module.exports = {
    checkAllTrackedChannels,
    triggerStreamCheckAndSave,
    checkUserStreams,
};