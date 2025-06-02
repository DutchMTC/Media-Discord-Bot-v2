const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Colors } = require('discord.js');
const reportService = require('../services/reportService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checkstreams')
        .setDescription('Generates a stream activity report for a specific user.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The Discord user to generate the report for.')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('month')
                .setDescription('The month for the report (1-12). Defaults to the current month.')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(12))
        .addIntegerOption(option =>
            option.setName('year')
                .setDescription('The year for the report (e.g., 2024). Defaults to the current year.')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const inputMonth = interaction.options.getInteger('month');
        const inputYear = interaction.options.getInteger('year');

        // Logic to default month/year if not provided
        const now = new Date();
        const reportMonth = inputMonth || (now.getMonth() + 1); // getMonth() is 0-indexed
        const reportYear = inputYear || now.getFullYear();

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const reportMonthName = monthNames[reportMonth - 1]; // reportMonth is 1-indexed

        await interaction.deferReply({ ephemeral: true });

        try {
            const reportData = await reportService.generateUserStreamReportData(interaction.client, targetUser.id, reportMonth, reportYear);

            const embed = new EmbedBuilder()
                .setTitle(`${targetUser.username}'s Stream Report: ${reportMonthName} ${reportYear}`)
                .setColor(Colors.Aqua)
                .setTimestamp();

            if (reportData.error) {
                embed.setColor(Colors.Orange)
                     .setDescription(reportData.error);
            } else {
                let liveStatusMessage = `${targetUser.username} is not currently live.`;
                if (reportData.isLive && reportData.liveStreamDetails && reportData.liveStreamDetails.url) {
                    liveStatusMessage = `${targetUser.username} is currently [live on ${reportData.liveStreamDetails.platform} (${reportData.liveStreamDetails.channelName})](${reportData.liveStreamDetails.url})!`;
                } else if (reportData.isLive) {
                    liveStatusMessage = `${targetUser.username} is currently live (stream details unavailable).`;
                }

                embed.addFields(
                    { name: 'Current Status', value: liveStatusMessage },
                    { name: `Streams in ${reportMonthName} ${reportYear}`, value: reportData.streamsThisMonth.toString(), inline: true },
                    { name: 'All-Time Streams', value: reportData.allTimeStreams.toString(), inline: true }
                );

                if (reportData.trackedUserChannelsInfo && reportData.trackedUserChannelsInfo.length > 0) {
                    let trackedChannelsString = reportData.trackedUserChannelsInfo.map(ch => {
                        const channelLink = ch.platform === 'Twitch' ? `https://twitch.tv/${ch.channelId}` : `https://youtube.com/channel/${ch.channelId}`;
                        return `• [${ch.channelName}](${channelLink}) (${ch.platform})`;
                    }).join('\n');
                    if (trackedChannelsString.length > 1024) {
                        trackedChannelsString = trackedChannelsString.substring(0, 1020) + "...";
                    }
                    embed.addFields({ name: 'Tracked Channels for this User', value: trackedChannelsString });
                } else {
                    embed.addFields({ name: 'Tracked Channels for this User', value: 'None found.'});
                }
            }

            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error(`[CmdUserStreamReport] Error executing /userstreamreport for ${targetUser.tag}:`, error);
            const errorEmbed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setTitle('Error Generating Report')
                .setDescription('An unexpected error occurred while generating the stream report. Please check the bot logs.')
                .setTimestamp();
            
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },
};