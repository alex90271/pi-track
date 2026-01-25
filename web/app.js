// Pi-Track Network Monitor - Frontend Application

class PiTrack {
    constructor() {
        this.ws = null;
        this.packets = [];
        this.stats = null;
        this.connections = [];
        this.paused = false;
        this.filter = '';
        this.maxDisplayedPackets = 500;
        this.startTime = null;
        this.timeWindowMinutes = 10; // Default: last 10 minutes

        // Database/History state
        this.dbEnabled = false;
        this.historyPage = 0;
        this.historyLimit = 100;
        this.historyTotal = 0;

        this.init();
    }

    init() {
        this.bindElements();
        this.bindEvents();
        this.connect();
        this.startUptimeTimer();
        this.checkDatabase();
    }

    bindElements() {
        this.elements = {
            connectionStatus: document.getElementById('connection-status'),
            currentInterface: document.getElementById('current-interface'),
            uptime: document.getElementById('uptime'),
            totalPackets: document.getElementById('total-packets'),
            totalBytes: document.getElementById('total-bytes'),
            packetsPerSec: document.getElementById('packets-per-sec'),
            bytesPerSec: document.getElementById('bytes-per-sec'),
            packetTableBody: document.getElementById('packet-table-body'),
            packetFilter: document.getElementById('packet-filter'),
            pauseBtn: document.getElementById('pause-btn'),
            clearBtn: document.getElementById('clear-btn'),
            timeWindow: document.getElementById('time-window'),
            protocolCircles: document.getElementById('protocol-circles'),
            talkerList: document.getElementById('talker-list'),
            processList: document.getElementById('process-list'),
            appList: document.getElementById('app-list'),
            connectionsTableBody: document.getElementById('connections-table-body'),
            // Database elements
            dbStatus: document.getElementById('db-status'),
            dbText: document.getElementById('db-text'),
            dbCard: document.getElementById('db-card'),
            dbPackets: document.getElementById('db-packets'),
            // History elements
            historyTableBody: document.getElementById('history-table-body'),
            historyFilter: document.getElementById('history-filter'),
            historyCountry: document.getElementById('history-country'),
            historyExclude: document.getElementById('history-exclude'),
            historyStart: document.getElementById('history-start'),
            historyEnd: document.getElementById('history-end'),
            historySearchBtn: document.getElementById('history-search-btn'),
            historyInfo: document.getElementById('history-info'),
            historyPrev: document.getElementById('history-prev'),
            historyNext: document.getElementById('history-next'),
            historyPageInfo: document.getElementById('history-page-info'),
            countryTableBody: document.getElementById('country-table-body'),
        };
    }

    bindEvents() {
        if (this.elements.packetFilter) {
            this.elements.packetFilter.addEventListener('input', (e) => {
                this.filter = e.target.value.toLowerCase();
                this.renderPackets();
            });
        }

        if (this.elements.pauseBtn) {
            this.elements.pauseBtn.addEventListener('click', () => {
                this.paused = !this.paused;
                this.elements.pauseBtn.innerHTML = this.paused ? '<i class="bi bi-play-fill"></i> Resume' : '<i class="bi bi-pause-fill"></i> Pause';
                this.elements.pauseBtn.classList.toggle('active', this.paused);
            });
        }

        if (this.elements.clearBtn) {
            this.elements.clearBtn.addEventListener('click', () => {
                this.packets = [];
                this.renderPackets();
            });
        }

        if (this.elements.timeWindow) {
            this.elements.timeWindow.addEventListener('change', (e) => {
                this.timeWindowMinutes = parseInt(e.target.value) || 0;
                this.renderPackets();
            });
        }

        // Tab switching
        document.querySelectorAll('.nav-icon-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Find the closest button element in case user clicked the icon span
                const targetBtn = e.target.closest('.nav-icon-btn');
                if (!targetBtn) return;

                const targetTab = targetBtn.dataset.tab;

                // Update tab buttons
                document.querySelectorAll('.nav-icon-btn[data-tab]').forEach(b => b.classList.remove('active'));
                targetBtn.classList.add('active');

                // Update tab panes
                document.querySelectorAll('.view-pane').forEach(p => p.classList.remove('active'));
                const pane = document.getElementById(`tab-${targetTab}`);
                if (pane) pane.classList.add('active');

                // Update Page Title
                const titleMap = {
                    'live': 'Live Traffic',
                    'connections': 'Active Connections',
                    'history': 'Traffic Log',
                    'countries': 'Geographic Distribution'
                };
                const titleEl = document.getElementById('page-title');
                if (titleEl && titleMap[targetTab]) {
                    titleEl.textContent = titleMap[targetTab];
                }

                // Load data for specific tabs if needed
                if (targetTab === 'history') {
                    if (this.historyPage === 0 && (!this.packets || this.packets.length === 0)) {
                        this.loadHistory();
                    }
                }
            });
        });

        // Initial history load
        if (this.dbEnabled) {
            this.loadHistory();
        }

        // History events

        if (this.elements.historySearchBtn) {
            this.elements.historySearchBtn.addEventListener('click', () => {
                this.historyPage = 0;
                this.loadHistory();
            });
        }

        if (this.elements.historyPrev) {
            this.elements.historyPrev.addEventListener('click', () => {
                if (this.historyPage > 0) {
                    this.historyPage--;
                    this.loadHistory();
                }
            });
        }

        if (this.elements.historyNext) {
            this.elements.historyNext.addEventListener('click', () => {
                const maxPage = Math.ceil(this.historyTotal / this.historyLimit) - 1;
                if (this.historyPage < maxPage) {
                    this.historyPage++;
                    this.loadHistory();
                }
            });
        }

        // Quick filter buttons for history
        document.querySelectorAll('.quick-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const days = parseInt(e.target.dataset.days);

                // Remove active from all buttons
                document.querySelectorAll('.quick-filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                // Set date range
                const end = new Date();
                const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

                if (this.elements.historyStart) {
                    this.elements.historyStart.value = start.toISOString().slice(0, 16);
                }
                if (this.elements.historyEnd) {
                    this.elements.historyEnd.value = end.toISOString().slice(0, 16);
                }

                this.historyPage = 0;
                this.loadHistory();
            });
        });

        // Country list click handler
        if (this.elements.countryTableBody) {
            this.elements.countryTableBody.addEventListener('click', (e) => {
                const row = e.target.closest('tr');
                if (!row || !row.dataset.country) return;

                const countryCode = row.dataset.country;
                if (countryCode === 'Local') return; // Don't filter by Local for now? Or maybe do. Local is unlikely to be a useful filter if it's just local traffic. But let's allow it.

                // Switch to Live tab
                const liveBtn = document.querySelector('.nav-icon-btn[data-tab="live"]');
                if (liveBtn) liveBtn.click();

                // Set filter
                if (this.elements.packetFilter) {
                    this.elements.packetFilter.value = countryCode;
                    this.filter = countryCode.toLowerCase();
                    this.renderPackets();
                }
            });
        }
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.setConnectionStatus('connected', 'Connected');
        };

        this.ws.onclose = () => {
            this.setConnectionStatus('disconnected', 'Disconnected');
            // Reconnect after 3 seconds
            setTimeout(() => this.connect(), 3000);
        };

        this.ws.onerror = () => {
            this.setConnectionStatus('disconnected', 'Error');
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };
    }

    handleMessage(message) {
        switch (message.type) {
            case 'init':
                this.handleInit(message.data);
                break;
            case 'packet':
                this.handlePacket(message.data);
                break;
            case 'stats':
                this.handleStats(message.data);
                break;
        }
    }

    handleInit(data) {
        this.packets = data.packets || [];
        this.stats = data.stats;
        this.connections = data.connections || [];
        this.startTime = new Date(data.stats.startTime);

        this.elements.currentInterface.textContent = data.interface || '-';

        this.renderPackets();
        this.renderStats();
        this.renderConnections();
    }

    handlePacket(packet) {
        if (this.paused) return;

        this.packets.push(packet);

        // Keep only the last N packets
        if (this.packets.length > this.maxDisplayedPackets) {
            this.packets = this.packets.slice(-this.maxDisplayedPackets);
        }

        this.renderPacket(packet, true);
    }

    handleStats(stats) {
        this.stats = stats;
        this.startTime = new Date(stats.startTime);
        this.renderStats();
    }

    setConnectionStatus(status, text) {
        this.elements.connectionStatus.className = `connection-status ${status}`;
        this.elements.connectionStatus.querySelector('.status-text').textContent = text;
    }

    renderPackets() {
        const filtered = this.filterPackets(this.packets);
        this.elements.packetTableBody.innerHTML = '';

        if (filtered.length === 0) {
            this.elements.packetTableBody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            <span class="empty-state-icon">📡</span>
                            <span>Waiting for packets...</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Show last 200 packets for performance
        const displayPackets = filtered.slice(-200);
        displayPackets.forEach(packet => this.renderPacket(packet, false));

        // Scroll to bottom
        const container = this.elements.packetTableBody.closest('.packet-table-container');
        container.scrollTop = container.scrollHeight;
    }

    renderPacket(packet, append = true) {
        if (!this.matchesFilter(packet)) return;

        const row = document.createElement('tr');
        // Proto-color logic handled differently now, but can keep for reference or remove
        // row.className = `protocol-${packet.protocol.toLowerCase()}`;

        const time = new Date(packet.timestamp);
        const timeStr = time.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });

        row.innerHTML = `
            <td class="col-time">${timeStr}</td>
            <td class="col-ip" title="${packet.srcMac || ''}">${this.formatAddressWithInfo(packet.srcIp, packet.srcPort, packet.srcHostname, packet.srcCountry)}</td>
            <td class="col-icon"><i class="bi bi-arrow-right"></i></td>
            <td class="col-ip" title="${packet.dstMac || ''}">${this.formatAddressWithInfo(packet.dstIp, packet.dstPort, packet.dstHostname, packet.dstCountry)}</td>
            <td><span class="proto-cell proto-${packet.protocol.toLowerCase()}">${packet.protocol}</span></td>
            <td>${packet.length}</td>
            <td class="col-process" title="${packet.processName || ''}">${packet.processName || '-'}</td>
            <td title="${packet.info || ''}">${this.truncate(packet.info || packet.application || '-', 50)}</td>
        `;

        if (append) {
            this.elements.packetTableBody.appendChild(row);

            // Remove old rows if too many
            while (this.elements.packetTableBody.children.length > 200) {
                this.elements.packetTableBody.removeChild(this.elements.packetTableBody.firstChild);
            }

            // Auto-scroll to bottom - Only if near bottom? Or just always for now
            if (!this.paused) {
                const container = this.elements.packetTableBody.closest('.table-wrapper');
                // Check if user is scrolling up? For now simple auto-scroll
                if (container) container.scrollTop = container.scrollHeight;
            }
        } else {
            this.elements.packetTableBody.appendChild(row);
        }
    }

    filterPackets(packets) {
        let filtered = packets;

        // Apply time window filter
        if (this.timeWindowMinutes > 0) {
            const cutoff = new Date(Date.now() - this.timeWindowMinutes * 60 * 1000);
            filtered = filtered.filter(p => new Date(p.timestamp) >= cutoff);
        }

        // Apply text filter
        if (this.filter) {
            filtered = filtered.filter(p => this.matchesFilter(p));
        }

        return filtered;
    }

    matchesFilter(packet) {
        if (!this.filter) return true;

        const searchStr = [
            packet.srcIp,
            packet.dstIp,
            packet.protocol,
            packet.info,
            packet.application,
            packet.srcHostname,
            packet.dstHostname,
            packet.srcCountry,
            packet.dstCountry,
            String(packet.srcPort),
            String(packet.srcPort),
            String(packet.dstPort),
            packet.processName || ''
        ].join(' ').toLowerCase();

        return searchStr.includes(this.filter);
    }

    renderStats() {
        if (!this.stats) return;

        // Update main stats
        this.elements.totalPackets.textContent = this.formatNumber(this.stats.totalPackets);
        this.elements.totalBytes.textContent = this.formatBytes(this.stats.totalBytes);
        this.elements.packetsPerSec.textContent = this.formatNumber(Math.round(this.stats.packetsPerSec));
        this.elements.bytesPerSec.textContent = this.formatBytes(this.stats.bytesPerSec) + '/s';

        // Render protocol distribution
        this.renderProtocols();

        // Render top talkers
        this.renderTalkers();

        // Render applications
        this.renderApplications();

        // Render processes
        this.renderProcesses();

        // Render connections
        this.renderConnections();

        // Render countries
        this.renderCountries();
    }

    renderProtocols() {
        if (!this.elements.protocolCircles) return;

        const protocols = this.stats.protocolStats || {};
        const sorted = Object.entries(protocols)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6);

        if (sorted.length === 0) {
            this.elements.protocolCircles.innerHTML = '<div class="empty-state"><span>No data yet</span></div>';
            return;
        }

        const total = sorted.reduce((acc, [, count]) => acc + count, 0);
        const circumference = 2 * Math.PI * 24; // radius = 24

        this.elements.protocolCircles.innerHTML = sorted.map(([proto, count]) => {
            const percentage = Math.round((count / total) * 100);
            const offset = circumference - (percentage / 100) * circumference;
            const protoClass = proto.toLowerCase();
            return `
                <div class="protocol-circle ${protoClass}">
                    <div class="circle-progress">
                        <svg viewBox="0 0 60 60">
                            <circle class="bg" cx="30" cy="30" r="24"/>
                            <circle class="progress" cx="30" cy="30" r="24" 
                                stroke-dasharray="${circumference}" 
                                stroke-dashoffset="${offset}"/>
                        </svg>
                        <span class="percentage">${percentage}%</span>
                    </div>
                    <span class="name">${proto}</span>
                </div>
            `;
        }).join('');
    }

    renderTalkers() {
        const talkers = this.stats.topTalkers || [];

        if (talkers.length === 0) {
            this.elements.talkerList.innerHTML = '<div class="empty-state" style="padding:1rem;"><span>No data</span></div>';
            return;
        }

        const maxBytes = talkers[0]?.bytes || 1;

        this.elements.talkerList.innerHTML = talkers.slice(0, 10).map(talker => {
            const displayName = talker.hostname || talker.ip;
            const countryFlag = talker.country ? this.getCountryFlag(talker.country) : '';
            // Dense list row
            return `
                <div class="list-row">
                    <div class="list-txt" title="${talker.ip}">
                        <span class="flag-icon">${countryFlag}</span>${this.truncate(displayName, 20)}
                    </div>
                    <div class="list-val">${this.formatBytes(talker.bytes)}</div>
                </div>
            `;
        }).join('');
    }

    renderProcesses() {
        if (!this.elements.processList || !this.stats || !this.stats.processStats) return;

        const processes = this.stats.processStats;
        const sorted = Object.entries(processes)
            .sort((a, b) => b[1] - a[1]);

        if (sorted.length === 0) {
            this.elements.processList.innerHTML = '<div class="empty-state" style="padding:1rem;"><span>No process data</span></div>';
            return;
        }

        const maxBytes = sorted[0][1] || 1;

        this.elements.processList.innerHTML = sorted.slice(0, 10).map(([name, bytes]) => {
            const percentage = Math.round((bytes / maxBytes) * 100);
            return `
                <div class="list-row">
                    <div class="list-txt" title="${name}">
                        <i class="bi bi-cpu" style="font-size: 0.8rem; margin-right: 5px;"></i>${this.truncate(name, 20)}
                    </div>
                    <div class="list-val">${this.formatBytes(bytes)}</div>
                </div>
                <div class="progress-bar-mini" style="margin-bottom: 4px;">
                    <div class="fill" style="width: ${percentage}%"></div>
                </div>
            `;
        }).join('');
    }

    renderApplications() {
        // Not used in new layout immediately, but good to have
        const apps = this.stats.applicationStats || {};
        const sorted = Object.entries(apps)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // ... (Optional: could render to another list if added)
    }

    renderConnections() {
        // Fetch connections from API
        fetch('/api/connections')
            .then(res => res.json())
            .then(connections => {
                if (connections.length === 0) {
                    this.elements.connectionsTableBody.innerHTML = `
                        <tr>
                            <td colspan="7" style="text-align:center; padding: 2rem;">
                                No active connections
                            </td>
                        </tr>
                    `;
                    return;
                }

                this.elements.connectionsTableBody.innerHTML = connections.slice(0, 50).map(conn => {
                    const duration = this.formatDuration(
                        new Date(conn.lastSeen) - new Date(conn.firstSeen)
                    );
                    return `
                        <tr>
                            <td class="col-ip">${conn.srcIp}</td>
                            <td class="col-icon"><i class="bi bi-arrow-right"></i></td>
                            <td class="col-ip">${conn.dstIp}</td>
                            <td><span class="proto-cell proto-${conn.protocol.toLowerCase()}">${conn.protocol}</span></td>
                            <td>${this.formatNumber(conn.packets)}</td>
                            <td>${this.formatBytes(conn.bytes)}</td>
                            <td>${duration}</td>
                        </tr>
                    `;
                }).join('');
            })
            .catch(err => console.error('Failed to fetch connections:', err));
    }

    renderCountries() {
        if (!this.elements.countryTableBody || !this.stats || !this.stats.countryStats) return;

        const countries = Object.entries(this.stats.countryStats)
            .sort((a, b) => b[1] - a[1]); // Sort by bytes descending

        const totalBytes = countries.reduce((acc, [, bytes]) => acc + bytes, 0);

        if (countries.length === 0) {
            this.elements.countryTableBody.innerHTML = `
                <tr><td colspan="5" style="text-align:center; padding: 2rem;">No country data yet</td></tr>
            `;
            return;
        }

        this.elements.countryTableBody.innerHTML = countries.map(([code, bytes]) => {
            const percentage = totalBytes > 0 ? ((bytes / totalBytes) * 100).toFixed(1) : 0;
            const flag = this.getCountryFlag(code);
            // Get full name if possible, or just use code
            let name = code;
            if (code === 'Local') {
                name = 'Local Network';
            } else {
                try {
                    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
                    name = regionNames.of(code);
                } catch (e) {
                    name = code;
                }
            }

            return `
                <tr class="country-row" data-country="${code}" style="cursor: pointer;">
                    <td class="col-icon" style="font-size:1.2rem;">${flag}</td>
                    <td style="font-weight:500;">${name}</td>
                    <td class="col-time">${code}</td>
                    <td class="col-ip">${this.formatBytes(bytes)}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="flex:1; height:4px; background:#f0f0f0; border-radius:2px; max-width:100px;">
                                <div style="width:${percentage}%; height:100%; background:var(--accent-blue); border-radius:2px;"></div>
                            </div>
                            <span style="font-size:0.75rem; color:var(--text-secondary);">${percentage}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    startUptimeTimer() {
        setInterval(() => {
            if (this.startTime) {
                const now = new Date();
                const diff = now - this.startTime;
                this.elements.uptime.textContent = this.formatDuration(diff);
            }
        }, 1000);
    }

    // Utility functions
    formatAddress(ip, port) {
        if (!ip) return '-';
        if (!port || port === 0) return ip;
        return `${ip}:${port}`;
    }

    formatAddressWithInfo(ip, port, hostname, country) {
        if (!ip) return '-';
        let result = '';

        // Add country flag if available
        if (country && country !== 'Local') {
            result += this.getCountryFlag(country) + ' ';
        } else if (country === 'Local') {
            result += '🏠 ';
        }

        // Use hostname if available, otherwise IP
        const host = hostname ? this.truncate(hostname.replace(/\.$/, ''), 20) : ip;

        if (!port || port === 0) {
            result += host;
        } else {
            result += `${host}:${port}`;
        }

        return result;
    }

    getCountryFlag(countryCode) {
        if (!countryCode || countryCode === 'Local') return '';
        // Convert country code to flag emoji
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return String(num);
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const value = bytes / Math.pow(1024, i);

        return value.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    }

    formatDuration(ms) {
        if (ms < 0) ms = 0;

        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        const pad = n => String(n).padStart(2, '0');

        return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
    }

    truncate(str, length) {
        if (!str) return '';
        if (str.length <= length) return str;
        return str.substring(0, length) + '...';
    }

    // Database methods
    checkDatabase() {
        fetch('/api/database')
            .then(res => res.json())
            .then(info => {
                this.dbEnabled = info.enabled;

                if (this.elements.dbStatus) {
                    this.elements.dbStatus.classList.toggle('enabled', info.enabled);
                    this.elements.dbStatus.classList.toggle('disabled', !info.enabled);
                }

                if (this.elements.dbText) {
                    if (info.enabled) {
                        const size = this.formatBytes(info.databaseSize || 0);
                        const filename = info.path ? info.path.split('/').pop() : 'DB';
                        this.elements.dbText.innerHTML = `<div style="display:flex; flex-direction:column; line-height:1.2; font-size:0.65rem;"><span>${filename}</span><span>${size}</span></div>`;
                        // Remove icon look if we want text, or keep icon alongside? 
                        // The container is a nav-icon-btn (40x40). 
                        // Let's replace the icon content with this small stack.
                    } else {
                        this.elements.dbText.textContent = 'OFF';
                    }
                }

                if (this.elements.dbCard) {
                    this.elements.dbCard.style.display = info.enabled ? 'flex' : 'none';
                }

                if (this.elements.dbPackets && info.enabled) {
                    this.elements.dbPackets.textContent = this.formatNumber(info.totalPackets || 0);
                }

                // Refresh database stats periodically
                if (info.enabled) {
                    setInterval(() => this.updateDbStats(), 10000);
                }
            })
            .catch(err => {
                console.error('Failed to check database status:', err);
            });
    }

    updateDbStats() {
        fetch('/api/database')
            .then(res => res.json())
            .then(info => {
                if (this.elements.dbPackets && info.enabled) {
                    this.elements.dbPackets.textContent = this.formatNumber(info.totalPackets || 0);
                }
                if (this.elements.dbText && info.enabled) {
                    const size = this.formatBytes(info.databaseSize || 0);
                    const filename = info.path ? info.path.split('/').pop() : 'DB';
                    this.elements.dbText.innerHTML = `<div style="display:flex; flex-direction:column; line-height:1.2; font-size:0.65rem;"><span>${filename}</span><span>${size}</span></div>`;
                }
            })
            .catch(() => { });
    }

    loadHistory() {
        if (!this.dbEnabled) return;

        const filter = this.elements.historyFilter?.value || '';
        const country = this.elements.historyCountry?.value || '';
        const startTime = this.elements.historyStart?.value ? new Date(this.elements.historyStart.value).toISOString() : '';
        const endTime = this.elements.historyEnd?.value ? new Date(this.elements.historyEnd.value).toISOString() : '';

        let url = `/api/history?limit=${this.historyLimit}&offset=${this.historyPage * this.historyLimit}`;
        if (filter) url += `&filter=${encodeURIComponent(filter)}`;
        if (country) url += `&country=${encodeURIComponent(country)}`;
        if (startTime) url += `&start=${encodeURIComponent(startTime)}`;
        if (endTime) url += `&end=${encodeURIComponent(endTime)}`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                this.historyTotal = data.total || 0;
                this.renderHistory(data.packets || []);
                this.updateHistoryPagination();
            })
            .catch(err => {
                console.error('Failed to load history:', err);
                if (this.elements.historyTableBody) {
                    this.elements.historyTableBody.innerHTML = `
                        <tr>
                            <td colspan="6">
                                <div class="empty-state">
                                    <span class="empty-state-icon">⚠️</span>
                                    <span>Error loading history</span>
                                </div>
                            </td>
                        </tr>
                    `;
                }
            });
    }

    renderHistory(packets) {
        if (!this.elements.historyTableBody) return;

        if (packets.length === 0) {
            this.elements.historyTableBody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            <span class="empty-state-icon">📚</span>
                            <span>No packets found</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        this.elements.historyTableBody.innerHTML = packets.map(packet => {
            const time = new Date(packet.timestamp);
            const timeStr = time.toLocaleString('en-US', {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            return `
                <tr>
                    <td class="col-time">${timeStr}</td>
                    <td class="col-ip" title="${packet.srcMac || ''}">${this.formatAddressWithInfo(packet.srcIp, packet.srcPort, packet.srcHostname, packet.srcCountry)}</td>
                    <td class="col-icon"><i class="bi bi-arrow-right"></i></td>
                    <td class="col-ip" title="${packet.dstMac || ''}">${this.formatAddressWithInfo(packet.dstIp, packet.dstPort, packet.dstHostname, packet.dstCountry)}</td>
                    <td><span class="proto-cell proto-${(packet.protocol || 'unknown').toLowerCase()}">${packet.protocol || 'Unknown'}</span></td>
                    <td>${packet.length}</td>
                    <td class="col-process">${packet.processName || '-'}</td>
                    <td title="${packet.info || ''}">${this.truncate(packet.info || packet.application || '-', 50)}</td>
                </tr>
            `;
        }).join('');
    }

    updateHistoryPagination() {
        const totalPages = Math.ceil(this.historyTotal / this.historyLimit);
        const currentPage = this.historyPage + 1;

        if (this.elements.historyPageInfo) {
            this.elements.historyPageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        }

        if (this.elements.historyInfo) {
            this.elements.historyInfo.textContent = `${this.formatNumber(this.historyTotal)} total packets`;
        }

        if (this.elements.historyPrev) {
            this.elements.historyPrev.disabled = this.historyPage === 0;
        }

        if (this.elements.historyNext) {
            this.elements.historyNext.disabled = currentPage >= totalPages;
        }
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.pitrack = new PiTrack();
});
