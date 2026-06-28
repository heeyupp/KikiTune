const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder } = require('discord.js');
const MusicPlayer = require('../src/MusicPlayer');
const config = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('장르를 선택하면 자동으로 음악을 재생합니다'),

    async execute(interaction, client) {
        const member = interaction.member;
        const guild = interaction.guild;

        if (!member.voice.channel) {
            return await interaction.reply({
                content: '🔇 음성 채널에 먼저 접속해주세요.',
                flags: [1 << 6]
            });
        }

        const permissions = member.voice.channel.permissionsFor(guild.members.me);
        if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
            return await interaction.reply({
                content: '❌ 음성 채널에 접속할 권한이 없습니다.',
                flags: [1 << 6]
            });
        }

        const botVoiceChannel = guild.members.me.voice.channel;
        if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
            return await interaction.reply({
                content: '❌ 봇과 같은 음성 채널에 있어야 합니다.',
                flags: [1 << 6]
            });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(`autoplay_start:${member.id}`)
            .setPlaceholder('장르를 선택하세요')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('K-POP').setValue('kpop').setEmoji('🇰🇷'),
                new StringSelectMenuOptionBuilder().setLabel('POP').setValue('pop').setEmoji('🎤'),
                new StringSelectMenuOptionBuilder().setLabel('국내 힙합').setValue('khiphop').setEmoji('🎧'),
                new StringSelectMenuOptionBuilder().setLabel('해외 힙합').setValue('hiphop').setEmoji('🔥'),
                new StringSelectMenuOptionBuilder().setLabel('J-POP').setValue('jpop').setEmoji('🇯🇵'),
                new StringSelectMenuOptionBuilder().setLabel('애니 OST').setValue('anime').setEmoji('🎌'),
                new StringSelectMenuOptionBuilder().setLabel('로파이').setValue('lofi').setEmoji('🌙'),
                new StringSelectMenuOptionBuilder().setLabel('한국 발라드').setValue('ballad').setEmoji('🎹'),
                new StringSelectMenuOptionBuilder().setLabel('EDM / 일렉트로닉').setValue('electronic').setEmoji('🎛️'),
                new StringSelectMenuOptionBuilder().setLabel('헤비메탈').setValue('metal').setEmoji('🤘'),
                new StringSelectMenuOptionBuilder().setLabel('랜덤').setValue('random').setEmoji('🎲'),
            );

        const row = new ActionRowBuilder().addComponents(select);

        const embed = new EmbedBuilder()
            .setTitle('🎲 오토플레이')
            .setDescription('장르를 선택하면 자동으로 음악을 재생합니다.')
            .setColor(config.bot.embedColor);

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: [1 << 6]
        });
    }
};
