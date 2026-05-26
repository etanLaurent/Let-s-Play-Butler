const HELP_TOPICS = {
	ping: {
		title: 'Commande ping',
		lines: [
			'Tape `ping` dans un salon → je réponds `Pong !`',
		],
	},
	xp: {
		title: 'XP (expérience)',
		lines: [
			"L'XP augmente quand on participe (messages, drops ou récompenses).",
			'But: monter de niveau pour débloquer des rôles de niveau et concurencer les autres membres.',
			"Note: l'XP est virtuelle et spécifique au serveur (pas de lien avec d'autres serveurs).",
		],
	},
	level: {
		title: 'Level (niveau)',
		lines: [
			"Le niveau est calculé à partir de l'XP (plus d'XP = niveau plus haut).",
			"Souvent, l'XP nécessaire augmente avec le niveau.",
			'l\'augmentation de niveau est notifier dans le salon nommé du même nom',
		],
	},
	roles: {
		title: 'Rôles',
		lines: [
			"Les rôles servent à organiser les membres.",
            "Il ya les rôles de niveau (ex: “Novice”) qui montrent votre implication dans le serveur.",
            "Il ya les rôles de jeu (ex: “Minecraft”) vous pouvez les obtenir dans le salon rôles en réagissant sous les embeds de l'oracle.",
            "Et il ya les rôles cosmétiques (ex: “Azure”) vous pouvez les obtenir dans la boutique ou grâce à des événements.",
		], 
	},
	games: {
		title: 'Games (jeux)',
		lines: [
			'Il y a plein de jeux sur le serveur et un salon dedié à chaque jeu, pour y accéder vous devez avoir pris le rôles correspondant.',
            'Lorsque vous avez le rôle sur votre profil, vous obtiendrez toutes les nouvelles concernant le jeu.',
		],
	},
	minigames: {
		title: 'Mini-jeux',
		lines: [
			'Les mini-jeux sont listé dans le salon ressources (en partie taper / avec Draftbot et cherchez pour plus de jeux) et s\'activent avec une commande à utiliser dans le salon dedié aux commandes.',
		],
	},
	argent: {
		title: 'Argent (monnaie du serveur)',
		lines: [
			'Argent virtuel gagné via activité/jeux, dépensé dans une boutique.',
			'Exemples: acheter des rôles cosmétiques.',
			"Important: c'est virtuel (pas d'argent réel).",
		],
	},
	suggestions: {
		title: 'Suggestions',
		lines: [
			'Vous pouvez proposer des idées pour améliorer le serveur.',
			'Utilisez la commande `/suggestion` pour soumettre une suggestion dans le salon portant le même nom.',
		],
	},
	fortune: {
		title: 'Fortune',
		lines: [
			'Vous pouvez tourner la roue de la fortune tout les 3 jours avec /fortune tourner.',
			'Vous pouvez aussi consulter votre solde avec /fortune porte_monnaie.',
		],
	},
};

function getHelpTopicKeys() {
	return Object.keys(HELP_TOPICS);
}

function formatHelpTopic(topicKey) {
	const topic = HELP_TOPICS[topicKey];
	if (!topic) return null;

	return [
		`${topic.title}:`,
		...topic.lines.map((line) => `- ${line}`),
	].join('\n');
}

module.exports = {
	HELP_TOPICS,
	getHelpTopicKeys,
	formatHelpTopic,
};
