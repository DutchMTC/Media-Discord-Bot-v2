const axios = require('axios');
const { getYoutubeApiKey } = require('../utils/configHelper');

let youtubeApiKey;

// Function to load configuration
async function loadConfig() {
    youtubeApiKey = getYoutubeApiKey();
    if (!youtubeApiKey) {
        console.error('YouTube API Key is not configured.');
        throw new Error('YouTube API Key is not configured.');
    }
}

/**
 * Resolves a YouTube channel identifier (handle, custom URL, legacy username, or ID) to its canonical "UC..." channel ID and name.
 * @param {string} identifier - The YouTube channel identifier.
 * @returns {Promise<{channelId: string, channelName: string}|null>} - An object with channelId and channelName, or null if resolution fails.
 */
async function resolveYouTubeIdentifierToChannelId(identifier) {
    if (!youtubeApiKey) {
        await loadConfig();
    }

    if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') {
        console.warn(`[YouTubeService] Received empty or invalid identifier.`);
        return null;
    }

    identifier = identifier.trim();
    console.log(`[YouTubeService] Attempting to resolve identifier: "${identifier}"`);

    // Priority 1: Canonical ID Check
    if (identifier.startsWith('UC') && identifier.length === 24) {
        console.log(`[YouTubeService] Identifier "${identifier}" appears to be a canonical ID. Verifying and fetching name...`);
        try {
            const response = await axios.get(`https://www.googleapis.com/youtube/v3/channels`, {
                params: { part: 'snippet', id: identifier, key: youtubeApiKey },
            });
            if (response.data?.items?.[0]?.snippet?.title) {
                const channelName = response.data.items[0].snippet.title;
                console.log(`[YouTubeService] Confirmed canonical ID "${identifier}" for channel: "${channelName}".`);
                return { channelId: identifier, channelName };
            } else {
                console.warn(`[YouTubeService] Canonical ID "${identifier}" did not return a valid channel snippet. It might be an invalid or terminated channel.`);
                // Do not return here, allow fallback to other methods if name fetch fails,
                // but we treat it as unresolved for now.
            }
        } catch (error) {
            console.error(`[YouTubeService] Error verifying canonical ID "${identifier}" or fetching its name:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
            // Proceed to other methods if verification fails
        }
    }

    // Input Parsing for Handles and Usernames
    let handleName = null;
    let usernameForApi = identifier; // Default to the full identifier

    if (identifier.startsWith('@')) {
        handleName = identifier.substring(1);
        usernameForApi = handleName; // Also use for forUsername if needed
    } else if (identifier.includes('youtube.com/')) {
        try {
            const url = new URL(identifier);
            const pathname = url.pathname;
            const parts = pathname.split('/').filter(p => p);

            if (parts.length > 0) {
                if (parts[0].startsWith('@')) {
                    handleName = parts[0].substring(1);
                    usernameForApi = handleName;
                } else if (parts[0] === 'c' && parts.length > 1) {
                    usernameForApi = parts[1]; // custom URL name
                } else if (parts[0] === 'user' && parts.length > 1) {
                    usernameForApi = parts[1]; // legacy username
                } else if (parts.length === 1 && !['channel', 'results', 'feed', 'watch'].includes(parts[0])) {
                    // Path could be a custom name, legacy username, or even a handle without '@' if typed directly
                    usernameForApi = parts[0];
                    // If it doesn't have an explicit '@', but could be a handle, we can try forHandle
                    // For now, we assume it's a username/custom URL part if not explicitly '@'
                }
            }
        } catch (e) {
            console.warn(`[YouTubeService] Could not parse identifier as URL: "${identifier}". Using it as is.`);
            // usernameForApi remains the original identifier
        }
    }
    // If identifier is a plain string not matching URL patterns or starting with '@',
    // handleName remains null, and usernameForApi is the identifier itself.

    // Priority 2: forHandle Resolution
    if (handleName) {
        console.log(`[YouTubeService] Attempting to resolve by handle: "@${handleName}" using forHandle.`);
        try {
            const response = await axios.get(`https://www.googleapis.com/youtube/v3/channels`, {
                params: { part: 'snippet', forHandle: handleName, key: youtubeApiKey },
            });
            if (response.data?.items?.length > 0) {
                const channelId = response.data.items[0].id;
                const channelName = response.data.items[0].snippet.title;
                console.log(`[YouTubeService] Resolved via forHandle "@${handleName}" to Channel ID: "${channelId}", Name: "${channelName}".`);
                return { channelId, channelName };
            } else {
                console.log(`[YouTubeService] No channel found using forHandle for "@${handleName}".`);
            }
        } catch (error) {
            console.error(`[YouTubeService] Error resolving with forHandle "@${handleName}":`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        }
    }

    // Priority 3: Fallback for Legacy Usernames/Custom URLs (forUsername)
    // This will use usernameForApi, which could be from a /c/, /user/ URL, or a plain string.
    // Avoid if it was clearly a handle that failed with forHandle, unless it's a different string.
    if (usernameForApi && (handleName !== usernameForApi || !handleName)) { // Ensure we are not retrying the same failed handle string
        console.log(`[YouTubeService] Attempting to resolve by username/custom URL: "${usernameForApi}" using forUsername.`);
        try {
            const response = await axios.get(`https://www.googleapis.com/youtube/v3/channels`, {
                params: { part: 'snippet', forUsername: usernameForApi, key: youtubeApiKey },
            });
            if (response.data?.items?.length > 0) {
                const channelId = response.data.items[0].id;
                const channelName = response.data.items[0].snippet.title;
                console.log(`[YouTubeService] Resolved via forUsername "${usernameForApi}" to Channel ID: "${channelId}", Name: "${channelName}".`);
                return { channelId, channelName };
            } else {
                console.log(`[YouTubeService] No channel found using forUsername for "${usernameForApi}".`);
            }
        } catch (error) {
            console.error(`[YouTubeService] Error resolving with forUsername "${usernameForApi}":`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        }
    }

    // Priority 4: Fallback Search (search.list - Least Preferred)
    // Use the most relevant part for search, which is likely usernameForApi or original identifier if parsing failed.
    const searchQuery = usernameForApi || identifier;
    console.log(`[YouTubeService] Attempting fallback search with query: "${searchQuery}"`);
    try {
        const response = await axios.get(`https://www.googleapis.com/youtube/v3/search`, {
            params: { part: 'snippet', q: searchQuery, type: 'channel', maxResults: 1, key: youtubeApiKey },
        });
        if (response.data?.items?.length > 0) {
            const channelId = response.data.items[0].id.channelId;
            const channelName = response.data.items[0].snippet.title;
            console.log(`[YouTubeService] Fallback search for "${searchQuery}" resolved to Channel ID: "${channelId}", Name: "${channelName}".`);
            return { channelId, channelName };
        } else {
            console.log(`[YouTubeService] Fallback search for "${searchQuery}" did not yield a result.`);
        }
    } catch (error) {
        console.error(`[YouTubeService] Error during fallback search for "${searchQuery}":`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }

    console.error(`[YouTubeService] Failed to resolve identifier "${identifier}" to a channel ID and name after all attempts.`);
    return null;
}


/**
 * Checks if a YouTube channel is live and retrieves stream details.
 * Resolves non-canonical identifiers to "UC..." channel IDs if necessary.
 * @param {string} channelIdentifier - The YouTube channel identifier (handle, custom URL, or canonical ID).
 * @returns {Promise<object>} - Object with stream details or { isLive: false, error?: string }.
 */
async function getStreamStatus(channelIdentifier) {
    console.log(`[YouTubeService] Received request to check live status for identifier: "${channelIdentifier}"`);
    if (!youtubeApiKey) {
        await loadConfig(); // Ensure API key is loaded
    }

    let resolvedChannelInfo = null;

    if (typeof channelIdentifier === 'string' && channelIdentifier.length > 0) {
        // Always try to resolve, even if it looks canonical, to get the channel name consistently.
        // The resolver function itself handles canonical IDs efficiently.
        console.log(`[YouTubeService] Attempting to resolve identifier "${channelIdentifier}" for stream status check.`);
        resolvedChannelInfo = await resolveYouTubeIdentifierToChannelId(channelIdentifier);

        if (!resolvedChannelInfo || !resolvedChannelInfo.channelId) {
            console.error(`[YouTubeService] Failed to resolve identifier "${channelIdentifier}" to channel details.`);
            return { isLive: false, error: `Failed to resolve YouTube identifier: ${channelIdentifier}` };
        }
        console.log(`[YouTubeService] Resolved identifier "${channelIdentifier}" to Channel ID: "${resolvedChannelInfo.channelId}", Name: "${resolvedChannelInfo.channelName}"`);
    } else {
        console.error(`[YouTubeService] Invalid or empty channel identifier provided: "${channelIdentifier}".`);
        return { isLive: false, error: `Invalid or empty YouTube identifier: ${channelIdentifier}` };
    }
    
    // Ensure resolvedChannelInfo.channelId is valid before proceeding
    if (!resolvedChannelInfo.channelId || typeof resolvedChannelInfo.channelId !== 'string' || !resolvedChannelInfo.channelId.startsWith('UC') || resolvedChannelInfo.channelId.length !== 24) {
        console.error(`[YouTubeService] Post-resolution check failed: resolvedChannelId "${resolvedChannelInfo.channelId}" is not a valid canonical ID for original identifier "${channelIdentifier}".`);
        return { isLive: false, error: `Failed to obtain a valid canonical YouTube channel ID for: ${channelIdentifier}` };
    }

    const channelIdForStreamSearch = resolvedChannelInfo.channelId;
    console.log(`[YouTubeService] Checking live status for resolved channelId: "${channelIdForStreamSearch}" (Original: "${channelIdentifier}")`);

    const apiUrl = `https://www.googleapis.com/youtube/v3/search`;
    const params = {
        part: 'snippet',
        channelId: channelIdForStreamSearch,
        eventType: 'live',
        type: 'video',
        key: youtubeApiKey,
    };

    try {
        const response = await axios.get(apiUrl, { params });
        // console.log('[YouTubeService] Live stream search API response:', JSON.stringify(response.data, null, 2));

        if (response.data?.items?.length > 0) {
            const liveStream = response.data.items[0];
            const videoId = liveStream.id.videoId;
            console.log(`[YouTubeService] Found ${response.data.items.length} live item(s) for channelId "${channelIdForStreamSearch}" (Original: "${channelIdentifier}"). Title: "${liveStream.snippet.title}"`);
            return {
                isLive: true,
                title: liveStream.snippet.title,
                channelName: resolvedChannelInfo.channelName, // Add channelName here
                channelId: channelIdForStreamSearch,
                startedAt: liveStream.snippet.publishedAt,
                streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
                videoId: videoId
            };
        } else {
            console.log(`[YouTubeService] No live items found for channelId "${channelIdForStreamSearch}" (Original: "${channelIdentifier}").`);
            return { isLive: false, channelName: resolvedChannelInfo.channelName, channelId: channelIdForStreamSearch };
        }
    } catch (error) {
        const errorMessageBase = `[YouTubeService] Error fetching YouTube stream status for channelId "${channelIdForStreamSearch}" (Original: "${channelIdentifier}"):`;
        console.error(errorMessageBase, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        
        let apiErrorMessage = 'Failed to fetch stream status.';
        if (error.response?.data?.error) {
            const apiError = error.response.data.error;
            apiErrorMessage = `YouTube API Error: ${apiError.message}`;
            console.error(`[YouTubeService] YouTube API Error during live status check for "${channelIdForStreamSearch}": ${apiError.message} (Code: ${apiError.code})`);
            if (apiError.errors?.length > 0) {
                console.error(`[YouTubeService] API Error Details: ${apiError.errors.map(e => `${e.reason}: ${e.message}`).join(', ')}`);
            }
        } else if (error.request) {
            console.error(`[YouTubeService] No response received for live status check for channelId "${channelIdForStreamSearch}".`);
        } else {
            console.error(`[YouTubeService] Error setting up live status check for channelId "${channelIdForStreamSearch}":`, error.message);
        }
        return { isLive: false, error: apiErrorMessage, channelName: resolvedChannelInfo?.channelName, channelId: channelIdForStreamSearch };
    }
}

module.exports = {
    getStreamStatus,
    resolveYouTubeIdentifierToChannelId,
    // loadConfig // Typically not exported, called internally or on module load
};

// Optionally, load config when the module is first required
// (async () => {
//     try {
//         await loadConfig();
//     } catch (error) {
//         console.error("Failed to load YouTube service configuration on startup:", error.message);
//         // Depending on the application's needs, you might want to prevent the app from starting
//         // or allow it to run in a degraded state.
//     }
// })();