const fs = require('fs/promises');
const path = require('path');

/**
 * Saves stream data to a JSON file specific to the target user and platform.
 * @param {object} streamDataObject - Object containing stream details.
 * @param {string} streamDataObject.streamUrl - The URL of the stream.
 * @param {string} streamDataObject.startedAt - ISO 8601 timestamp of when the stream started.
 * @param {string} streamDataObject.title - The title of the stream.
 * @param {string} streamDataObject.platform - The platform (e.g., 'twitch', 'youtube').
 * @param {string} streamDataObject.streamerChannelId - The ID of the streamer's channel.
 * @param {string} streamDataObject.targetUserId - The Discord user ID who is tracking this stream.
 * @returns {Promise<boolean>} True if a new stream record was added, false otherwise.
 */
async function saveStreamData(streamDataObject) {
    try {
        const { streamUrl, startedAt, title, platform, streamerChannelId, targetUserId } = streamDataObject;

        if (!targetUserId || !platform || !streamerChannelId) {
            console.error('Missing required fields in streamDataObject for path construction:', streamDataObject);
            return false;
        }

        const userDir = path.join('data', targetUserId.toString());
        const filePath = path.join(userDir, `${platform}_${streamerChannelId}.json`);

        await fs.mkdir(userDir, { recursive: true });

        let streams = [];
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            streams = JSON.parse(fileContent);
            if (!Array.isArray(streams)) {
                console.warn(`File ${filePath} did not contain a valid JSON array. Initializing with an empty array.`);
                streams = [];
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, which is fine, we'll create it.
                streams = [];
            } else {
                console.error(`Error reading or parsing ${filePath}:`, error);
                streams = []; // Start with an empty array if there's a read/parse error.
            }
        }

        const streamExists = streams.some(
            (s) => s.streamUrl === streamUrl && s.startedAt === startedAt
        );

        if (!streamExists) {
            streams.push({
                streamUrl,
                startedAt,
                title,
                // platform and streamerChannelId are part of the filename,
                // targetUserId is part of the directory structure.
                // No need to store them again inside the record unless specifically required later.
            });
            await fs.writeFile(filePath, JSON.stringify(streams, null, 2), 'utf-8');
            console.log(`Saved stream data for ${targetUserId} - ${platform}_${streamerChannelId}: ${title}`);
            return true;
        } else {
            console.log(`Stream data for ${targetUserId} - ${platform}_${streamerChannelId} already exists (URL: ${streamUrl}, Started: ${startedAt}). Skipping.`);
            return false;
        }
    } catch (error) {
        console.error('Error in saveStreamData:', error, 'Stream Data:', streamDataObject);
        return false;
    }
}

async function readUserActivity(userId, platform, channelId) {
    const userDir = path.join('data', userId.toString());
    const filePath = path.join(userDir, `${platform}_${channelId}.json`);

    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const streams = JSON.parse(fileContent);
        if (!Array.isArray(streams)) {
            console.warn(`[dataManager] File ${filePath} did not contain a valid JSON array. Returning empty activity.`);
            return { streamSessions: [] };
        }
        // console.log(`[dataManager] Successfully read activity for user ${userId}, platform ${platform}, channel ${channelId} from ${filePath}`);
        return { streamSessions: streams };
    } catch (error) {
        if (error.code === 'ENOENT') {
            // console.log(`[dataManager] Activity file not found for user ${userId}, platform ${platform}, channel ${channelId} at ${filePath}. Returning empty activity.`);
            return { streamSessions: [] };
        } else {
            console.error(`[dataManager] Error reading or parsing activity file ${filePath}:`, error);
            return { streamSessions: [] }; // Return empty on other errors
        }
    }
}

async function getGuildActivity(guildId, timeframe) {
    // TODO: Implement actual logic to get guild activity
    console.log(`Getting activity for guild ${guildId} within timeframe ${timeframe}`);
    return []; // Placeholder
}
module.exports = {
    saveStreamData,
    readUserActivity,
    getGuildActivity,
};