const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { getHelpTopicKeys } = require('./helpTopics');
const { getDiscordToken } = require('./token');

async function main() {
	const token = getDiscordToken();
	if (!token) {
		console.error(
			'Token Discord manquant. Défini DISCORD_TOKEN ou mets-le dans ../cle/Butler_key.txt (compat: ../Clé/Butler_key.txt).'
		);
		process.exit(1);
	}

	const clientId = (process.env.DISCORD_CLIENT_ID || '').trim();
	if (!clientId) {
		console.error(
			'DISCORD_CLIENT_ID manquant. Copie l’Application ID dans le Discord Developer Portal et mets-le en variable d’environnement.'
		);
		process.exit(1);
	}

	const guildId = (process.env.DISCORD_GUILD_ID || '').trim();

	const aideButler = new SlashCommandBuilder()
		.setName('aide_butler')
		.setDescription('Affiche l’aide de Butler (avec auto-complétion).')
		.addStringOption((opt) =>
			opt
				.setName('sujet')
				.setDescription(`Choisis un sujet: ${getHelpTopicKeys().join(', ')}`)
				.setAutocomplete(true)
				.setRequired(false)
		);

	const fortune = new SlashCommandBuilder()
		.setName('fortune')
		.setDescription('Roue de la fortune (2 tours).')
		.addSubcommand((sc) =>
			sc.setName('tourner').setDescription('Tourner la roue (2 tours).')
		)
		.addSubcommand((sc) =>
			sc
				.setName('porte_monnaie')
				.setDescription('Affiche ton solde personnel.')
		);

	const fortuneReset = new SlashCommandBuilder()
		.setName('fortune_reset')
		.setDescription('Réinitialise le cooldown fortune d’un joueur (Fondateur uniquement).')
		.addUserOption((opt) =>
			opt
				.setName('joueur')
				.setDescription('Le joueur dont tu veux reset le cooldown.')
				.setRequired(true)
		);

	const chanceux = new SlashCommandBuilder()
		.setName('chanceux')
		.setDescription('Gestion du rôle chanceux.')
		.addSubcommand((sc) =>
			sc
				.setName('donner')
				.setDescription('Donne le rôle chanceux à un joueur.')
				.addUserOption((opt) =>
					opt
						.setName('joueur')
						.setDescription('Le joueur à qui donner le rôle.')
						.setRequired(true)
				)
		);

	const commands = [aideButler.toJSON(), fortune.toJSON(), fortuneReset.toJSON(), chanceux.toJSON()];
	const rest = new REST({ version: '10' }).setToken(token);

	if (guildId) {
		await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
			body: commands,
		});
		console.log('Slash commands enregistrées pour le serveur (guild).');
		return;
	}

	await rest.put(Routes.applicationCommands(clientId), { body: commands });
	console.log(
		'Slash commands enregistrées en GLOBAL. Attention: la mise à jour peut prendre un certain temps.'
	);
}

main().catch((err) => {
	console.error('Erreur register-commands:', err);
	process.exit(1);
});
