const fs = require('fs/promises');
const path = require('path');
const { EmbedBuilder } = require('discord.js'); // Added EmbedBuilder
const { getTrackedChannels, getReportChannelId } = require('../utils/configHelper');

let lastReportGeneratedForMonth = -1; // Stores the 0-indexed month of the *trigger* for which a report was last generated

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/**
 * Generates a stream activity report for a specific month and year.
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {number} reportYear - The year for the report (e.g., 2023).
 * @param {number} reportMonthOneIndexed - The month for the report (1-12).
 * @returns {Promise<string>} A message indicating the outcome.
 * @throws {Error} If report generation fails or configuration is missing.
 */
async function generateReport(client, reportYear, reportMonthOneIndexed) {
    const reportMonthZeroIndexed = reportMonthOneIndexed - 1; // 0-11 for Date objects and array indexing

    if (reportMonthZeroIndexed < 0 || reportMonthZeroIndexed > 11) {
        const errorMessage = `Invalid month provided: ${reportMonthOneIndexed}. Month must be between 1 and 12.`;
        console.error(`[ReportService] ${errorMessage}`);
        throw new Error(errorMessage);
    }

    const reportMonthName = MONTH_NAMES[reportMonthZeroIndexed];
    console.log(`[ReportService] Generating report for ${reportMonthName} ${reportYear}...`);

    const firstDayOfReportMonth = new Date(reportYear, reportMonthZeroIndexed, 1, 0, 0, 0, 0);
    const lastDayOfReportMonth = new Date(reportYear, reportMonthZeroIndexed + 1, 0, 23, 59, 59, 999);

    console.log(`[ReportService] Report period: ${firstDayOfReportMonth.toISOString()} to ${lastDayOfReportMonth.toISOString()}`);

    try {
        const trackedChannels = getTrackedChannels();
        if (!trackedChannels || trackedChannels.length === 0) {
            const msg = 'No channels are currently tracked. Cannot generate report.';
            console.log(`[ReportService] ${msg}`);
            // For debug command, this will be caught and sent to user.
            // For scheduled, it just means no report is generated.
            return msg;
        }

        const reportChannelId = getReportChannelId();
        if (!reportChannelId) {
            const errorMsg = 'Report channel ID is not configured. Cannot send report.';
            console.error(`[ReportService] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        const userActivity = {}; // Key: targetUserId, Value: { username: 'Fetching...', userObject: null, channels: [] }

        for (const trackedChannel of trackedChannels) {
            const { platform, channelId, targetUserId, channelName: configChannelName, targetUserTag } = trackedChannel;
            const effectiveChannelName = configChannelName || channelId;
            const dataFilePath = path.join(__dirname, '..', 'data', targetUserId, `${platform}_${channelId}.json`);
            let streamCount = 0;

            try {
                const fileContent = await fs.readFile(dataFilePath, 'utf-8');
                const streams = JSON.parse(fileContent);
                if (Array.isArray(streams)) {
                    for (const stream of streams) {
                        if (stream.startedAt) {
                            const streamStartDate = new Date(stream.startedAt);
                            if (streamStartDate >= firstDayOfReportMonth && streamStartDate <= lastDayOfReportMonth) {
                                streamCount++;
                            }
                        }
                    }
                }
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log(`[ReportService] Data file not found for ${platform} - ${effectiveChannelName} (User: ${targetUserTag || targetUserId}), 0 streams for ${reportMonthName} ${reportYear}.`);
                } else {
                    console.error(`[ReportService] Error reading/parsing data file ${dataFilePath}:`, error);
                }
            }

            if (!userActivity[targetUserId]) {
                userActivity[targetUserId] = {
                    username: targetUserTag || `User ID ${targetUserId}`, // Initial fallback
                    userObject: null,
                    channels: [],
                    totalStreams: 0 // Initialize total streams
                };
            }
            userActivity[targetUserId].channels.push({
                platform: platform.charAt(0).toUpperCase() + platform.slice(1),
                name: effectiveChannelName,
                count: streamCount
            });
            userActivity[targetUserId].totalStreams += streamCount; // Add to total streams
        }

        const sortedUserActivityDetails = [];
        for (const userId in userActivity) {
            try {
                const user = await client.users.fetch(userId);
                userActivity[userId].userObject = user;
                userActivity[userId].username = user.username; // Update with fresh username
            } catch (err) {
                console.warn(`[ReportService] Could not fetch user ${userId}: ${err.message}. Using stored tag/ID.`);
            }
            sortedUserActivityDetails.push({ userId, ...userActivity[userId] });
        }

        // Sort by total streams (descending), then by username (ascending)
        sortedUserActivityDetails.sort((a, b) => {
            if (b.totalStreams !== a.totalStreams) {
                return b.totalStreams - a.totalStreams; // Sort by total streams descending
            }
            return a.username.toLowerCase().localeCompare(b.username.toLowerCase()); // Then by username ascending
        });

        const reportEmbed = new EmbedBuilder()
            .setTitle(`Munchy Stream Report: ${reportMonthName} ${reportYear}`)
            .setColor(0x0099FF) // Blue color
            .setTimestamp();

        let description = '';
        if (sortedUserActivityDetails.length === 0 && trackedChannels.length > 0) {
            description = 'No stream activity found for any tracked users in this period.';
        } else if (trackedChannels.length === 0) {
            // This case is handled earlier, but as a safeguard for embed
            description = 'No channels are currently being tracked.';
        } else {
            for (const userData of sortedUserActivityDetails) {
                description += `<@${userData.userId}> (${userData.username}):\n`;
                if (userData.channels.length > 0) {
                    userData.channels.forEach(ch => {
                        description += `  • ${ch.platform} - ${ch.name}: **${ch.count}** streams\n`;
                    });
                } else {
                    description += `  • No channels tracked for this user in the report period or no data found.\n`;
                }
                description += '\n'; // Add a blank line between users
            }
        }
        
        if (description.length > 4096) {
            description = description.substring(0, 4090) + "\n... (report truncated due to length)";
        }
        reportEmbed.setDescription(description.trim() || 'No activity to report or no users tracked.');


        const discordChannel = await client.channels.fetch(reportChannelId);
        if (discordChannel && discordChannel.isTextBased()) {
            await discordChannel.send({ embeds: [reportEmbed] });
            const successMsg = `Report for ${reportMonthName} ${reportYear} sent as an embed to channel ${reportChannelId}.`;
            console.log(`[ReportService] ${successMsg}`);
            return successMsg;
        } else {
            const errorMsg = `Could not fetch report channel or channel is not text-based with ID: ${reportChannelId}.`;
            console.error(`[ReportService] ${errorMsg}`);
            throw new Error(errorMsg);
        }
    } catch (error) {
        console.error(`[ReportService] Error during report generation for ${reportMonthName} ${reportYear}:`, error);
        throw error; // Re-throw for the caller to handle
    }
}

/**
 * Generates a report for the month preceding the current date.
 * Called by the scheduled task.
 */
async function generatePreviousMonthReport(client) {
    console.log('[ReportService] Attempting to generate scheduled monthly report (for data of the previous month)...');
    const now = new Date();
    let reportYear = now.getFullYear();
    let monthReportIsFor = now.getMonth(); // Current month's index (0-11).

    if (monthReportIsFor === 0) { // Current month is January (index 0), report for December (12) of previous year.
        monthReportIsFor = 12;
        reportYear -= 1;
    }
    // else: current month is Feb (index 1), report for Jan (1). monthReportIsFor is 1.
    // else: current month is May (index 4), report for Apr (4). monthReportIsFor is 4.
    // This logic makes monthReportIsFor the 1-indexed month number of the *previous* month.

    return generateReport(client, reportYear, monthReportIsFor);
}

/**
 * Schedules a daily check to generate the monthly report on the 1st of each month.
 */
function scheduleMonthlyReport(client) {
    console.log('[ReportService] Scheduling daily checks for monthly report generation...');
    checkAndGenerateReport(client); // Initial check

    setInterval(() => {
        checkAndGenerateReport(client);
    }, 24 * 60 * 60 * 1000); // Check once per day
    console.log('[ReportService] Daily checks scheduled.');
}

/**
 * Checks if it's the 1st of the month and if a report needs to be generated.
 */
async function checkAndGenerateReport(client) {
    const today = new Date();
    console.log(`[ReportService] Performing daily check for report generation on ${today.toDateString()}`);

    if (today.getDate() === 1) {
        const currentTriggerMonthIndex = today.getMonth(); // 0-11 (e.g., 0 for Jan, 1 for Feb)
        const previousMonthName = MONTH_NAMES[currentTriggerMonthIndex === 0 ? 11 : currentTriggerMonthIndex - 1];

        if (lastReportGeneratedForMonth !== currentTriggerMonthIndex) {
            console.log(`[ReportService] It's the 1st of ${MONTH_NAMES[currentTriggerMonthIndex]}. Report for ${previousMonthName}'s data not yet generated this trigger cycle. Triggering now...`);
            try {
                await generatePreviousMonthReport(client);
                lastReportGeneratedForMonth = currentTriggerMonthIndex;
                console.log(`[ReportService] Scheduled report generation for ${previousMonthName}'s data completed. Marked as generated for trigger month: ${MONTH_NAMES[currentTriggerMonthIndex]}.`);
            } catch (error) {
                console.error('[ReportService] Scheduled report generation failed:', error.message || error);
            }
        } else {
            console.log(`[ReportService] It's the 1st of ${MONTH_NAMES[currentTriggerMonthIndex]}, but report for ${previousMonthName}'s data (triggered this month) already processed/attempted. Skipping.`);
        }
    } else {
        console.log(`[ReportService] Not the 1st of the month. No scheduled report will be generated today.`);
    }
}

async function generateUserStreamReportData(client, targetUserId, reportMonthOneIndexed, reportYear) {
    console.log(`[ReportService] Generating user stream report for User ID: ${targetUserId}, Month: ${reportMonthOneIndexed}, Year: ${reportYear}`);
    const config = require('../utils/configHelper').readConfig(); // Re-read config, or pass if already available
    const dataManager = require('../utils/dataManager'); // For reading stream data
    const twitchService = require('./twitchService');
    const youtubeService = require('./youtubeService');

    const userTrackedChannels = (config.trackedChannels || []).filter(ch => ch.targetUserId === targetUserId);

    if (userTrackedChannels.length === 0) {
        return {
            error: `No channels are currently tracked for user <@${targetUserId}>.`,
            isLive: false,
            streamsThisMonth: 0,
            allTimeStreams: 0,
            trackedUserChannelsInfo: []
        };
    }

    let overallIsLive = false;
    let liveStreamDetails = {};
    let totalStreamsThisMonth = 0;
    let totalAllTimeStreams = 0;
    const trackedUserChannelsInfo = [];

    const reportMonthZeroIndexed = reportMonthOneIndexed - 1;
    const firstDayOfReportMonth = new Date(reportYear, reportMonthZeroIndexed, 1, 0, 0, 0, 0);
    const lastDayOfReportMonth = new Date(reportYear, reportMonthZeroIndexed + 1, 0, 23, 59, 59, 999);

    for (const trackedChannel of userTrackedChannels) {
        const { platform, channelId, channelName: configChannelName } = trackedChannel;
        const effectiveChannelName = configChannelName || channelId;
        trackedUserChannelsInfo.push({ platform, channelName: effectiveChannelName, channelId });

        // 1. Check current live status
        if (!overallIsLive) { // Only check if not already found live for this user
            try {
                let currentStreamStatus;
                if (platform === 'Twitch') {
                    currentStreamStatus = await twitchService.getStreamStatus(channelId);
                } else if (platform === 'YouTube') {
                    currentStreamStatus = await youtubeService.getStreamStatus(channelId); // channelId here is the one stored, should be canonical for YT
                }

                if (currentStreamStatus && currentStreamStatus.isLive) {
                    overallIsLive = true;
                    liveStreamDetails = {
                        url: currentStreamStatus.streamUrl,
                        title: currentStreamStatus.title,
                        platform: platform,
                        channelName: effectiveChannelName
                    };
                }
            } catch (statusError) {
                console.error(`[ReportService] Error checking live status for ${platform} channel ${effectiveChannelName} (User: ${targetUserId}):`, statusError.message);
            }
        }

        // 2. Get stream counts
        try {
            const activity = await dataManager.readUserActivity(targetUserId, platform, channelId);
            if (activity && activity.streamSessions) {
                totalAllTimeStreams += activity.streamSessions.length;
                activity.streamSessions.forEach(session => {
                    if (session.startedAt) {
                        const streamStartDate = new Date(session.startedAt);
                        if (streamStartDate >= firstDayOfReportMonth && streamStartDate <= lastDayOfReportMonth) {
                            totalStreamsThisMonth++;
                        }
                    }
                });
            }
        } catch (dataError) {
            console.error(`[ReportService] Error reading activity data for ${platform} channel ${effectiveChannelName} (User: ${targetUserId}):`, dataError.message);
        }
    }

    return {
        isLive: overallIsLive,
        liveStreamDetails: overallIsLive ? liveStreamDetails : null,
        streamsThisMonth: totalStreamsThisMonth,
        allTimeStreams: totalAllTimeStreams,
        trackedUserChannelsInfo: trackedUserChannelsInfo,
        targetUserId: targetUserId,
        reportMonth: reportMonthOneIndexed,
        reportYear: reportYear
    };
}

module.exports = {
    scheduleMonthlyReport,
    generateReport,
    generateUserStreamReportData
};