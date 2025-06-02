const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const configPath = path.join(__dirname, '..', 'config.json');
console.log('[ConfigHelper] Resolved configPath:', configPath);

/**
 * Reads and parses the config.json file, then merges with environment variables.
 * Environment variables take precedence.
 * @returns {object} The parsed JSON data merged with environment variables, or an empty object on error.
 */
function readConfig() {
    let jsonConfig = {};
    try {
        console.log(`[ConfigHelper] Attempting to read config from: ${configPath}`);
        if (fs.existsSync(configPath)) {
            const rawData = fs.readFileSync(configPath, 'utf-8');
            if (rawData.trim() === '') {
                console.error(`[ConfigHelper] ERROR: config.json at ${configPath} is empty.`);
            } else {
                console.log('[ConfigHelper] config.json found and read. Attempting to parse...');
                jsonConfig = JSON.parse(rawData);
                console.log('[ConfigHelper] config.json parsed successfully.');
            }
        } else {
            console.error(`[ConfigHelper] ERROR: config.json not found at ${configPath}.`);
        }
    } catch (error) {
        console.error(`[ConfigHelper] ERROR reading or parsing config.json from ${configPath}:`, error);
    }

    // Merge with environment variables, giving them precedence
    return {
        ...jsonConfig,
        discordBotToken: process.env.DISCORD_BOT_TOKEN || jsonConfig.discordBotToken,
        twitchClientId: process.env.TWITCH_CLIENT_ID || jsonConfig.twitchClientId,
        twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || jsonConfig.twitchClientSecret,
        youtubeApiKey: process.env.YOUTUBE_API_KEY || jsonConfig.youtubeApiKey,
    };
}

/**
 * Stringifies and writes data to config.json.
 * @param {object} data The data to write to the file.
 * @returns {Promise<void>} A promise that resolves when the file has been written.
 * @throws {Error} If there's an error writing the file.
 */
async function writeConfig(data) {
    try {
        const jsonData = JSON.stringify(data, null, 2);
        await fs.promises.writeFile(configPath, jsonData, 'utf8');
    } catch (error) {
        console.error('Error writing to config.json:', error);
        throw new Error('Could not write configuration file.');
    }
}

/**
 * Reads the configuration and returns the list of tracked channels.
 * @returns {Array} An array of tracked channel objects, or an empty array if none are configured or on error.
 */
function getTrackedChannels() {
    const config = readConfig();
    return config.trackedChannels || [];
}

/**
 * Reads the configuration and returns the report channel ID.
 * @returns {string|null} The report channel ID, or null if not configured or on error.
 */
function getReportChannelId() {
    const config = readConfig();
    return config.reportChannelId || null;
}

function getDiscordBotToken() {
    return process.env.DISCORD_BOT_TOKEN;
}

function getTwitchClientId() {
    return process.env.TWITCH_CLIENT_ID;
}

function getTwitchClientSecret() {
    return process.env.TWITCH_CLIENT_SECRET;
}

function getYoutubeApiKey() {
    return process.env.YOUTUBE_API_KEY;
}

module.exports = {
    readConfig,
    writeConfig,
    getTrackedChannels,
    getReportChannelId,
    getDiscordBotToken,
    getTwitchClientId,
    getTwitchClientSecret,
    getYoutubeApiKey,
};