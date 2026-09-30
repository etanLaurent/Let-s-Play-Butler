const RED_NUMBERS = new Set([
	1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const ROULETTE_ORDER = [
	0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
	10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const ROULETTE_PAYOUTS = {
	color: 2,
	number: 30,
	green: 15,
};

function getRouletteColor(number) {
	if (number === 0) return 'vert';
	return RED_NUMBERS.has(number) ? 'rouge' : 'noir';
}

function parseRouletteChoice(choice) {
	const normalized = String(choice || '').trim().toLowerCase();
	if (normalized === 'rouge') return { type: 'color', value: 'rouge' };
	if (['noir', 'noire'].includes(normalized)) return { type: 'color', value: 'noir' };
	if (['vert', 'verte', 'green'].includes(normalized)) return { type: 'green', value: 'vert' };

	if (/^\d+$/.test(normalized)) {
		const number = Number(normalized);
		if (number === 0) return { type: 'green', value: 'vert' };
		if (number >= 1 && number <= 36) return { type: 'number', value: number };
	}

	return null;
}

function spinRoulette(random = Math.random) {
	const index = Math.floor(random() * ROULETTE_ORDER.length);
	const number = ROULETTE_ORDER[index];
	return { index, number, color: getRouletteColor(number) };
}

function resolveRouletteBet(choice, stake, result) {
	const bet = parseRouletteChoice(choice);
	const amount = Number(stake);
	if (!bet || !Number.isFinite(amount) || amount <= 0) {
		return { ok: false, reason: 'invalid_bet' };
	}

	const won = bet.type === 'number'
		? bet.value === result.number
		: bet.type === 'green'
			? result.number === 0
			: bet.value === result.color;
	const multiplier = bet.type === 'number'
		? ROULETTE_PAYOUTS.number
		: bet.type === 'green'
			? ROULETTE_PAYOUTS.green
			: ROULETTE_PAYOUTS.color;

	return {
		ok: true,
		bet,
		won,
		multiplier,
		payout: won ? amount * multiplier : bet.type === 'green' ? Math.round((amount / 2) * 100) / 100 : 0,
		net: won
			? amount * (multiplier - 1)
			: bet.type === 'green'
				? -(Math.round((amount / 2) * 100) / 100)
				: -amount,
	};
}

module.exports = {
	RED_NUMBERS,
	ROULETTE_ORDER,
	ROULETTE_PAYOUTS,
	getRouletteColor,
	parseRouletteChoice,
	spinRoulette,
	resolveRouletteBet,
};