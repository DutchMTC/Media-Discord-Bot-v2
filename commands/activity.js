const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');
const { parseTimeframe } = require('../utils/timeframeParser');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function findStreamerFile(streamerIdentifier) {
    try {
        const discordUserDirs = await fs.readdir(DATA_DIR, { withFileTypes: true });
        for (const dirent of discordUserDirs) {
            if (dirent.isDirectory()) {
                const userDirPath = path.join(DATA_DIR, dirent.name);
                const files = await fs.readdir(userDirPath);
                for (const file of files) {
                    // Match against <platform>_<streamer_channel_id>.json or just <streamer_channel_id> if it's part of the filename
                    const fileNameWithoutExt = path.parse(file).name;
                    if (fileNameWithoutExt.endsWith(streamerIdentifier) || fileNameWithoutExt === streamerIdentifier) {
                        return path.join(userDirPath, file);
                    }
                }
            }
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            // Data directory doesn't exist yet
            return null;
        }
        console.error('Error scanning for streamer file:', error);
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activity')
        .setDescription('Displays a summary of a streamer\'s \'munchy\' stream activity.')
        .addStringOption(option =>
            option.setName('streamer_identifier')
                .setDescription('The streamer\'s channel name/ID (e.g., twitch_channelname or channelname).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Timeframe (e.g., 7d, 30d, 1m, 1y, YYYY-MM-DD_YYYY-MM-DD).')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const streamerIdentifier = interaction.options.getString('streamer_identifier');
        const timeframeString = interaction.options.getString('timeframe');

        await interaction.deferReply();

        const streamerFilePath = await findStreamerFile(streamerIdentifier);

        if (!streamerFilePath) {
            await interaction.editReply(`No data file found for streamer identifier: \`${streamerIdentifier}\`. Ensure the identifier is correct (e.g., \`twitch_channelname\` or just \`channelname\`).`);
            return;
        }

        let streamRecords;
        try {
            const fileContent = await fs.readFile(streamerFilePath, 'utf-8');
            streamRecords = JSON.parse(fileContent);
            if (!Array.isArray(streamRecords)) {
                throw new Error('Data file is not a valid JSON array.');
            }
        } catch (error) {
            console.error(`Error reading or parsing data file ${streamerFilePath}:`, error);
            await interaction.editReply(`Could not read or parse activity data for \`${streamerIdentifier}\`. The file might be corrupted or empty.`);
            return;
        }

        if (streamRecords.length === 0) {
            await interaction.editReply(`No activity data found for \`${streamerIdentifier}\` in their data file.`);
            return;
        }

        const timeRange = parseTimeframe(timeframeString);
        if (!timeRange) {
            await interaction.editReply(`Invalid timeframe format: \`${timeframeString}\`. Supported formats: 7d, 30d, 1m, 1y, or YYYY-MM-DD_YYYY-MM-DD.`);
            return;
        }

        const { startDate, endDate } = timeRange;

        const filteredStreams = streamRecords.filter(record => {
            if (!record.startedAt) return false;
            const streamDate = new Date(record.startedAt);
            return streamDate >= startDate && streamDate <= endDate;
        });

        if (filteredStreams.length === 0) {
            await interaction.editReply(`No 'munchy' stream activity found for \`${streamerIdentifier}\` within the specified timeframe (${timeframeString}).`);
            return;
        }

        // Sort streams by most recent first
        filteredStreams.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

        const embed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle(`'Munchy' Stream Activity for ${streamerIdentifier}`)
            .setDescription(`Showing activity from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}:`)
            .setTimestamp();

        let descriptionLines = [];
        for (const stream of filteredStreams.slice(0, 10)) { // Display up to 10 streams to avoid huge embeds
            const streamDate = new Date(stream.startedAt);
            const title = stream.title || 'Untitled Stream';
            const url = stream.url || 'No URL provided';
            descriptionLines.push(`- [${title}](${url}) - Started: ${streamDate.toLocaleString()}`);
        }

        if (filteredStreams.length > 10) {
            descriptionLines.push(`\n*And ${filteredStreams.length - 10} more...*`);
        }
        
        if (descriptionLines.length > 0) {
            embed.setDescription(descriptionLines.join('\n'));
        } else {
            // This case should be caught by filteredStreams.length === 0, but as a fallback:
             embed.setDescription(`No 'munchy' stream activity found for \`${streamerIdentifier}\` within the specified timeframe.`);
        }


        // If the description is too long, Discord will reject it.
        // A more robust solution would be pagination or sending multiple messages.
        // For now, we rely on the slice(0,10) and the general embed limits.

        try {
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error("Error sending activity embed:", error);
            // Fallback if embed is too large or other error
            if (error.code === 50035 && error.message.includes('Invalid Form Body')) { // Discord API Error for too large payload
                 await interaction.editReply(`Found ${filteredStreams.length} streams, but the summary is too long to display in a single message. Please try a shorter timeframe.`);
            } else {
                 await interaction.editReply('An error occurred while trying to display the activity.');
            }
        }
    },
};