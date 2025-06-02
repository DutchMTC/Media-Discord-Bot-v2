const axios = require('axios');
const { getTwitchClientId, getTwitchClientSecret } = require('../utils/configHelper');

let twitchClientId;
let twitchClientSecret;
let accessToken = null;
let tokenExpiry = 0;

async function initializeConfig() {
    twitchClientId = getTwitchClientId();
    twitchClientSecret = getTwitchClientSecret();
    if (!twitchClientId || !twitchClientSecret) {
        console.error('Twitch Client ID or Secret not found in environment variables.');
        throw new Error('Twitch API credentials not configured.');
    }
}

/**
 * Gets an App Access Token from Twitch.
 * Stores the token and its expiry time to reuse it.
 * Refreshes the token if it's expired or nearing expiry.
 */
async function getTwitchAppAccessToken() {
    if (!twitchClientId || !twitchClientSecret) {
        await initializeConfig();
    }

    const now = Date.now();
    // Refresh if token is null, or expires in the next 60 seconds
    if (!accessToken || tokenExpiry < (now + 60000)) {
        console.log('Fetching new Twitch App Access Token...');
        try {
            const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                params: {
                    client_id: twitchClientId,
                    client_secret: twitchClientSecret,
                    grant_type: 'client_credentials',
                },
            });

            if (response.data && response.data.access_token) {
                accessToken = response.data.access_token;
                // expires_in is in seconds, convert to milliseconds for Date.now()
                tokenExpiry = now + (response.data.expires_in * 1000);
                console.log('Successfully obtained Twitch App Access Token.');
            } else {
                console.error('Failed to obtain Twitch App Access Token:', response.data);
                throw new Error('Failed to obtain Twitch App Access Token.');
            }
        } catch (error) {
            console.error('Error fetching Twitch App Access Token:', error.response ? error.response.data : error.message);
            throw error; // Re-throw the error to be handled by the caller
        }
    }
    return accessToken;
}

/**
 * Checks the live status of a Twitch channel.
 * @param {string} channelLoginName - The login name of the Twitch channel (e.g., "asmongold").
 * @returns {Promise<object>} - An object with stream status and details if live.
 *                              e.g., { isLive: true, title: "Stream Title", startedAt: "ISO_Date_String", streamUrl: "URL" }
 *                              or { isLive: false }
 */
async function getStreamStatus(channelLoginName) {
    if (!channelLoginName) {
        throw new Error('channelLoginName is required.');
    }

    try {
        const token = await getTwitchAppAccessToken();
        const response = await axios.get(`https://api.twitch.tv/helix/streams`, {
            params: {
                user_login: channelLoginName,
            },
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`,
            },
        });

        if (response.data && response.data.data) {
            const streamData = response.data.data;
            if (streamData.length > 0) {
                const stream = streamData[0];
                return {
                    isLive: true,
                    title: stream.title,
                    startedAt: stream.started_at,
                    streamUrl: `https://www.twitch.tv/${stream.user_login}`, // or stream.user_name
                    gameName: stream.game_name,
                    viewerCount: stream.viewer_count,
                    thumbnailUrl: stream.thumbnail_url.replace('{width}x{height}', '1920x1080')
                };
            } else {
                return { isLive: false };
            }
        } else {
            console.error('Unexpected response structure from Twitch API for getStreamStatus:', response.data);
            throw new Error('Failed to get stream status due to unexpected API response.');
        }
    } catch (error) {
        console.error(`Error checking stream status for ${channelLoginName}:`, error.response ? error.response.data : error.message);
        // Check for specific Twitch API errors if needed, e.g., 401 Unauthorized for token issues
        if (error.response && error.response.status === 401) {
            // Potentially force token refresh on next call
            accessToken = null;
            tokenExpiry = 0;
            console.log('Twitch token might be invalid, cleared for refresh.');
        }
        throw error; // Re-throw the error to be handled by the caller
    }
}

module.exports = {
    getTwitchAppAccessToken,
    getStreamStatus,
};