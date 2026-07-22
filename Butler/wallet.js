const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'wallet.json');

function ensureDataFile() {
	if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
	if (!fs.existsSync(DATA_PATH)) {
		fs.writeFileSync(DATA_PATH, JSON.stringify({ users: {} }, null, 2), 'utf8');
	}
}

function readData() {
	ensureDataFile();
	try {
		const raw = fs.readFileSync(DATA_PATH, 'utf8');
		const data = JSON.parse(raw);
		if (!data || typeof data !== 'object') return { users: {} };
		if (!data.users || typeof data.users !== 'object') data.users = {};
		return data;
	} catch {
		return { users: {} };
	}
}

function writeData(data) {
	ensureDataFile();
	const tmp = `${DATA_PATH}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
	fs.renameSync(tmp, DATA_PATH);
}

function getUserEntry(data, userId) {
	const id = String(userId);
	if (!data.users[id]) {
		data.users[id] = { balance: 0, fortuneCooldownUntilMs: 0, pendingMultiplier: 1 };
	}
	const entry = data.users[id];
	if (typeof entry.balance !== 'number') entry.balance = Number(entry.balance) || 0;
	if (typeof entry.fortuneCooldownUntilMs !== 'number') {
		entry.fortuneCooldownUntilMs = Number(entry.fortuneCooldownUntilMs) || 0;
	}
	if (typeof entry.pendingMultiplier !== 'number') entry.pendingMultiplier = Number(entry.pendingMultiplier) || 1;
	return entry;
}

function getBalance(userId) {
	const data = readData();
	return getUserEntry(data, userId).balance;
}

function addBalance(userId, delta) {
	const data = readData();
	const entry = getUserEntry(data, userId);
	entry.balance += Number(delta) || 0;
	writeData(data);
	return entry.balance;
}

function spendBalance(userId, amount) {
	const cost = Math.max(0, Number(amount) || 0);
	const data = readData();
	const entry = getUserEntry(data, userId);
	if (entry.balance < cost) {
		return { ok: false, balance: entry.balance };
	}
	entry.balance -= cost;
	writeData(data);
	return { ok: true, balance: entry.balance };
}

function getFortuneCooldownUntilMs(userId) {
	const data = readData();
	return getUserEntry(data, userId).fortuneCooldownUntilMs;
}

function setFortuneCooldownUntilMs(userId, untilMs) {
	const data = readData();
	const entry = getUserEntry(data, userId);
	entry.fortuneCooldownUntilMs = Math.max(0, Number(untilMs) || 0);
	writeData(data);
	return entry.fortuneCooldownUntilMs;
}

function getPendingMultiplier(userId) {
	const data = readData();
	const entry = getUserEntry(data, userId);
	return Number(entry.pendingMultiplier) || 1;
}

function setPendingMultiplier(userId, multiplier) {
	const data = readData();
	const entry = getUserEntry(data, userId);
	entry.pendingMultiplier = Number(multiplier) || 1;
	writeData(data);
	return entry.pendingMultiplier;
}

function clearPendingMultiplier(userId) {
	return setPendingMultiplier(userId, 1);
}

module.exports = {
	getBalance,
	addBalance,
	spendBalance,
	getFortuneCooldownUntilMs,
	setFortuneCooldownUntilMs,
	getPendingMultiplier,
	setPendingMultiplier,
	clearPendingMultiplier,
};
