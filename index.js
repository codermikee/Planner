const tasksContainer = document.getElementById('tasks');
const addTaskBtn = document.getElementById('addTaskBtn');
const exportBtn = document.getElementById('exportBtn');
const previewTBody = document.querySelector('#previewTable tbody');
const totalsDiv = document.getElementById('totals');
const STORAGE_KEY_V2 = 'productivity_tasks_v2'; 
const STORAGE_KEY = 'productivity_tasks_v3'; 
const STORAGE_GLOBAL_KEY = 'productivity_day_v1';
const dayStartInput = document.getElementById('dayStart');
const dayEndInput = document.getElementById('dayEnd');
const dayStartToggle = document.getElementById('dayStartToggle');
const dayEndToggle = document.getElementById('dayEndToggle');
const plannerTitleInput = document.getElementById('plannerTitle');
const pageTitleEl = document.getElementById('pageTitle');

function el(tag, attrs = {}, children = []) {
	const n = document.createElement(tag);
	Object.entries(attrs).forEach(([k, v]) => {
		if (k === 'class') n.className = v;
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.substring(2), v);
		else n.setAttribute(k, v);
	});
	[].concat(children).forEach(c => {
		if (c == null) return;
		n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
	});
	return n;
}

function timeToMinutes(t) {
	if (!t) return null;
	const [h, m] = t.split(':').map(Number);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

function minutesToHHMM(min) {
	const h = Math.floor(min / 60) % 24;
	const m = min % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computePlannedMinutes(start, end) {
	if (start == null || end == null) return null;
	if (end < start) end += 24 * 60;
	return end - start;
}

// 12-hour helpers
function to12Hour(h24) {
	const ampm = h24 >= 12 ? 'PM' : 'AM';
	let h = h24 % 12; if (h === 0) h = 12;
	return { h, ampm };
}

function from12ToMinutes(h12, m, ampm) {
	if (h12 == null || m == null || !ampm) return null;
	let h = parseInt(h12, 10);
	const mm = parseInt(m, 10);
	if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
	if (ampm === 'AM') { if (h === 12) h = 0; }
	else { if (h !== 12) h += 12; }
	return h * 60 + mm;
}

function parse12hString(str) {
	// Accept formats: "HH:MM AM" or 24h "HH:MM"
	if (!str) return null;
	const s = String(str).trim();
	const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
	if (ampmMatch) {
		const h = parseInt(ampmMatch[1], 10);
		const m = parseInt(ampmMatch[2], 10);
		const ap = ampmMatch[3].toUpperCase();
		return { h: Math.min(Math.max(h, 1), 12), m: Math.min(Math.max(m, 0), 59), ampm: ap };
	}
	const mmatch = s.match(/^(\d{1,2}):(\d{2})$/);
	if (mmatch) {
		// Convert 24h to 12h
		const h24 = Math.min(Math.max(parseInt(mmatch[1], 10), 0), 23);
		const m = Math.min(Math.max(parseInt(mmatch[2], 10), 0), 59);
		const { h, ampm } = to12Hour(h24);
		return { h, m, ampm };
	}
	return null;
}

function format12hDisplay(h, m, ampm) {
	if (h == null || m == null || !ampm) return '';
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function normalizeTimeInput(el) {
	if (!el) return null;
	const parsed = parse12hString(el.value);
	if (parsed) {
		el.value = format12hDisplay(parsed.h, parsed.m, parsed.ampm);
		el.classList.remove('invalid');
		return from12ToMinutes(parsed.h, parsed.m, parsed.ampm);
	} else if (el.value.trim() === '') {
		el.classList.remove('invalid');
		return null;
	} else {
		el.classList.add('invalid');
		return null;
	}
}

function getDayTimes() {
	const startMin = normalizeTimeInput(dayStartInput);
	const endMin = normalizeTimeInput(dayEndInput);
	return { startMin, endMin };
}

function toggleAmPm(el) {
	if (!el) return;
	const p = parse12hString(el.value || '');
	if (!p) {
		// if empty, flip to a sensible default
		const fallback = (el.id === 'dayStart') ? { h: 8, m: 0, ampm: 'AM' } : { h: 9, m: 0, ampm: 'PM' };
		el.value = format12hDisplay(fallback.h, fallback.m, fallback.ampm);
		return updatePreview();
	}
	const flipped = { h: p.h, m: p.m, ampm: p.ampm === 'AM' ? 'PM' : 'AM' };
	el.value = format12hDisplay(flipped.h, flipped.m, flipped.ampm);
	updatePreview();
}

function getTasksData() {
	const rows = [...tasksContainer.querySelectorAll('.task-row')];
	return rows.map((row, idx) => {
		const title = row.querySelector('.task-title').value.trim() || `Task ${idx + 1}`;
	const actualStr = row.querySelector('.task-actual').value;

	// No per-task start/end; planned is not per task
	const planned = null;
		const actual = parseDuration(actualStr);

	return { idx: idx + 1, title, planned, actual };
	});
}

// --- Duration parsing/formatting: H:MM[:SS] stored in SECONDS ---
function parseDuration(str) {
	if (str == null) return null;
	const s = String(str).trim();
	if (!s) return null;
	// Accept H, H:MM, H:MM:SS, and M:SS (interpreted as 0:H:M? No, treat X:Y as H:MM for backward compat)
	const onlyNum = s.match(/^\d+$/);
	if (onlyNum) {
		// plain number => hours
		const hours = parseInt(onlyNum[0], 10);
		if (!Number.isFinite(hours) || hours < 0) return null;
		return hours * 3600;
	}
	// H:MM:SS
	let m = s.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
	if (m) {
		const h = parseInt(m[1], 10);
		const mm = parseInt(m[2], 10);
		const ss = parseInt(m[3], 10);
		if ([h, mm, ss].some(x => !Number.isFinite(x) || x < 0)) return null;
		return h * 3600 + mm * 60 + ss;
	}
	// H:MM (backward)
	m = s.match(/^(\d{1,3}):(\d{1,2})$/);
	if (m) {
		const h = parseInt(m[1], 10);
		const mm = parseInt(m[2], 10);
		if ([h, mm].some(x => !Number.isFinite(x) || x < 0)) return null;
		return h * 3600 + mm * 60;
	}
	return null;
}

function formatDuration(secs) {
	if (secs == null) return '';
	const sign = secs < 0 ? '-' : '';
	const abs = Math.abs(Math.floor(secs));
	const h = Math.floor(abs / 3600);
	const rem = abs % 3600;
	const m = Math.floor(rem / 60);
	const s = rem % 60;
	return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// H:MM (no seconds), used for PDF totals line as requested
function formatDurationHM(secs) {
	if (secs == null) return '';
	const sign = secs < 0 ? '-' : '';
	const abs = Math.abs(Math.floor(secs));
	const h = Math.floor(abs / 3600);
	const m = Math.floor((abs % 3600) / 60);
	return `${sign}${h}:${String(m).padStart(2, '0')}`;
}

function updatePreview() {
	const data = getTasksData();
	previewTBody.innerHTML = '';
	data.forEach(d => {
		const displayVal = d.actual != null ? formatDuration(d.actual) : '';
		const tr = el('tr', {}, [
			el('td', {}, String(d.idx)),
			el('td', {}, d.title),
			el('td', {}, displayVal),
		]);
		previewTBody.appendChild(tr);
	});

	// Totals
	const totalActualSecs = data.reduce((a, r) => a + (r.actual || 0), 0);
	const { startMin, endMin } = getDayTimes();
	const dayWindow = computePlannedMinutes(startMin, endMin);
	const dayWindowSecs = dayWindow != null ? dayWindow * 60 : null;
	const remainingSecs = dayWindowSecs != null ? (dayWindowSecs - totalActualSecs) : null;
	if (totalsDiv) {
		const parts = [];
		if (dayWindowSecs != null) parts.push(`Total Hours Alloted: ${formatDuration(dayWindowSecs)}`);
		parts.push(`Time taken: ${formatDuration(totalActualSecs)}`);
		if (remainingSecs != null) parts.push(`Time Remaining: ${formatDuration(remainingSecs)}`);
	totalsDiv.textContent = parts.join(' | ');
	}

	saveToStorage();
}

function addTaskRow(preset = {}) {
	const row = el('div', { class: 'task-row' });
	const titleField = el('div', { class: 'field' }, [
		el('label', {}, 'Task'),
		el('input', { type: 'text', placeholder: 'Task name', class: 'task-title', value: preset.title || '' })
	]);
	const actual = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'H:MM:SS', class: 'task-actual', value: preset.actual || '' });
	const actualField = el('div', { class: 'field' }, [
		el('label', {}, 'Time'),
		actual
	]);
	// Timer controls per task
	const startStopBtn = el('button', { class: 'btn timer', title: 'Start/Stop timer' }, 'Start');
	const resetBtn = el('button', { class: 'btn timer ghost', title: 'Reset timer' }, 'Reset');
	const up = el('button', { class: 'btn move up', title: 'Move up' }, '');
	const down = el('button', { class: 'btn move down', title: 'Move down' }, '');
	const remove = el('button', { class: 'btn remove', onclick: () => { row.remove(); updatePreview(); } }, 'Remove');

	const recalcPlanned = () => { updateValidity(); updatePreview(); };

	function updateValidity() {
		// clear
		row.querySelectorAll('.invalid').forEach(n => n.classList.remove('invalid'));
		// actual must be in H or H:MM or H:MM:SS (non-negative)
		if (actual.value) {
			const ok = parseDuration(actual.value) != null;
			if (!ok) actual.classList.add('invalid');
		}
	}

		titleField.querySelector('input').addEventListener('input', updatePreview);
		actual.addEventListener('input', () => {
			// live reflect manual edits into timer base
			baseSecs = parseDuration(actual.value) ?? baseSecs;
			updatePreview();
		});
		actual.addEventListener('blur', () => {
			const secs = parseDuration(actual.value);
			if (secs != null) { baseSecs = secs; actual.value = formatDuration(secs); }
			updatePreview();
		});
		actual.addEventListener('change', () => {
			const secs = parseDuration(actual.value);
			if (secs != null) { baseSecs = secs; actual.value = formatDuration(secs); }
			updatePreview();
		});

		// Timer state for this row
		let timerId = null;
		let startTs = null;
		let baseSecs = parseDuration(actual.value) || 0;

		function setRunning(running) {
			startStopBtn.textContent = running ? 'Stop' : 'Start';
			startStopBtn.dataset.running = running ? '1' : '0';
		}

		function startTimer() {
			if (timerId) return;
			startTs = Date.now();
			setRunning(true);
			timerId = setInterval(() => {
				const elapsed = Math.floor((Date.now() - startTs) / 1000);
				const total = baseSecs + elapsed;
				actual.value = formatDuration(total);
				updatePreview();
			}, 1000);
		}

		function stopTimer() {
			if (!timerId) return;
			clearInterval(timerId);
			const elapsed = Math.floor((Date.now() - startTs) / 1000);
			baseSecs = baseSecs + Math.max(0, elapsed);
			actual.value = formatDuration(baseSecs);
			updatePreview();
			saveToStorage();
			timerId = null;
			startTs = null;
			setRunning(false);
		}

		function resetTimer() {
			if (timerId) stopTimer();
			baseSecs = 0;
			actual.value = '';
			updatePreview();
			saveToStorage();
		}

		startStopBtn.addEventListener('click', () => {
			const running = startStopBtn.dataset.running === '1';
			if (running) stopTimer(); else startTimer();
		});
		resetBtn.addEventListener('click', resetTimer);

	up.addEventListener('click', () => {
		const prev = row.previousElementSibling;
		if (prev) {
			row.parentNode.insertBefore(row, prev);
			updatePreview();
		}
	});
	down.addEventListener('click', () => {
		const next = row.nextElementSibling;
		if (next) {
			next.after(row);
			updatePreview();
		}
	});

	row.append(
		titleField,
		actualField,
		startStopBtn,
		resetBtn,
		up,
		down,
		remove
	);
	tasksContainer.appendChild(row);
	recalcPlanned();
}

function exportPDF() {
	const rows = getTasksData();
	if (!rows.length) {
		alert('Please add at least one task.');
		return;
	}
	// Build table for jsPDF AutoTable
	const head = [['#', 'Task', 'Time (H:MM:SS)']];
	const body = rows.map(r => [ r.idx, r.title, r.actual != null ? formatDuration(r.actual) : '' ]);

	// Summaries
	const totalActualSecs = rows.reduce((a, r) => a + (r.actual || 0), 0);
	const { startMin, endMin } = getDayTimes();
	const dayWindow = computePlannedMinutes(startMin, endMin);
	const dayWindowSecs = dayWindow != null ? dayWindow * 60 : null;
	const remainingSecs = dayWindowSecs != null ? (dayWindowSecs - totalActualSecs) : null;

	// Colors (matching site palette)
	const ACCENT = [218, 58, 102]; // --accent
	const ACCENT2 = [242, 123, 163]; // --accent-2
	const TEXT = [42, 14, 28]; // --text
	const MUTED = [140, 90, 106]; // --muted
	const BG_SOFT = [255, 247, 250]; // --bg
	const MARGINS = { left: 40, right: 40, top: 32, bottom: 24 };

	try {
		const { jsPDF } = window.jspdf;
		const doc = new jsPDF({ unit: 'pt', format: 'a4' });
		const pageWidth = doc.internal.pageSize.getWidth();
		const pageHeight = doc.internal.pageSize.getHeight();

		// Header band
	const title = (plannerTitleInput?.value?.trim()) || "Today's Agenda";
		doc.setFillColor(...ACCENT);
		doc.setDrawColor(...ACCENT);
		const bandX = MARGINS.left;
		const bandY = MARGINS.top;
		const bandW = pageWidth - MARGINS.left - MARGINS.right;
		const bandH = 56;
		doc.roundedRect(bandX, bandY, bandW, bandH, 8, 8, 'F');
		doc.setTextColor(255, 255, 255);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(22);
		doc.text(title, bandX + 16, bandY + 36);

		// Meta line below the band to avoid overlap
		doc.setFontSize(10);
		const now = new Date();
		const dayStartStr = dayStartInput?.value || '';
		const dayEndStr = dayEndInput?.value || '';
		const withTZ = (s) => s ? s.replace(/\b(AM|PM)\b/i, '$1 PHT') : s;
		const nowStrWithTZ = `${now.toLocaleString()} PHT`;
		const dayStartStrTZ = withTZ(dayStartStr) || '?';
		const dayEndStrTZ = withTZ(dayEndStr) || '?';
		const metaLine = `Generated: ${nowStrWithTZ}${(dayStartStr || dayEndStr) ? `  |  Hours: ${dayStartStrTZ} - ${dayEndStrTZ}` : ''}\nBy Remah S. Ali`;
		doc.setTextColor(...MUTED);
		doc.text(metaLine, bandX + 4, bandY + bandH + 14);
		// Table
		// Add a little extra space after the (now multi-line) meta text
		const tableStartY = bandY + bandH + 42; // was +24; bumped to avoid crowding
		doc.autoTable({
			head,
			body,
			startY: tableStartY,
			margin: { left: MARGINS.left, right: MARGINS.right },
			styles: { font: 'courier', fontSize: 10, textColor: TEXT, lineColor: ACCENT2, lineWidth: 0.5 },
			headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: 'bold' },
			alternateRowStyles: { fillColor: BG_SOFT },
			columnStyles: {
				0: { halign: 'center', cellWidth: 28 },
				1: { halign: 'left' },
				2: { halign: 'right' }
			},
			theme: 'grid',
			didDrawPage: (data) => {
				// footer per page
				doc.setFontSize(9);
				doc.setTextColor(...MUTED);
				const str = `Page ${doc.internal.getNumberOfPages()}`; // replaced after with total
				doc.text(str, pageWidth - 30, pageHeight - 16, { align: 'right' });
			}
		});

		// Summary (list form; no container)
		let y = doc.lastAutoTable.finalY + 22; // a bit more breathing room from the table
		const lineH = 16;
		doc.setFont('helvetica', 'bold');
		doc.setTextColor(...ACCENT);
		doc.setFontSize(12);
		doc.text('Summary', MARGINS.left, y);
		y += 12;
		doc.setFont('courier', 'normal');
		doc.setTextColor(...TEXT);
		doc.setFontSize(11);
		const lines = [
			dayWindowSecs != null ? `Total Hours Alloted: ${formatDurationHM(dayWindowSecs)}` : null,
			`Time Taken: ${formatDurationHM(totalActualSecs)}`,
			remainingSecs != null ? `Time Remaining: ${formatDurationHM(remainingSecs)}` : null
		].filter(Boolean);
		// If the list would overflow, move to a new page
		if (y + (lines.length * lineH) > pageHeight - MARGINS.bottom) {
			doc.addPage();
			y = MARGINS.top;
			doc.setFont('helvetica', 'bold');
			doc.setTextColor(...ACCENT);
			doc.setFontSize(12);
			doc.text('Summary', MARGINS.left, y);
			y += 12;
			doc.setFont('courier', 'normal');
			doc.setTextColor(...TEXT);
			doc.setFontSize(11);
		}
		// Render as bullets
		lines.forEach((t, i) => {
			doc.text(`• ${t}`, MARGINS.left, y + i * lineH);
		});

    		// Replace footer text with total pages
		const pageCount = doc.internal.getNumberOfPages();
		for (let i = 1; i <= pageCount; i++) {
			doc.setPage(i);
			doc.setFontSize(9);
			doc.setTextColor(...MUTED);
			doc.text(`Page ${i} of ${pageCount}`,
				pageWidth - 30,
				pageHeight - 16,
				{ align: 'right' }
			);
		}

	 // Dynamic filename from title + date, e.g., "PODO-Daily-Activity-2025-08-26.pdf"
	 const rawTitleForFile = (plannerTitleInput?.value?.trim()) || "Today's Agenda";
	 const safeTitle = rawTitleForFile
	   .replace(/[\\/:*?"<>|]/g, '') // remove illegal filename chars
	   .replace(/\s+/g, '-')           // spaces to dashes
	   .replace(/-+/g, '-')            // collapse multiple dashes
	   .replace(/^-|-$/g, '');         // trim leading/trailing dashes
	 const dateStr = now.toISOString().slice(0,10);
	 doc.save(`${safeTitle}-${dateStr}.pdf`);
	} catch (e) {
		console.error('PDF export failed.', e);
		alert('PDF export failed. Please ensure the app files are intact.');
	}
}

function saveToStorage() {
	const data = getTasksData().map(({ title, actual }) => ({ title, actual: actual ?? '' }));
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
	try {
	const day = { dayStart: dayStartInput?.value || '', dayEnd: dayEndInput?.value || '', plannerTitle: plannerTitleInput?.value || '' };
		localStorage.setItem(STORAGE_GLOBAL_KEY, JSON.stringify(day));
	} catch {}
}

function loadFromStorage() {
	let data = [];
	try {
		const raw3 = localStorage.getItem(STORAGE_KEY);
		if (raw3) data = JSON.parse(raw3);
		else {
			const raw2 = localStorage.getItem(STORAGE_KEY_V2);
			if (raw2) {
				const old = JSON.parse(raw2);
				if (Array.isArray(old)) {
					data = old.map(it => ({ title: it.title, actual: Number.isFinite(+it.actual) ? (+it.actual) * 60 : '' }));
				}
			}
		}
	} catch {}

	if (Array.isArray(data) && data.length) {
		data.forEach(item => {
			const secs = Number(item.actual);
			const displayVal = Number.isFinite(secs) ? formatDuration(secs) : '';
			addTaskRow({ title: item.title, actual: displayVal });
		});
	} else {
		// default example: 1:00:00 hour
		addTaskRow({ title: 'Focus Session', actual: '1:00:00' });
	}
	// Load day times
	try {
		const raw = localStorage.getItem(STORAGE_GLOBAL_KEY);
		if (raw) {
			const day = JSON.parse(raw);
			if (dayStartInput && day?.dayStart) dayStartInput.value = day.dayStart;
			if (dayEndInput && day?.dayEnd) dayEndInput.value = day.dayEnd;
			if (plannerTitleInput) plannerTitleInput.value = day?.plannerTitle || "Today's Agenda";
			if (pageTitleEl) pageTitleEl.textContent = plannerTitleInput?.value || "Today's Agenda";
		} else {
			if (dayStartInput) dayStartInput.value = '08:00 AM';
			if (dayEndInput) dayEndInput.value = '09:00 PM';
			if (plannerTitleInput) plannerTitleInput.value = "Today's Agenda";
			if (pageTitleEl) pageTitleEl.textContent = "Today's Agenda";
		}
	} catch {}
	updatePreview();
}

// Wire up
addTaskBtn?.addEventListener('click', () => addTaskRow());
exportBtn?.addEventListener('click', exportPDF);
dayStartInput?.addEventListener('change', () => { normalizeTimeInput(dayStartInput); updatePreview(); });
dayEndInput?.addEventListener('change', () => { normalizeTimeInput(dayEndInput); updatePreview(); });
dayStartToggle?.addEventListener('click', () => toggleAmPm(dayStartInput));
dayEndToggle?.addEventListener('click', () => toggleAmPm(dayEndInput));
plannerTitleInput?.addEventListener('input', () => {
	if (pageTitleEl) pageTitleEl.textContent = plannerTitleInput.value || "Today's Agenda";
	saveToStorage();
});

// Init from storage or seed
loadFromStorage();
