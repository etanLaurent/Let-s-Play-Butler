const { PNG } = require('pngjs');

function clamp01(x) {
	return Math.max(0, Math.min(1, x));
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function hslToRgb(h, s, l) {
	// h: 0..360, s/l: 0..1
	h = ((h % 360) + 360) % 360;
	s = clamp01(s);
	l = clamp01(l);

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = h / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));

	let r1 = 0,
		g1 = 0,
		b1 = 0;
	if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
	else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0];
	else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x];
	else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c];
	else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c];
	else [r1, g1, b1] = [c, 0, x];

	const m = l - c / 2;
	return {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255),
	};
}

function getTierHue(tier) {
	const t = String(tier || '').toLowerCase();
	if (t.includes('mauvaise') || t.includes('bad')) return 0; // rouge
	if (t.includes('super')) return 280; // violet
	if (t.includes('golden') || t.includes('dor') || t.includes('gold')) return 50; // or
	return 200; // normale: bleu
}

function foldAscii(input) {
	return String(input || '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^0-9a-zA-Z +\-_:]/g, '');
}

// Police bitmap 5x7 ultra simple (ASCII). Chaque glyph = 7 lignes de 5 bits.
const FONT_5X7 = {
	A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
	B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
	C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
	D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
	E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
	F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
	G: [0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
	H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
	I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
	J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
	K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
	L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
	M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
	N: [0b10001, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001],
	O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
	P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
	Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
	R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
	S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
	T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
	U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
	V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
	W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
	X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
	Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
	Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
	'0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
	'1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
	'2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
	'3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
	'4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
	'5': [0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110],
	'6': [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
	'7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
	'8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
	'9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
	'+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
	'-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
	':': [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
	'_': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111],
	' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};

function setPixel(png, x, y, r, g, b, a = 255) {
	if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
	const i = (y * png.width + x) * 4;
	png.data[i + 0] = r;
	png.data[i + 1] = g;
	png.data[i + 2] = b;
	png.data[i + 3] = a;
}

function drawTextRotated(png, text, centerX, centerY, angleRad, scale, color) {
	const cleaned = foldAscii(text).toUpperCase().slice(0, 10);
	const chars = cleaned.split('');
	const glyphW = 5;
	const glyphH = 7;
	const spacing = 1;
	const totalW = chars.length * (glyphW + spacing) - spacing;

	// rotation "lisible": si le texte part vers la gauche, on le retourne
	let a = angleRad;
	const norm = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
	if (norm > Math.PI / 2 && norm < (3 * Math.PI) / 2) {
		a = a + Math.PI;
	}

	const cosA = Math.cos(a);
	const sinA = Math.sin(a);

	function rot(dx, dy) {
		return {
			x: dx * cosA - dy * sinA,
			y: dx * sinA + dy * cosA,
		};
	}

	for (let ci = 0; ci < chars.length; ci++) {
		const ch = chars[ci];
		const glyph = FONT_5X7[ch] || FONT_5X7[' '];
		const x0 = -totalW / 2 + ci * (glyphW + spacing);
		for (let gy = 0; gy < glyphH; gy++) {
			const row = glyph[gy] || 0;
			for (let gx = 0; gx < glyphW; gx++) {
				const bit = (row >> (glyphW - 1 - gx)) & 1;
				if (!bit) continue;

				for (let sy = 0; sy < scale; sy++) {
					for (let sx = 0; sx < scale; sx++) {
						const dx = (x0 + gx) * scale + sx;
						const dy = (gy - glyphH / 2) * scale + sy;
						const p = rot(dx, dy);
						setPixel(png, Math.round(centerX + p.x), Math.round(centerY + p.y), color.r, color.g, color.b, 255);
					}
				}
			}
		}
	}
}

function drawPointerTriangle(png, tipX, tipY, height, width, color) {
	const baseY = tipY + height;
	for (let y = tipY; y <= baseY; y++) {
		const t = (y - tipY) / Math.max(1, height);
		const half = Math.round(width * t);
		for (let x = tipX - half; x <= tipX + half; x++) {
			setPixel(png, x, y, color.r, color.g, color.b, 255);
		}
	}
}

function renderFortuneWheelPng({
	tier,
	segmentCount,
	labels,
	selectedIndex,
	size = 512,
	drawPointer = true,
	drawLabels = true,
	highlightSelected = true,
}) {
	const labelList = Array.isArray(labels) ? labels : [];
	const n = Math.max(3, labelList.length || Number(segmentCount) || 0);
	const picked = Math.max(0, Math.min(n - 1, Number(selectedIndex) || 0));

	const png = new PNG({ width: size, height: size });
	const cx = (size - 1) / 2;
	const cy = (size - 1) / 2;
	const radius = Math.floor(size * 0.45);
	const border = 3;
	const hubRadius = Math.floor(radius * 0.22);

	const baseHue = getTierHue(tier);
	const twoPi = Math.PI * 2;
	const segAngle = twoPi / n;
	// Rotation: met le segment gagnant sous la flèche, au CENTRE du segment
	const wheelRotation = highlightSelected ? (picked + 0.5) * segAngle : 0;

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const r = Math.sqrt(dx * dx + dy * dy);
			const idx = (y * size + x) * 4;

			if (r > radius) {
				png.data[idx + 3] = 0;
				continue;
			}

			// Angle 0 en haut (pointeur), rotation sens horaire
			let angle = Math.atan2(dy, dx); // -pi..pi, 0 à droite
			angle = (angle + Math.PI / 2 + twoPi) % twoPi; // 0 en haut
			const a2 = (angle + wheelRotation) % twoPi;
			const seg = Math.floor(a2 / segAngle) % n;

			// Base color per segment
			const hue = (baseHue + (360 / n) * seg) % 360;
			let sat = 0.65;
			let light = 0.48;
			const isGoldenTheme = String(tier || '').toLowerCase().includes('golden') || String(tier || '').toLowerCase().includes('dor') || String(tier || '').toLowerCase().includes('gold');
			if (isGoldenTheme) {
				sat = seg % 2 === 0 ? 0.78 : 0.06;
				light = seg % 2 === 0 ? 0.58 : 0.90;
			}

			// Highlight selected segment
			if (highlightSelected && seg === picked) {
				sat = isGoldenTheme ? 0.95 : 0.75;
				light = isGoldenTheme ? 0.72 : 0.62;
			}

			// Border ring
			if (r >= radius - border) {
				sat = 0.0;
				light = 0.12;
			}

			// Segments separators (lignes entre cases) — uniquement à l'intérieur
			// On les laisse aller jusqu'au bord (y compris l'anneau), et on coupe avant le moyeu.
			if (r < radius - 1 && r > hubRadius + 1) {
				const frac = (a2 / segAngle) % 1;
				if (frac < 0.014 || frac > 0.986) {
					sat = 0.0;
					light = 0.10;
				}
			}

			// Subtle radial shading
			const shade = clamp01((radius - r) / radius);
			light = lerp(light * 0.9, light, 0.6 + 0.4 * shade);

			const { r: rr, g, b } = hslToRgb(hue, sat, light);
			png.data[idx + 0] = rr;
			png.data[idx + 1] = g;
			png.data[idx + 2] = b;
			png.data[idx + 3] = 255;
		}
	}

	// Moyeu central pour masquer la convergence des séparateurs (effet pixelisé)
	const hubBorder = 2;
	for (let y = Math.floor(cy - hubRadius - hubBorder); y <= Math.ceil(cy + hubRadius + hubBorder); y++) {
		for (let x = Math.floor(cx - hubRadius - hubBorder); x <= Math.ceil(cx + hubRadius + hubBorder); x++) {
			const dx = x - cx;
			const dy = y - cy;
			const r = Math.sqrt(dx * dx + dy * dy);
			if (r > hubRadius + hubBorder) continue;
			if (r > hubRadius) {
				// petit contour
				setPixel(png, x, y, 10, 10, 10, 255);
				continue;
			}
			// léger dégradé au centre
			const t = 1 - clamp01(r / Math.max(1, hubRadius));
			const c = Math.round(40 + 25 * t);
			setPixel(png, x, y, c, c, c, 255);
		}
	}

	if (drawLabels && labelList.length) {
		// Labels des segments (proches du bord)
		const textRadius = radius * 0.62;
		const textColor = { r: 255, g: 255, b: 255 };
		for (let seg = 0; seg < n; seg++) {
			const label = labelList[seg] || `R${seg + 1}`;
			// centre de segment en angle "wheel" (0 en haut, horaire)
			const centerAngle = (seg + 0.5) * segAngle - wheelRotation;
			// Convertit en angle standard écran (0 à droite)
			const phi = centerAngle - Math.PI / 2;
			const x = cx + Math.cos(phi) * textRadius;
			const y = cy + Math.sin(phi) * textRadius;
			drawTextRotated(png, label, x, y, phi, 2, textColor);
		}
	}

	if (drawPointer) {
		// Draw pointer (triangle) at top
		const pointerHeight = Math.floor(size * 0.10);
		// Flèche plus fine
		const pointerWidth = Math.floor(size * 0.04);
		const tipX = Math.round(cx);
		// Flèche posée sur la roue
		const tipY = Math.round(cy - radius + 1);
		drawPointerTriangle(png, tipX, tipY, pointerHeight, pointerWidth, { r: 10, g: 10, b: 10 });
	}

	return PNG.sync.write(png);
}

function renderTierWheelPng({ selectedTier, size = 512 }) {
	const selected = String(selectedTier || '').toLowerCase();
	const labels = ['MAUVAISE', 'NORMALE', 'SUPER'];
	let selectedIndex = 1;
	if (selected.includes('mauvaise') || selected.includes('bad')) selectedIndex = 0;
	else if (selected.includes('super')) selectedIndex = 2;

	// On rend une roue “comme la 2e”, mais à 3 segments.
	return renderFortuneWheelPng({
		tier: 'normale',
		labels,
		selectedIndex,
		size,
		drawPointer: true,
		drawLabels: true,
		highlightSelected: true,
	});
}

module.exports = { renderFortuneWheelPng, renderTierWheelPng };
