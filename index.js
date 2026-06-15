require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    REST,
    Routes,
    PermissionFlagsBits
} = require('discord.js');
const { Translate } = require('@google-cloud/translate').v2;
const fs = require('fs');
const path = require('path');

// Inicialização do cliente Discord e do tradutor do Google
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Inicializa o tradutor usando a chave de API do Google Cloud
const translate = new Translate({ key: process.env.GOOGLE_TRANSLATE_KEY });

function logger(level, message, error = null) {
    const timestamp = new Date().toISOString();
    const errorDetails = error ? ` | Detalhes: ${error.stack || error.message}` : '';
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${errorDetails}`);
}

const configPath = path.join(__dirname, 'config.json');
let config = null;

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    logger('info', 'Configurações carregadas.');
} catch (err) {
    logger('critical', 'Falha ao ler config.json.', err);
    process.exit(1);
}

const CATEGORY_COLORS = {
    news: 0xFF4B4B,
    guides: 0x2ECC71,
    videos: 0x3498DB
};

client.once('ready', async () => {
    logger('info', `Bot online como: ${client.user.tag}`);
    const commands = [{
        name: 'status',
        description: 'Valida as rotas operacionais de idiomas.',
        default_member_permissions: PermissionFlagsBits.Administrator.toString()
    }];
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        logger('info', 'Comandos Slash registrados.');
    } catch (error) {
        logger('error', 'Erro ao registrar comandos Slash.', error);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.system) return;

    const { watchChannels, notifyChannels } = config;
    const category = Object.keys(watchChannels).find(key => watchChannels[key] === message.channel.id);
    if (!category) return;

    logger('info', `Nova publicação em #${message.channel.name} [${category.toUpperCase()}]`);

    const originalText = message.content;
    
    // Se a mensagem não tiver texto (ex: apenas uma imagem), define um padrão sem tradução
    if (!originalText) {
        const embedColor = CATEGORY_COLORS[category] || 0x2B2D31;
        const fallbackEmbed = new EmbedBuilder()
            .setTitle(`📢 Nova Atualização em [${category.toUpperCase()}]`)
            .setDescription('A publicação original contém um anexo de mídia ou conteúdo externo.')
            .setColor(embedColor)
            .setTimestamp();
            
        if (message.attachments.size > 0 && message.attachments.first().contentType?.startsWith('image/')) {
            fallbackEmbed.setImage(message.attachments.first().url);
        }
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Abrir Publicação').setStyle(ButtonStyle.Link).setURL(message.url));
        
        for (const [langCode, targetId] of Object.entries(notifyChannels)) {
            const ch = await client.channels.fetch(targetId).catch(() => null);
            if (ch) ch.send({ embeds: [fallbackEmbed], components: [row] });
        }
        return;
    }

    // Processamento de tradução e envio dinâmico por idioma
    const embedColor = CATEGORY_COLORS[category] || 0x2B2D31;
    const linkButton = new ButtonBuilder().setLabel('Abrir Publicação Original').setStyle(ButtonStyle.Link).setURL(message.url);
    const interactiveRow = new ActionRowBuilder().addComponents(linkButton);

    const distributionPromises = Object.entries(notifyChannels).map(async ([langCode, targetChannelId]) => {
        try {
            const targetChannel = await client.channels.fetch(targetChannelId).catch(() => null);
            if (!targetChannel) return;

            let translatedText = originalText;
            
            // Solicita a tradução para a API do Google Cloud
            try {
                const [translation] = await translate.translate(originalText, langCode);
                translatedText = translation;
            } catch (translationError) {
                logger('error', `Falha ao traduzir para o idioma [${langCode.toUpperCase()}], enviando texto original.`, translationError);
            }

            // Monta o Embed com o texto já traduzido
            const updateEmbed = new EmbedBuilder()
                .setTitle(`📢 [${langCode.toUpperCase()}] • Nova Atualização / New Update`)
                .setDescription(translatedText)
                .setColor(embedColor)
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .setTimestamp()
                .setFooter({ text: `Rede Multilíngue • Origem: #${message.channel.name}` });

            if (message.attachments.size > 0) {
                const primaryAttachment = message.attachments.first();
                if (primaryAttachment.contentType && primaryAttachment.contentType.startsWith('image/')) {
                    updateEmbed.setImage(primaryAttachment.url);
                }
            }

            await targetChannel.send({ 
                embeds: [updateEmbed], 
                components: [interactiveRow] 
            });
            logger('info', `Notificação traduzida e enviada para: [${langCode.toUpperCase()}]`);
        } catch (sendError) {
            logger('error', `Falha na rota [${langCode.toUpperCase()}]`, sendError);
        }
    });

    await Promise.all(distributionPromises);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'status') return;
    const monitoredList = Object.entries(config.watchChannels).map(([k, v]) => `• **${k.toUpperCase()}**: <#${v}>`).join('\n');
    const targetList = Object.entries(config.notifyChannels).map(([k, v]) => `• 🌍 **${k.toUpperCase()}**: <#${v}>`).join('\n');
    const diag = new EmbedBuilder().setTitle('⚙️ Diagnóstico Operacional').addFields({ name: 'Monitorando', value: monitoredList }, { name: 'Destinos', value: targetList }).setColor(0x2B2D31);
    await interaction.reply({ embeds: [diag], ephemeral: true });
});

process.on('unhandledRejection', (reason) => logger('critical', `Unhandled Rejection: ${reason}`));
process.on('uncaughtException', (error) => logger('critical', `Uncaught Exception`, error));

client.login(process.env.DISCORD_TOKEN);
