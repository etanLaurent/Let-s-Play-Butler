const WHEEL_TIERS = {
	BAD: 'mauvaise',
	NORMAL: 'normale',
	SUPER: 'super',
};

// Récompenses provisoires (on pourra les ajuster ensuite)
// IMPORTANT: `label` = texte court affiché sur la roue PNG (sans emoji/accents si possible).
//            `text`  = texte envoyé dans le message Discord.
const FORTUNE_WHEELS = {
	[WHEEL_TIERS.BAD]: [
		{ label: 'Rien', text: 'Vous n\'avez rien gagné.' },
		{ label: '5 €', text: 'Vous obtenez 5 €.' },
		{ label: 'Punis roue', text: 'Roue bloqué 144 h 🟥' },
		{ label: '-10 €', text: 'Vous perdez 10 €.' },
		{ label: 'Moquerie', text: 'Bouuuuuuuh on se moque de toi 😂' },
		{ label: 'Vide', text: 'Vide 😐' },
		{ label: '25 €', text: 'Vous obtenez 25 €.' },
		{ label: 'Non', text: 'Juste non ❌' },
		{ label: '0.01 €', text: 'Vous obtenez 0.01 €.' },
	],
	[WHEEL_TIERS.NORMAL]: [
		{ label: 'RIEN', text: 'Rien 😐' },
		{ label: '300 €', text: 'Vous obtenez 300 €.' },
		{ label: 'Relance', text: 'Relance la roue 🔄' },
		{ label: '150 €', text: 'Vous obtenez 150 €.' },
		{ label: 'Petit chrono', text: 'Tu n\'obtiens rien mais rejoue dans 12 h ⏱️' },
		{ label: 'Relance', text: 'Rejouer 🔁' },
		{ label: '500 €', text: 'Vous obtenez 500 €.' },
		{ label: '2000 Exp', text: 'Vous obtenez 2000 points d\'expérience Draftbot. Votre récompense arrivera bientôt !' },
		{ label: 'Relance X1.2', text: 'Relance le roue et gagne 20 % de plus 🚀' },
	],
	[WHEEL_TIERS.SUPER]: [
		{ label: 'JACKPOT', text: 'Jackpot 5000 € et 3 niveaux Draftbot 🏆' },
		{ label: 'Relance X3', text: 'Relance le roue et gagne trois fois plus💎' },
		{ label: 'Double Relance', text: 'Tu as le droit de lancer la roue à nouveau deux fois ✨' },
		{ label: '1 Level', text: 'Un niveau Draftbot, votre récompense arrivera bientôt ! 🔥' },
		{ label: 'Ah non...', text: 'La super roue ne t\'aime pas' },
		{ label: 'Chanceux', text: 'Obtiens le rôle chanceux, si déjà obtenu, 2000 € 👑' },
		{ label: '1750 €', text: 'Coffre de 1750 € 🧰' },
		{ label: '100 €', text: '100 € 🟣' },
		{ label: 'Super Relance', text: 'Relance la super roue 🔄' },
	],
};

const GRAND_RISK_WHEEL = [
	{ label: 'Rien', text: 'Reste où tu en es je pense 😐' },
	{ label: '8 Level', text: '8 niveaux Draftbot, votre récompense arrivera bientôt ! 🎯' },
	{ label: '3500 €', text: '3500 € 🟠' },
	{ label: '-1000 €', text: 'Perds 1000 € 🥲' },
	{ label: '-200 €', text: 'Perds 200 € 😶' },
	{ label: 'Triple Jackpot', text: '15000 € et 9 niveaux Draftbot 🏆' },
	{ label: 'Remboursé', text: 'Reprend tes 500 € et reviens plus ❤️' },
	{ label: 'Grande roue Dorée', text: 'Deuxième tour sur la roue dorée 🌟' },
	{ label: '-6000 €', text: 'Perds 6000 € ☠️' },
];

const GOLDEN_WHEEL = [
	{ label: '500 €', text: '500 € 🟢' },
	{ label: '1500 €', text: '1500 € 🔴' },
	{ label: '3500 €', text: '3500 € 🟠' },
	{ label: '6500 €', text: '6500 € 🟣' },
	{ label: '750 €', text: '750 € 🔵' },
	{ label: '20000 €', text: '20000 € 🟡' },
	{ label: '3000 €', text: '3000 € 🟤' },
	{ label: '250 €', text: '250 € ⚫' },
	{ label: '12000 €', text: '12000 € ⚪' },
];

function pickRandom(items) {
	return items[Math.floor(Math.random() * items.length)];
}

function spinTier() {
	// Ratio: 60% normale, 25% mauvaise, 15% super
	const r = Math.random();
	if (r < 0.25) return WHEEL_TIERS.BAD;
	if (r < 0.25 + 0.60) return WHEEL_TIERS.NORMAL;
	return WHEEL_TIERS.SUPER;
}

function spinReward(tier) {
	const rewards = FORTUNE_WHEELS[tier] || [];
	const picked = rewards.length ? pickRandom(rewards) : null;
	return picked ? picked.text : 'Récompense à définir';
}

function spinRewardWithIndex(tier) {
	const rewards = FORTUNE_WHEELS[tier] || [];
	if (!rewards.length) {
		return { index: 0, reward: 'Récompense à définir', label: '', labels: [], rewards: [] };
	}
	const index = Math.floor(Math.random() * rewards.length);
	return {
		index,
		reward: rewards[index].text,
		label: rewards[index].label,
		labels: rewards.map((r) => r.label),
		rewards: rewards.map((r) => r.text),
	};
}

function spinFortune() {
	const tier = spinTier();
	const reward = spinReward(tier);
	return { tier, reward };
}

function spinGrandRisk() {
	if (!GRAND_RISK_WHEEL.length) {
		return { index: 0, reward: null, labels: [], rewards: [] };
	}
	const index = Math.floor(Math.random() * GRAND_RISK_WHEEL.length);
	const reward = GRAND_RISK_WHEEL[index];
	return {
		index,
		reward,
		labels: GRAND_RISK_WHEEL.map((item) => item.label),
		rewards: GRAND_RISK_WHEEL.map((item) => item.text),
	};
}

function spinGoldenWheel() {
	if (!GOLDEN_WHEEL.length) {
		return { index: 0, reward: null, labels: [], rewards: [] };
	}
	const index = Math.floor(Math.random() * GOLDEN_WHEEL.length);
	const reward = GOLDEN_WHEEL[index];
	return {
		index,
		reward,
		labels: GOLDEN_WHEEL.map((item) => item.label),
		rewards: GOLDEN_WHEEL.map((item) => item.text),
	};
}

function resolveGrandRiskSequence() {
	const firstSpin = spinGrandRisk();
	const steps = [{ wheel: 'grand_risk', ...firstSpin }];
	if (firstSpin.reward && /grande roue dorée/i.test(String(firstSpin.reward.label || firstSpin.reward.text || ''))) {
		steps.push({ wheel: 'golden', ...spinGoldenWheel() });
	}
	return steps;
}

module.exports = {
	WHEEL_TIERS,
	FORTUNE_WHEELS,
	GRAND_RISK_WHEEL,
	GOLDEN_WHEEL,
	spinTier,
	spinReward,
	spinRewardWithIndex,
	spinFortune,
	spinGrandRisk,
	spinGoldenWheel,
	resolveGrandRiskSequence,
};
