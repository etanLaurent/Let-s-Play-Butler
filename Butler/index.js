const {
	AttachmentBuilder,
	Client,
	Events,
	GatewayIntentBits,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');
const { getDiscordToken } = require('./token');
const { formatHelpTopic, getHelpTopicKeys } = require('./helpTopics');
const { spinRewardWithIndex, spinTier } = require('./fortune');
const { renderFortuneWheelPng, renderTierWheelPng } = require('./fortuneRender');
const {
	getBalance,
	addBalance,
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

		if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;

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