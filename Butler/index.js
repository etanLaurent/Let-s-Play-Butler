const {
	AttachmentBuilder,
	Client,
	Events,
	GatewayIntentBits,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');
const { getDiscordToken } = require('./token');
const { formatHelpTopic, getHelpTopicKeys } = require('./helpTopics');
const { spinRewardWithIndex, spinTier, resolveGrandRiskSequence } = require('./fortune');
	const { renderFortuneWheelPng, renderTierWheelPng, renderRouletteWheelPng } = require('./fortuneRender');
	const {
		ROULETTE_ORDER,
		getRouletteColor,
		parseRouletteChoice,
		spinRoulette,
		resolveRouletteBet,
	} = require('./roulette');
const {
	getBalance,
	addBalance,
	spendBalance,
	getFortuneCooldownUntilMs,
	setFortuneCooldownUntilMs,
	getPendingMultiplier,
	setPendingMultiplier,
	clearPendingMultiplier,
} = require('./wallet');

// (Ancien) message Draftbot — désactivé par défaut, voir DROPXP_ENABLED.
const DROPXP_MESSAGE = '/dropxp expérience:100 temps:5min';
let dropXpTimer = null;

// Création d'une nouvelle instance du client Discord
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

const REWARDS_CHANNEL_NAME = '┃✨┃récompenses';
const FOUNDER_ROLE_NAME = 'Fondateur';
const LUCKY_ROLE_NAME = 'chanceux';
const DEFAULT_FORTUNE_COOLDOWN_HOURS = 72;
const SHOP_FORTUNE_REROLL_PRICE = 200;
const SHOP_FORTUNE_REROLL_BUTTON_ID = 'shop_buy_fortune_reroll';
const SHOP_GRAND_RISK_PRICE = 2500;
const SHOP_GRAND_RISK_BUTTON_ID = 'shop_buy_grand_risk';

function formatEuro(value) {
	return `${Math.max(0, Number(value) || 0).toLocaleString('fr-FR')} €`;
}

function formatDurationFr(ms) {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const totalMinutes = Math.floor(totalSeconds / 60);
	const totalHours = Math.floor(totalMinutes / 60);
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	const minutes = totalMinutes % 60;

	const parts = [];
	if (days) parts.push(`${days}j`);
	if (hours || parts.length) parts.push(`${hours}h`);
	parts.push(`${minutes}m`);
	return parts.join(' ');
}

function parseEuroAmount(text) {
	const s = String(text || '').replace(',', '.');
	const m = /(-?\d+(?:\.\d+)?)\s*€/.exec(s);
	if (!m) return null;
	const n = Number(m[1]);
	if (!Number.isFinite(n)) return null;
	return n;
}

function computeMoneyDelta({ label, text }) {
	const fromLabel = parseEuroAmount(label);
	const fromText = parseEuroAmount(text);
	let amount = fromLabel ?? fromText;
	if (amount == null) return 0;

	// Si le texte indique une perte et que le montant n'est pas déjà négatif.
	if (amount > 0) {
		const isLoss = /perd|perds|perdez|perte/i.test(String(text || ''));
		if (isLoss && !(String(label || '').trim().startsWith('-'))) amount = -amount;
	}
	return amount;
}

function parseCooldownHours(text) {
	const m = /(\d{1,3})\s*h/i.exec(String(text || ''));
	if (!m) return null;
	const h = Number(m[1]);
	if (!Number.isFinite(h) || h <= 0 || h > 336) return null;
	return h;
}

function round2(n) {
	return Math.round((Number(n) || 0) * 100) / 100;
}

function parseRelanceEffect(label, text) {
	const s = `${String(label || '')} ${String(text || '')}`.toLowerCase();
	let extraSpins = 0;
	if (s.includes('double relance')) extraSpins = 2;
	else if (s.includes('relance') || s.includes('rejouer')) extraSpins = 1;
	if (!extraSpins) return null;

	// Multiplicateur (appliqué au prochain gain en €)
	let multiplier = 1;
	const m = /x\s*(\d+(?:[\.,]\d+)?)/i.exec(String(label || ''));
	if (m) {
		multiplier = Number(String(m[1]).replace(',', '.'));
	}
	if (!Number.isFinite(multiplier) || multiplier <= 0) multiplier = 1;
	if (multiplier === 1) {
		if (s.includes('trois fois')) multiplier = 3;
		else if (s.includes('20 %') || s.includes('20%')) multiplier = 1.2;
	}

	return { extraSpins, multiplier };
}

function buildBoutiqueEmbed(balance) {
	return new EmbedBuilder()
		.setColor(0xc026d3)
		.setTitle('🛍️ Boutique Butler')
		.setDescription(
			[
				'Utilise ton argent gagné avec la roue pour acheter des bonus et objets.',
				'Boutique ouverte - achat rapide via les boutons ci-dessous.',
			].join('\n')
		)
		.addFields({
			name: '🎡 Relance immédiate',
			value: [
				'Relance immédiatement la roue sans attendre le cooldown.',
				`Prix: **${formatEuro(SHOP_FORTUNE_REROLL_PRICE)}**`,
				'Tu réinitialises ton cooldown Fortune au moment de l’achat.',
			].join('\n'),
		}, {
			name: '🟣 Roue du grand risque',
			value: [
				'Une roue en 1 tour avec 9 issues: 1 rien, 4 bonus et 4 malus.',
				`Prix: **${formatEuro(SHOP_GRAND_RISK_PRICE)}**`,
				'Le résultat est appliqué immédiatement après l’achat.',
			].join('\n'),
		})
		.setFooter({
			text: `Solde: ${formatEuro(balance)} • Tri: Prix croissant`,
		});
}

function buildBoutiqueComponents() {
	return [
		new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(SHOP_FORTUNE_REROLL_BUTTON_ID)
				.setLabel('Acheter 200 €')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(SHOP_GRAND_RISK_BUTTON_ID)
				.setLabel('Grand risque 2500 €')
				.setStyle(ButtonStyle.Danger)
		)
	];
}

function buildGrandRiskResultEmbed({ balanceBefore, balanceAfter, steps }) {
	const primaryReward = steps[0] && steps[0].reward ? steps[0].reward : null;
	const primaryText = primaryReward ? primaryReward.text : 'Résultat inconnu';
	const isGain = /\b\d+\s*€/i.test(primaryText) && !/perd/i.test(primaryText);
	const isLoss = /perd/i.test(primaryText);
	return new EmbedBuilder()
		.setColor(isGain ? 0xd946ef : isLoss ? 0x4c1d95 : 0x111827)
		.setTitle('🟣 Roue du grand risque')
		.setDescription(
			[
				`Coût de lancement: **${formatEuro(SHOP_GRAND_RISK_PRICE)}**`,
				...steps.map((step) => {
					const reward = step.reward || {};
					return `🎯 **${reward.label}** → ${reward.text}`;
				}),
				`Solde avant: **${formatEuro(balanceBefore)}**`,
				`Solde après: **${formatEuro(balanceAfter)}**`,
			].join('\n')
		);
}

async function resolveRewardsChannel(guild) {
	if (!guild) return null;
	const channelId = (process.env.REWARDS_CHANNEL_ID || '').trim();
	if (channelId) {
		try {
			const ch = await guild.channels.fetch(channelId);
			if (ch && ch.isTextBased && ch.isTextBased()) return ch;
		} catch {
			// ignore
		}
	}

	const exact = guild.channels.cache.find(
		(c) => c && c.isTextBased && c.isTextBased() && c.name === REWARDS_CHANNEL_NAME
	);
	if (exact) return exact;

	const fallback = guild.channels.cache.find(
		(c) =>
			c &&
			c.isTextBased &&
			c.isTextBased() &&
			String(c.name || '').toLowerCase().includes('récomp')
	);
	return fallback || null;
}

function interactionMemberHasRoleByName(interaction, roleName) {
	const guild = interaction.guild;
	if (!guild) return false;
	const role = guild.roles.cache.find(
		(r) => String(r.name || '').toLowerCase() === String(roleName || '').toLowerCase()
	);
	if (!role) return false;
	const roles = interaction.member && interaction.member.roles;
	if (!roles) return false;
	if (Array.isArray(roles)) return roles.includes(role.id);
	if (roles.cache && roles.cache.has) return roles.cache.has(role.id);
	return false;
}

async function ensureRoleByName(guild, roleName) {
	const name = String(roleName || '').trim();
	if (!name) return null;
	const existing = guild.roles.cache.find(
		(r) => String(r.name || '').toLowerCase() === name.toLowerCase()
	);
	if (existing) return existing;
	try {
		return await guild.roles.create({ name });
	} catch {
		return null;
	}
}

async function grantRoleToUser(guild, userId, roleName) {
	const role = await ensureRoleByName(guild, roleName);
	if (!role) return { ok: false, reason: 'role_missing_or_create_failed' };
	const member = await guild.members.fetch(userId);
	if (member.roles.cache.has(role.id)) return { ok: true, already: true, role };
	await member.roles.add(role);
	return { ok: true, already: false, role };
}

async function resolveDropXpChannel(discordClient) {
	const channelId = process.env.DROPXP_CHANNEL_ID && process.env.DROPXP_CHANNEL_ID.trim();
	if (channelId) {
		try {
			const channel = await discordClient.channels.fetch(channelId);
			if (!channel || !channel.isTextBased()) return null;
			return channel;
		} catch {
			return null;
		}
	}

	const targetName = (process.env.DROPXP_CHANNEL_NAME || '┃💬┃général').trim();

	const matches = [];
	for (const channel of discordClient.channels.cache.values()) {
		if (channel && channel.isTextBased && channel.isTextBased() && channel.name === targetName) {
			matches.push(channel);
		}
	}

	if (matches.length === 1) return matches[0];
	return null;
}

function computeNextRandomRun(now = new Date()) {
	const minutesInDay = 24 * 60;
	const randomMinute = Math.floor(Math.random() * minutesInDay);
	const hours = Math.floor(randomMinute / 60);
	const minutes = randomMinute % 60;

	const candidate = new Date(now);
	candidate.setSeconds(0, 0);
	candidate.setHours(hours, minutes, 0, 0);

	if (candidate.getTime() <= now.getTime() + 60_000) {
		candidate.setDate(candidate.getDate() + 1);
	}
	return candidate;
}

async function scheduleDailyRandomDropXp(discordClient) {
	const enabled = (process.env.DROPXP_ENABLED || '').toLowerCase();
	if (!['1', 'true', 'yes', 'y', 'on'].includes(enabled)) return;

	if (dropXpTimer) {
		clearTimeout(dropXpTimer);
		dropXpTimer = null;
	}

	const channel = await resolveDropXpChannel(discordClient);
	if (!channel) {
		console.log(
			'Auto /dropxp non configuré. Définis au choix :\n' +
				'- DROPXP_CHANNEL_ID (recommandé)\n' +
				'- ou DROPXP_CHANNEL_NAME (ex: "┃💬┃général")\n'
		);
		return;
	}

	const nextRun = computeNextRandomRun(new Date());
	const delayMs = nextRun.getTime() - Date.now();
	console.log(`Prochain /dropxp prévu le ${nextRun.toLocaleString()} dans #${channel.name}`);

	dropXpTimer = setTimeout(async () => {
		try {
			await channel.send(DROPXP_MESSAGE);
			console.log(`Message /dropxp envoyé dans #${channel.name}`);
		} catch (err) {
			console.error('Échec envoi /dropxp :', err);
		} finally {
			scheduleDailyRandomDropXp(discordClient);
		}
	}, delayMs);
}

client.once(Events.ClientReady, () => {
	console.log(`Connecté en tant que ${client.user.tag}!`);
	scheduleDailyRandomDropXp(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
	try {
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		if (interaction.isAutocomplete && interaction.isAutocomplete()) {
			if (interaction.commandName === 'roulette') {
				const focused = (interaction.options.getString('choix') || '').toLowerCase();
				const choices = ['rouge', 'noir', 'vert', ...Array.from({ length: 37 }, (_, i) => String(i))];
				await interaction.respond(
					choices
						.filter((choice) => choice.includes(focused))
						.slice(0, 25)
						.map((choice) => ({ name: choice, value: choice }))
				);
				return;
			}
			if (interaction.commandName !== 'aide_butler') return;
			const focused = (interaction.options.getFocused() || '').toLowerCase();
			const keys = getHelpTopicKeys();
			const filtered = keys
				.filter((k) => k.toLowerCase().includes(focused))
				.slice(0, 25)
				.map((k) => ({ name: k, value: k }));
			await interaction.respond(filtered);
			return;
		}

		if (interaction.isButton && interaction.isButton()) {
			if (interaction.customId !== SHOP_FORTUNE_REROLL_BUTTON_ID && interaction.customId !== SHOP_GRAND_RISK_BUTTON_ID) return;

			if (interaction.customId === SHOP_GRAND_RISK_BUTTON_ID) {
				const spendResult = spendBalance(interaction.user.id, SHOP_GRAND_RISK_PRICE);
				if (!spendResult.ok) {
					await interaction.reply({
						content: `Solde insuffisant. Il te faut encore **${formatEuro(SHOP_GRAND_RISK_PRICE - spendResult.balance)}** pour lancer la roue du grand risque.`,
						ephemeral: true,
					});
					return;
				}

				const balanceBefore = spendResult.balance + SHOP_GRAND_RISK_PRICE;
				const steps = resolveGrandRiskSequence();
				await interaction.deferReply();

				const header = '🟣 **Roue du grand risque**';
				const bar = (filled, total) => '▰'.repeat(filled) + '▱'.repeat(Math.max(0, total - filled));

				await interaction.editReply([header, '', 'La roue du grand risque tourne... 🔄', bar(1, 6)].join('\n'));
				await sleep(900);
				await interaction.editReply([header, '', 'La roue du grand risque tourne... 🔄', bar(3, 6)].join('\n'));
				await sleep(900);
				await interaction.editReply([header, '', 'La roue du grand risque tourne... 🔄', bar(5, 6)].join('\n'));
				await sleep(900);

				const files = [];
				const summarySteps = [];

				for (let i = 0; i < steps.length; i++) {
					const step = steps[i];
					const isGolden = String(step.wheel || '').toLowerCase() === 'golden';
					const png = renderFortuneWheelPng({
						tier: isGolden ? 'golden' : 'super',
						labels: step.labels,
						selectedIndex: step.index,
						size: 512,
					});
					files.push(new AttachmentBuilder(png, { name: isGolden ? 'grand-risque-doree.png' : 'grand-risque.png' }));

					const reward = step.reward || {};
					const moneyDelta = computeMoneyDelta({ label: reward.label, text: reward.text });
					if (moneyDelta !== 0) {
						addBalance(interaction.user.id, moneyDelta);
					}

					summarySteps.push(`🎯 **${reward.label}** → ${reward.text}`);

					const nextHeader = isGolden && i === 0
						? [header, '', `Tour 1 → **${reward.label}**`, '', 'La roue dorée tourne... 🌟', bar(1, 6)].join('\n')
						: [header, '', `Tour ${i + 1} → **${reward.label}**`].join('\n');

					await interaction.editReply({
						content: nextHeader,
						files: files.slice(),
					});

					if (isGolden && i === 0) {
						await sleep(900);
						await interaction.editReply([header, '', `Tour 1 → **${reward.label}**`, '', 'La roue dorée tourne... 🌟', bar(3, 6)].join('\n'));
						await sleep(900);
						await interaction.editReply([header, '', `Tour 1 → **${reward.label}**`, '', 'La roue dorée tourne... 🌟', bar(5, 6)].join('\n'));
						await sleep(900);
					}
				}

				const balanceAfter = getBalance(interaction.user.id);

				try {
					const rewardsChannel = await resolveRewardsChannel(interaction.guild);
					if (rewardsChannel) {
						await rewardsChannel.send(
							[
								`🟣 Grand risque — ${interaction.user}`,
								`Solde avant: **${formatEuro(balanceBefore)}**`,
								`Solde après: **${formatEuro(balanceAfter)}**`,
								'',
								...steps.map((step, index) => {
									const reward = step.reward || {};
									const prefix = index === 0 ? 'Tour 1' : `Tour ${index + 1}`;
									return `${prefix} → **${reward.label}** : ${reward.text}`;
								}),
							].join('\n')
						);
					}
				} catch (err) {
					console.error('Erreur annonce grand risque:', err);
				}

				await interaction.editReply({
					content: [
						header,
						'',
						`Solde avant: **${formatEuro(balanceBefore)}**`,
						`Solde après: **${formatEuro(balanceAfter)}**`,
						'',
						...summarySteps,
					].join('\n'),
					files,
				});
				return;
			}

			const result = spendBalance(interaction.user.id, SHOP_FORTUNE_REROLL_PRICE);
			if (!result.ok) {
				await interaction.reply({
					content: `Solde insuffisant. Il te faut encore **${formatEuro(SHOP_FORTUNE_REROLL_PRICE - result.balance)}** pour acheter cette relance.`,
					ephemeral: true,
				});
				return;
			}

			setFortuneCooldownUntilMs(interaction.user.id, 0);
			await interaction.update({
				embeds: [buildBoutiqueEmbed(result.balance)],
				components: buildBoutiqueComponents(),
			});
			await interaction.followUp({
				content: '✅ Achat validé. Tu peux relancer la roue tout de suite avec /fortune tourner.',
				ephemeral: true,
			});
			return;
		}

		if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;

		if (interaction.commandName === 'roulette') {
			const stake = interaction.options.getNumber('mise', true);
			const choice = interaction.options.getString('choix', true);
			const parsedChoice = parseRouletteChoice(choice);
			if (!parsedChoice) {
				await interaction.reply({ content: 'Choix invalide. Utilise rouge, noir, vert ou un numéro de 0 à 36.', ephemeral: true });
				return;
			}

			const spendResult = spendBalance(interaction.user.id, stake);
			if (!spendResult.ok) {
				await interaction.reply({
					content: `Solde insuffisant. Il te manque **${formatEuro(stake - spendResult.balance)}**.`,
					ephemeral: true,
				});
				return;
			}

			const result = spinRoulette();
			const resolution = resolveRouletteBet(choice, stake, result);
			const rouletteColors = ROULETTE_ORDER.map((number) => {
				const color = getRouletteColor(number);
				return color === 'rouge' ? { r: 180, g: 32, b: 45 } : color === 'noir' ? { r: 24, g: 26, b: 31 } : { r: 24, g: 140, b: 76 };
			});
			const wheel = renderRouletteWheelPng({ order: ROULETTE_ORDER, colors: rouletteColors, selectedIndex: result.index });
			const resultLabel = result.number === 0 ? '0 vert' : `${result.number} ${result.color}`;
			if (resolution.payout > 0) addBalance(interaction.user.id, resolution.payout);

			await interaction.reply({
				content: [
					'🎰 **Roulette européenne**',
					'',
					`Mise : **${formatEuro(stake)}** sur **${choice}**`,
					`Résultat : **${resultLabel}**`,
					resolution.won
						? `🎉 Gagné : **+${formatEuro(resolution.net)}** (paiement x${resolution.multiplier})`
						: resolution.bet.type === 'green'
							? `Perdu sur vert : remboursement de **${formatEuro(resolution.payout)}** (perte nette de ${formatEuro(Math.abs(resolution.net))}).`
							: `Perdu : la mise est entièrement perdue (**${formatEuro(Math.abs(resolution.net))}**).`,
					`Solde : **${formatEuro(getBalance(interaction.user.id))}**`,
				].join('\n'),
				files: [new AttachmentBuilder(wheel, { name: 'roulette.png' })],
			});
			return;
		}

		if (interaction.commandName === 'fortune_reset') {
			if (!interaction.guild) {
				await interaction.reply('Cette commande ne fonctionne que sur un serveur.');
				return;
			}

			const isFounder = interactionMemberHasRoleByName(interaction, FOUNDER_ROLE_NAME);
			if (!isFounder) {
				await interaction.reply(`Commande réservée au rôle **${FOUNDER_ROLE_NAME}**.`);
				return;
			}

			const user = interaction.options.getUser('joueur', true);
			setFortuneCooldownUntilMs(user.id, 0);

			try {
				const rewardsChannel = await resolveRewardsChannel(interaction.guild);
				if (rewardsChannel) {
					await rewardsChannel.send(
						`🛠️ Cooldown fortune reset pour ${user} (par ${interaction.user}).`
					);
				}
			} catch (err) {
				console.error('Erreur annonce reset cooldown:', err);
			}

			await interaction.reply(`✅ Cooldown fortune réinitialisé pour ${user}.`);
			return;
		}

		if (interaction.commandName === 'chanceux') {
			const sub = interaction.options.getSubcommand();
			if (sub !== 'donner') return;
			if (!interaction.guild) {
				await interaction.reply('Cette commande ne fonctionne que sur un serveur.');
				return;
			}
			const isFounder = interactionMemberHasRoleByName(interaction, FOUNDER_ROLE_NAME);
			if (!isFounder) {
				await interaction.reply(`Commande réservée au rôle **${FOUNDER_ROLE_NAME}**.`);
				return;
			}

			const user = interaction.options.getUser('joueur', true);
			try {
				const res = await grantRoleToUser(interaction.guild, user.id, LUCKY_ROLE_NAME);
				if (!res.ok) {
					await interaction.reply(
						`Impossible de créer/trouver le rôle **${LUCKY_ROLE_NAME}**. Vérifie que le bot a la permission Gérer les rôles.`
					);
					return;
				}

				const rewardsChannel = await resolveRewardsChannel(interaction.guild);
				if (rewardsChannel) {
					await rewardsChannel.send(
						`🍀 Rôle **${LUCKY_ROLE_NAME}** donné à ${user} (par ${interaction.user}).`
					);
				}

				await interaction.reply(
					res.already
						? `${user} a déjà le rôle **${LUCKY_ROLE_NAME}**.`
						: `✅ Rôle **${LUCKY_ROLE_NAME}** donné à ${user}.`
				);
			} catch (err) {
				console.error('Erreur /chanceux donner:', err);
				await interaction.reply('Erreur interne côté bot.');
			}
			return;
		}

		if (interaction.commandName === 'fortune') {
			const sub = interaction.options.getSubcommand();
			if (sub === 'porte_monnaie') {
				const balance = getBalance(interaction.user.id);
				const until = getFortuneCooldownUntilMs(interaction.user.id);
				const now = Date.now();
				const remaining = until > now ? until - now : 0;
				const pendingMult = getPendingMultiplier(interaction.user.id) || 1;
				const lines = [
					`💰 Solde de ${interaction.user} : **${balance} €**`,
					remaining
						? `⏱️ Prochain /fortune dans **${formatDurationFr(remaining)}**.`
						: `✅ /fortune disponible maintenant.`,
				];
				if (pendingMult && pendingMult !== 1) {
					lines.push(`🔢 Multiplicateur en attente: **x${pendingMult}**`);
				} else {
					lines.push('🔢 Pas de multiplicateur en attente.');
				}
				await interaction.reply(lines.join('\n'));
				return;
			}
			if (sub !== 'tourner') return;
			if (!interaction.guild) {
				await interaction.reply('Cette commande ne fonctionne que sur un serveur.');
				return;
			}

			const until = getFortuneCooldownUntilMs(interaction.user.id);
			const now = Date.now();
			if (until && until > now) {
				const remaining = until - now;
				await interaction.reply(
					`⏱️ Tu dois attendre encore **${formatDurationFr(remaining)}** avant de relancer la roue.`
				);
				return;
			}

			await interaction.deferReply();

			const header = '🎡 **Roue de la Fortune**';
			const bar = (filled, total) => '▰'.repeat(filled) + '▱'.repeat(Math.max(0, total - filled));

			// CHARGEMENT AVANT TOUR 1
			await interaction.editReply([header, '', 'Tour 1 → la roue tourne... 🔄', bar(1, 6)].join('\n'));
			await sleep(900);
			await interaction.editReply([header, '', 'Tour 1 → la roue tourne... 🔄', bar(3, 6)].join('\n'));
			await sleep(900);
			await interaction.editReply([header, '', 'Tour 1 → la roue tourne... 🔄', bar(5, 6)].join('\n'));
			await sleep(900);

			// TOUR 1 → roue à 3 slots
			const tier = spinTier();
			let tierFile = null;
			try {
				const tierPng = renderTierWheelPng({ selectedTier: tier, size: 512 });
				tierFile = new AttachmentBuilder(tierPng, { name: 'fortune-tour1.png' });
			} catch (err) {
				console.error('Erreur génération PNG tour 1 fortune:', err);
			}

			await interaction.editReply({
				content: [header, '', `Tour 1 → roue: **${tier}**`, '', 'Tour 2 → la roue tourne... 🔄', bar(1, 6)].join('\n'),
				files: tierFile ? [tierFile] : [],
			});
			await sleep(900);
			await interaction.editReply({
				content: [header, '', `Tour 1 → roue: **${tier}**`, '', 'Tour 2 → la roue tourne... 🔄', bar(3, 6)].join('\n'),
			});
			await sleep(900);
			await interaction.editReply({
				content: [header, '', `Tour 1 → roue: **${tier}**`, '', 'Tour 2 → la roue tourne... 🔄', bar(5, 6)].join('\n'),
			});
			await sleep(900);

			// TOUR 2 — Séquence de spins saine contrôlée pas-à-pas
			const maxSpinsCap = 15;
			let spinsRemaining = 1;
			let currentSpinCount = 0;
			
			let pendingMultiplier = getPendingMultiplier(interaction.user.id) || 1;
			let totalMoneyDelta = 0;
			let luckyGranted = null;
			let cooldownOverrideHours = null;
			const spinDetails = [];
			let lastWheelSpin = null;

			while (spinsRemaining > 0 && currentSpinCount < maxSpinsCap) {
				currentSpinCount++;
				spinsRemaining--; // On décrémente le lancer actuel

				const spin = spinRewardWithIndex(tier);
				const rewardText = String(spin.reward || '');
				const rewardLabel = String(spin.label || '');
				lastWheelSpin = spin;

				const relance = parseRelanceEffect(rewardLabel, rewardText);
				if (relance) {
					// On augmente le multiplicateur de manière cumulative
					pendingMultiplier = round2(pendingMultiplier * relance.multiplier);
					setPendingMultiplier(interaction.user.id, pendingMultiplier);
					
					spinDetails.push(`🔄 Lancer #${currentSpinCount} : ${rewardText} → (Multiplicateur cumulé: x${pendingMultiplier})`);

					const row = new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId('use_relance')
							.setLabel('Utiliser la relance')
							.setStyle(ButtonStyle.Primary)
					);

					const promptContent = [
						header,
						'',
						`Tour 1 → roue: **${tier}**`,
						'',
						`Lancer #${currentSpinCount} : **${rewardText}**`,
						`🔢 Multiplicateur actuel : **x${pendingMultiplier}**`,
						'',
						'Clique ci-dessous pour relancer la roue !'
					].join('\n');

					let clicked = false;
					try {
						await interaction.editReply({ content: promptContent, components: [row] });
						const promptMsg = await interaction.fetchReply();
						
						// Attente stricte du clic sur le bouton
						const btn = await promptMsg.awaitMessageComponent({
							filter: (i) => i.user.id === interaction.user.id,
							componentType: ComponentType.Button,
							time: 30000
						});

						if (btn.customId === 'use_relance') {
							clicked = true;
							await btn.update({ content: promptContent + '\n\n*Relance activée... 🔄*', components: [] });
							await sleep(1000);
							
							// On octroie les nouveaux lancers uniquement si l'utilisateur clique
							spinsRemaining += relance.extraSpins;
						}
					} catch (err) {
						// Timeout : on efface simplement le bouton
						try { await interaction.editReply({ components: [] }); } catch {}
					}

					// CORRECTION CRITIQUE : Si le joueur n'a pas cliqué ou s'il y a eu timeout, on arrête tout
					if (!clicked) {
						break;
					}
					// Si on a cliqué, on passe au prochain tour sainement
					continue;
				}

				// Traitement d'une récompense classique (pas une relance)
				const cd = parseCooldownHours(rewardText);
				if (cd) cooldownOverrideHours = cd;

				const isLuckyReward = /rôle\s+chanceux/i.test(rewardText);
				let baseMoney = computeMoneyDelta({ label: rewardLabel, text: rewardText });
				if (isLuckyReward) {
					try {
						const res = await grantRoleToUser(interaction.guild, interaction.user.id, LUCKY_ROLE_NAME);
						if (res.ok && !res.already) {
							luckyGranted = true;
							baseMoney = 0;
						} else if (res.ok && res.already) {
							luckyGranted = false;
						}
					} catch (err) {
						console.error('Erreur attribution rôle chanceux:', err);
					}
				}

				let appliedMoney = baseMoney;
				let appliedMultiplier = 1;
				
				// APPLICATION UNIQUE : Seulement sur un gain en argent positif (> 0)
				if (appliedMoney > 0 && pendingMultiplier !== 1) {
					appliedMultiplier = pendingMultiplier;
					appliedMoney = round2(appliedMoney * appliedMultiplier);
					
					// Le multiplicateur est consommé, on le réinitialise immédiatement
					pendingMultiplier = 1;
					try {
						clearPendingMultiplier(interaction.user.id);
					} catch (err) {
						console.error('Erreur clear pending multiplier:', err);
					}
				}
				
				if (appliedMoney !== 0) totalMoneyDelta = round2(totalMoneyDelta + appliedMoney);

				if (appliedMultiplier !== 1 && baseMoney > 0) {
					spinDetails.push(`✅ Lancer #${currentSpinCount} : ${rewardText} → **+${appliedMoney} €** (x${appliedMultiplier})`);
				} else if (appliedMoney !== 0) {
					spinDetails.push(`✅ Lancer #${currentSpinCount} : ${rewardText} → **${appliedMoney > 0 ? '+' : ''}${appliedMoney} €**`);
				} else {
					spinDetails.push(`✅ Lancer #${currentSpinCount} : ${rewardText}`);
				}
			}

			let newBalance = getBalance(interaction.user.id);
			if (totalMoneyDelta !== 0) {
				newBalance = addBalance(interaction.user.id, totalMoneyDelta);
			}
			const hasRelance = spinDetails.some((l) => String(l).includes('🔄'));
			const finalRewardText = String((lastWheelSpin && lastWheelSpin.reward) || '');

			const cooldownHours = cooldownOverrideHours || DEFAULT_FORTUNE_COOLDOWN_HOURS;
			setFortuneCooldownUntilMs(interaction.user.id, Date.now() + cooldownHours * 60 * 60 * 1000);

			let wheelFile = null;
			try {
				const wheelSpin = lastWheelSpin || spinRewardWithIndex(tier);
				const png = renderFortuneWheelPng({
					tier,
					labels: wheelSpin.labels,
					selectedIndex: wheelSpin.index,
					size: 512,
				});
				wheelFile = new AttachmentBuilder(png, { name: 'fortune-tour2.png' });
			} catch (err) {
				console.error('Erreur génération PNG fortune:', err);
			}

			const files = [];
			if (tierFile) files.push(tierFile);
			if (wheelFile) files.push(wheelFile);

			// Log et annonce de fin dans le salon récompenses
			try {
				const rewardsChannel = await resolveRewardsChannel(interaction.guild);
				if (rewardsChannel) {
					if (hasRelance) {
						const parts = [`🎡 Fortune — ${interaction.user} — Tier: **${tier}**`, 'Détails des lancers :'];
						parts.push(spinDetails.map((l) => `${l}`).join('\n'));
						if (luckyGranted === true) parts.push(`Rôle donné: **${LUCKY_ROLE_NAME}**`);
						else if (luckyGranted === false) parts.push(`Rôle **${LUCKY_ROLE_NAME}** déjà présent.`);
						if (totalMoneyDelta !== 0) parts.push(`Argent total: **${totalMoneyDelta > 0 ? '+' : ''}${totalMoneyDelta} €**`);
						parts.push(`Solde: **${newBalance} €**`);
						await rewardsChannel.send(parts.join('\n'));
					} else {
						const parts = [
							`🎡 Fortune — ${interaction.user} — Tier: **${tier}**`,
							`Résultat: **${finalRewardText}**`,
						];
						if (luckyGranted === true) parts.push(`Bonus: rôle **${LUCKY_ROLE_NAME}** obtenu 🍀`);
						else if (luckyGranted === false) parts.push(`Bonus: rôle **${LUCKY_ROLE_NAME}** déjà présent`);
						if (totalMoneyDelta !== 0) parts.push(`Argent: **${totalMoneyDelta > 0 ? '+' : ''}${totalMoneyDelta} €**`);
						parts.push(`Solde: **${newBalance} €**`);
						await rewardsChannel.send(parts.join('\n'));
					}
				}
			} catch (err) {
				console.error('Erreur annonce récompenses:', err);
			}

			const replyLines = [header, '', `Tour 1 → roue: **${tier}**`];
			if (hasRelance) {
				replyLines.push('', 'Résumé de vos lancers :');
				replyLines.push(spinDetails.map((l) => `${l}`).join('\n'));
				if (totalMoneyDelta !== 0) {
					replyLines.push(`\n💰 Argent total récolté : **${totalMoneyDelta > 0 ? '+' : ''}${totalMoneyDelta} €** (Nouveau solde: **${newBalance} €**)`);
				} else {
					replyLines.push(`\n💰 Solde final : **${newBalance} €**`);
				}
			} else {
				replyLines.push(`Résultat: **${finalRewardText}**`);
				if (totalMoneyDelta !== 0) replyLines.push(`Argent: **${totalMoneyDelta > 0 ? '+' : ''}${totalMoneyDelta} €**`);
				replyLines.push(`Solde: **${newBalance} €**`);
			}
			if (luckyGranted === true) replyLines.push(`Bonus: rôle **${LUCKY_ROLE_NAME}** obtenu 🍀`);
			else if (luckyGranted === false) replyLines.push(`Bonus: rôle **${LUCKY_ROLE_NAME}** déjà présent`);

			await interaction.editReply({
				content: replyLines.filter(Boolean).join('\n'),
				files,
			});
			return;
		}

		if (interaction.commandName === 'boutique') {
			const balance = getBalance(interaction.user.id);
			await interaction.reply({
				embeds: [buildBoutiqueEmbed(balance)],
				components: buildBoutiqueComponents(),
			});
			return;
		}

		if (interaction.commandName !== 'aide_butler') return;

		const topic = (interaction.options.getString('sujet') || '').toLowerCase();
		if (!topic) {
			await interaction.reply(
				'Aide Butler — choisis un sujet via l’option `sujet` (auto-complétion).\n' +
					`Sujets: ${getHelpTopicKeys().join(', ')}`
			);
			return;
		}

		const answer = formatHelpTopic(topic);
		if (!answer) {
			await interaction.reply(
				`Sujet inconnu: ${topic}\nSujets: ${getHelpTopicKeys().join(', ')}`
			);
			return;
		}

		await interaction.reply(answer);
	} catch (err) {
		console.error('Erreur interactionCreate:', err);
		try {
			if (interaction.isRepliable && interaction.isRepliable()) {
				await interaction.reply('Erreur interne côté bot.');
			}
		} catch {
			// ignore
		}
	}
});

client.on('messageCreate', async (message) => {
	if (message.author.bot) return;

	const content = message.content.trim();
	const lower = content.toLowerCase();

	if (lower.startsWith('!aide_butler')) {
		const parts = content.split(/\s+/g);
		const topic = (parts[1] || '').toLowerCase();

		if (!topic) {
			try {
				await message.reply(
					[
						'Aide Butler — utilise `!aide_butler <sujet>`',
						`Sujets: ${getHelpTopicKeys().join(', ')}`,
						'Ex: `!aide_butler ping`',
					].join('\n')
				);
			} catch (err) {
				console.error('Échec reply aide (sans sujet):', err);
			}
			return;
		}

		const answer = formatHelpTopic(topic);
		if (!answer) {
			try {
				await message.reply(
					[
						`Sujet inconnu: ${topic}`,
						`Sujets: ${getHelpTopicKeys().join(', ')}`,
					].join('\n')
				);
			} catch (err) {
				console.error('Échec reply aide (sujet inconnu):', err);
			}
			return;
		}

		try {
			await message.reply(answer);
		} catch (err) {
			console.error(`Échec reply aide (sujet=${topic}):`, err);
		}
		return;
	}

	if (message.content.toLowerCase() === 'ping') {
		try {
			await message.reply('Pong ! 🏓');
		} catch (err) {
			console.error('Échec reply ping:', err);
		}
	}
});

const token = getDiscordToken();
if (!token) {
	console.error(
		'Token Discord manquant.\n' +
			'- Option 1 (recommandée): définir la variable d\'environnement DISCORD_TOKEN\n' +
			'- Option 2: mettre le token dans ../cle/Butler_key.txt (une seule ligne)\n' +
			'  (Compat: ../Clé/Butler_key.txt)\n'
		);
	process.exit(1);
}

process.on('unhandledRejection', (err) => {
	console.error('Promesse rejetée (unhandledRejection):', err);
});

client.login(token).catch((err) => {
	console.error('Échec de connexion Discord (login):', err);
	process.exit(1);
});