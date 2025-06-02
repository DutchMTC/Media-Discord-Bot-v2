const fs = require('node:fs');
const path = require('node:path');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { getDiscordBotToken } = require('./utils/configHelper'); // Import the new getter
const { clientId, devGuildId } = require('./config.json'); // Keep for non-sensitive parts

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if (command.data && typeof command.data.toJSON === 'function') {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a "data" or "data.toJSON" property.`);
    }
}

const rest = new REST({ version: '9' }).setToken(getDiscordBotToken());

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        if (devGuildId) {
            await rest.put(
                Routes.applicationGuildCommands(clientId, devGuildId),
                { body: commands },
            );
            console.log(`Successfully reloaded application (/) commands for guild ${devGuildId}.`);
        } else {
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
            console.log('Successfully reloaded application (/) commands globally.');
        }

    } catch (error) {
        console.error(error);
    }
})();