const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const config = require('./config');
const MusicPlayer = require('./src/MusicPlayer');
const chalk = require('chalk');

require("./src/commandLoader");

async function checkYtDlpUpdate() {
    try {
        const { execSync } = require('child_process');
        const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
        const ytdlpBin = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', binName);
        const version = execSync(`"${ytdlpBin}" --version`).toString().trim();

        const parts = version.split('.');
        const versionDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const daysSinceUpdate = Math.floor((Date.now() - versionDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceUpdate > 14) {
            console.log(chalk.yellow(`⚠️ yt-dlp ${daysSinceUpdate}일 경과 (${version}). 업데이트 확인 중...`));
            execSync('npm install youtube-dl-exec@latest', { cwd: __dirname, stdio: 'pipe', timeout: 60000 });
            const newVersion = execSync(`"${ytdlpBin}" --version`).toString().trim();
            if (newVersion !== version) {
                console.log(chalk.green(`✅ yt-dlp 업데이트: ${version} → ${newVersion}`));
            } else {
                console.log(chalk.gray(`✓ yt-dlp 최신 버전 (${version})`));
            }
        } else {
            console.log(chalk.gray(`✓ yt-dlp 최신 버전 (${version})`));
        }
    } catch (error) {
        console.error(chalk.yellow('⚠️ yt-dlp update check failed:'), error.message);
    }
}

async function cleanupAudioCache() {
    const cacheDir = path.join(__dirname, 'audio_cache');
    try {
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
            return;
        }
        const files = await fsPromises.readdir(cacheDir);
        for (const file of files) {
            await fsPromises.unlink(path.join(cacheDir, file)).catch(() => {});
        }
        if (files.length > 0) {
            console.log(chalk.gray(`🗑️ Cleaned up ${files.length} cached audio files`));
        }
    } catch (error) {
        console.error(chalk.red('❌ Failed to cleanup audio cache:'), error.message);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ]
});

client.commands = new Collection();
client.players = new Collection();

const MusicEmbedManager = require('./src/MusicEmbedManager');
client.musicEmbedManager = new MusicEmbedManager(client);

if (!global.clients) global.clients = {};
global.clients.musicEmbedManager = client.musicEmbedManager;

const loadCommands = () => {
    const commandsPath = path.join(__dirname, 'commands');

    if (!fs.existsSync(commandsPath)) {
        fs.mkdirSync(commandsPath, { recursive: true });
    }

    try {
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);

            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                console.log(chalk.green(`✓ Loaded command: ${command.data.name}`));
            } else {
                console.log(chalk.yellow(`⚠ Warning: ${file} is missing required "data" or "execute" property.`));
            }
        }
    } catch (error) {
        console.log(chalk.yellow('⚠ No commands directory found, skipping command loading.'));
    }
};

const loadEvents = () => {
    const eventsPath = path.join(__dirname, 'events');

    if (!fs.existsSync(eventsPath)) {
        fs.mkdirSync(eventsPath, { recursive: true });
    }

    try {
        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

        for (const file of eventFiles) {
            const filePath = path.join(eventsPath, file);
            const event = require(filePath);

            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args));
            } else {
                client.on(event.name, (...args) => event.execute(...args));
            }
            console.log(chalk.green(`✓ Loaded event: ${event.name}`));
        }
    } catch (error) {
        console.log(chalk.yellow('⚠ No events directory found, using default events.'));
    }
};

client.once(Events.ClientReady, async () => {
    console.log(chalk.green(`✅ ${client.user.tag} is online and ready!`));
    console.log(chalk.cyan(`🎵 Music bot serving ${client.guilds.cache.size} servers!`));

    setInterval(() => client.user.setActivity({ name: `${config.bot.status}`, type: ActivityType.Listening }), 10000);

    await cleanupAudioCache();
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(chalk.red(`❌ No command matching ${interaction.commandName} was found.`));
        return;
    }

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(chalk.red(`❌ Error executing ${interaction.commandName}:`), error);

        const errorMessage = '❌ An error occurred while executing this command!';

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guild = oldState.guild;
    const player = client.players.get(guild.id);
    if (!player) return;

    const botMember = guild.members.me;
    const botId = botMember?.id ?? client.user.id;
    const involvesBot = oldState.id === botId || newState.id === botId;

    if (involvesBot) {
        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        if (oldChannelId && !newChannelId) {
            try {
                const embedManager = client.musicEmbedManager || global.clients?.musicEmbedManager;

                player.pendingEndReason = 'forced-disconnect';
                player.queue = [];
                player.currentTrack = null;

                if (embedManager) {
                    await embedManager.handlePlaybackEnd(player);
                } else if (typeof player.showQueueCompleted === 'function') {
                    await player.showQueueCompleted();
                }
            } catch (error) {
                console.error('❌ Failed to update playback UI after forced disconnect:', error);
            } finally {
                player.cleanup();
                client.players.delete(guild.id);
            }
            return;
        }

        if (newChannelId && oldChannelId !== newChannelId) {
            if (newState.channel) {
                await player.moveToChannel(newState.channel);
                player.clearInactivityTimer(false);
                if (client.musicEmbedManager) {
                    await client.musicEmbedManager.updateNowPlayingEmbed(player);
                }
            }
        }

        const wasMuted = oldState.serverMute || oldState.serverDeaf || oldState.suppress;
        const isMuted = newState.serverMute || newState.serverDeaf || newState.suppress;

        if (!wasMuted && isMuted) {
            const paused = player.pauseFor('mute');
            if (paused && client.musicEmbedManager) {
                await client.musicEmbedManager.updateNowPlayingEmbed(player);
            }
        } else if (wasMuted && !isMuted) {
            const resumed = player.resumeFor('mute');
            if (client.musicEmbedManager && (resumed || !player.pauseReasons.has('mute'))) {
                await client.musicEmbedManager.updateNowPlayingEmbed(player);
            }
        }
    }

    const voiceChannelId = player.voiceChannel?.id;
    if (!voiceChannelId) return;

    if (oldState.channelId === voiceChannelId || newState.channelId === voiceChannelId) {
        const channel = guild.channels.cache.get(voiceChannelId);

        if (!channel) {
            player.cleanup();
            client.players.delete(guild.id);
            return;
        }

        const listeners = channel.members.filter(member => !member.user.bot).size;

        if (listeners === 0) {
            const alreadyPaused = player.pauseReasons.has('alone');
            player.startInactivityTimer();
            if (!alreadyPaused && client.musicEmbedManager && player.currentTrack) {
                await client.musicEmbedManager.updateNowPlayingEmbed(player);
            }
        } else {
            const wasPausedForAlone = player.pauseReasons.has('alone');
            player.clearInactivityTimer(true);
            if (wasPausedForAlone && client.musicEmbedManager && player.currentTrack) {
                await client.musicEmbedManager.updateNowPlayingEmbed(player);
            }
        }
    }
});

process.on('SIGINT', () => {
    client.players.forEach((player, guildId) => {
        player.stop();
        const connection = getVoiceConnection(guildId);
        if (connection) connection.destroy();
    });
    client.destroy();
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('❌ Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);

    if (reason && reason.code) {
        switch (reason.code) {
            case 10062:
                console.log(chalk.yellow('ℹ️ Interaction has expired, safely ignoring...'));
                return;
            case 40060:
                console.log(chalk.yellow('ℹ️ Interaction already acknowledged, safely ignoring...'));
                return;
            case 50013:
                console.error(chalk.red('❌ Missing permissions for Discord action'));
                return;
        }
    }

    if (reason && reason.message && reason.message.includes('IP discovery')) {
        client.players.forEach(player => {
            if (player && player.cleanup) {
                player.cleanup();
            }
        });
        client.players.clear();
        return;
    }
});

process.on('uncaughtException', (error) => {
    console.error(chalk.red('❌ Uncaught Exception:'), error);

    if (error.code === 10062 || error.code === 40060) {
        console.log(chalk.yellow('ℹ️ Discord interaction error handled, continuing...'));
        return;
    }

    if (error.message && (error.message.includes('terminated') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT'))) {
        console.log(chalk.yellow('⚠️ Network error occurred, but bot continues running...'));
        return;
    }

    console.log(chalk.red('🛑 Critical error occurred, shutting down...'));

    if (client && client.players) {
        client.players.forEach(player => {
            if (player && player.cleanup) {
                player.cleanup();
            }
        });
        client.players.clear();
    }

    process.exit(1);
});

const init = async () => {
    try {
        await checkYtDlpUpdate();

        console.log(chalk.blue('🤖 Starting Discord Music Bot...'));

        loadCommands();
        loadEvents();

        await client.login(config.discord.token);
    } catch (error) {
        console.error(chalk.red('❌ Failed to start bot:'), error);
        process.exit(1);
    }
};

init();

module.exports = client;
