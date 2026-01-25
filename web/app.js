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
            protocolList: document.getElementById('protocol-list'),
            talkerList: document.getElementById('talker-list'),
            appList: document.getElementById('app-list'),
            connectionsToggle: document.getElementById('connections-toggle'),
            connectionsContent: document.getElementById('connections-content'),
            connectionsTableBody: document.getElementById('connections-table-body'),
            // Database elements
            dbStatus: document.getElementById('db-status'),
            dbText: document.getElementById('db-text'),
            dbCard: document.getElementById('db-card'),
            dbPackets: document.getElementById('db-packets'),
            // History elements
            historySection: document.getElementById('history-section'),
            historyToggle: document.getElementById('history-toggle'),
            historyContent: document.getElementById('history-content'),
            historyTableBody: document.getElementById('history-table-body'),
            historyFilter: document.getElementById('history-filter'),
            historyStart: document.getElementById('history-start'),
            historyEnd: document.getElementById('history-end'),
            historySearchBtn: document.getElementById('history-search-btn'),
            historyInfo: document.getElementById('history-info'),
            historyPrev: document.getElementById('history-prev'),
            historyNext: document.getElementById('history-next'),
            historyPageInfo: document.getElementById('history-page-info'),
        };
    }

    bindEvents() {
        this.elements.packetFilter.addEventListener('input', (e) => {
            this.filter = e.target.value.toLowerCase();
            this.renderPackets();
        });

        this.elements.pauseBtn.addEventListener('click', () => {
            this.paused = !this.paused;
            this.elements.pauseBtn.textContent = this.paused ? '▶️' : '⏸️';
            this.elements.pauseBtn.classList.toggle('active', this.paused);
        });

        this.elements.clearBtn.addEventListener('click', () => {
            this.packets = [];
            this.renderPackets();
        });

        this.elements.connectionsToggle.addEventListener('click', () => {
            this.elements.connectionsToggle.closest('.connections-section').classList.toggle('collapsed');
        });

        // History events
        if (this.elements.historyToggle) {
            this.elements.historyToggle.addEventListener('click', () => {
                this.elements.historySection.classList.toggle('collapsed');
            });
        }

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
        row.className = `protocol-${packet.protocol.toLowerCase()}`;

        const time = new Date(packet.timestamp);
        const timeStr = time.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });

        row.innerHTML = `
            <td class="packet-time">${timeStr}</td>
            <td title="${packet.srcMac || ''}">${this.formatAddressWithInfo(packet.srcIp, packet.srcPort, packet.srcHostname, packet.srcCountry)}</td>
            <td title="${packet.dstMac || ''}">${this.formatAddressWithInfo(packet.dstIp, packet.dstPort, packet.dstHostname, packet.dstCountry)}</td>
            <td><span class="protocol-badge ${packet.protocol.toLowerCase()}">${packet.protocol}</span></td>
            <td>${packet.length}</td>
            <td title="${packet.info || ''}">${this.truncate(packet.info || packet.application || '-', 50)}</td>
        `;

        if (append) {
            this.elements.packetTableBody.appendChild(row);

            // Remove old rows if too many
            while (this.elements.packetTableBody.children.length > 200) {
                this.elements.packetTableBody.removeChild(this.elements.packetTableBody.firstChild);
            }

            // Auto-scroll to bottom
            if (!this.paused) {
                const container = this.elements.packetTableBody.closest('.packet-table-container');
                container.scrollTop = container.scrollHeight;
            }
        } else {
            this.elements.packetTableBody.appendChild(row);
        }
    }

    filterPackets(packets) {
        if (!this.filter) return packets;
        return packets.filter(p => this.matchesFilter(p));
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
            String(packet.dstPort)
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

        // Render connections
        this.renderConnections();
    }

    renderProtocols() {
        const protocols = this.stats.protocolStats || {};
        const sorted = Object.entries(protocols)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);

        if (sorted.length === 0) {
            this.elements.protocolList.innerHTML = '<div class="empty-state"><span>No data yet</span></div>';
            return;
        }

        const maxValue = sorted[0]?.[1] || 1;

        this.elements.protocolList.innerHTML = sorted.map(([proto, count]) => {
            const percentage = (count / maxValue) * 100;
            const protoClass = proto.toLowerCase();
            return `
                <div class="list-item">
                    <div class="list-item-info">
                        <div class="list-item-name">${proto}</div>
                        <div class="progress-bar">
                            <div class="progress-fill ${protoClass}" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                    <div class="list-item-value">${this.formatNumber(count)}</div>
                </div>
            `;
        }).join('');
    }

    renderTalkers() {
        const talkers = this.stats.topTalkers || [];

        if (talkers.length === 0) {
            this.elements.talkerList.innerHTML = '<div class="empty-state"><span>No data yet</span></div>';
            return;
        }

        const maxBytes = talkers[0]?.bytes || 1;

        this.elements.talkerList.innerHTML = talkers.slice(0, 6).map(talker => {
            const percentage = (talker.bytes / maxBytes) * 100;
            const displayName = talker.hostname || talker.ip;
            const countryFlag = talker.country ? this.getCountryFlag(talker.country) : '';
            return `
                <div class="list-item">
                    <div class="list-item-info">
                        <div class="list-item-name" title="${talker.ip}">${countryFlag} ${this.truncate(displayName, 18)}</div>
                        <div class="list-item-detail">${talker.packets} pkts</div>
                    </div>
                    <div class="list-item-value">${this.formatBytes(talker.bytes)}</div>
                </div>
            `;
        }).join('');
    }

    renderApplications() {
        const apps = this.stats.applicationStats || {};
        const sorted = Object.entries(apps)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6);

        if (sorted.length === 0) {
            this.elements.appList.innerHTML = '<div class="empty-state"><span>No data yet</span></div>';
            return;
        }

        this.elements.appList.innerHTML = sorted.map(([app, count]) => `
            <div class="list-item">
                <div class="list-item-info">
                    <div class="list-item-name">${app}</div>
                </div>
                <div class="list-item-value">${this.formatNumber(count)}</div>
            </div>
        `).join('');
    }

    renderConnections() {
        // Fetch connections from API
        fetch('/api/connections')
            .then(res => res.json())
            .then(connections => {
                if (connections.length === 0) {
                    this.elements.connectionsTableBody.innerHTML = `
                        <tr>
                            <td colspan="6">
                                <div class="empty-state">
                                    <span>No active connections</span>
                                </div>
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
                            <td>${conn.srcIp}:${conn.srcPort}</td>
                            <td>${conn.dstIp}:${conn.dstPort}</td>
                            <td><span class="protocol-badge ${conn.protocol.toLowerCase()}">${conn.protocol}</span></td>
                            <td>${this.formatNumber(conn.packets)}</td>
                            <td>${this.formatBytes(conn.bytes)}</td>
                            <td>${duration}</td>
                        </tr>
                    `;
                }).join('');
            })
            .catch(err => console.error('Failed to fetch connections:', err));
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
                    this.elements.dbText.textContent = info.enabled ? 'ON' : 'OFF';
                }

                if (this.elements.dbCard) {
                    this.elements.dbCard.style.display = info.enabled ? 'flex' : 'none';
                }

                if (this.elements.dbPackets && info.enabled) {
                    this.elements.dbPackets.textContent = this.formatNumber(info.totalPackets || 0);
                }

                if (this.elements.historySection) {
                    this.elements.historySection.style.display = info.enabled ? 'block' : 'none';
                    if (info.enabled) {
                        // Start collapsed
                        this.elements.historySection.classList.add('collapsed');
                    }
                }

                // Refresh database stats periodically
                if (info.enabled) {
                    setInterval(() => this.updateDbStats(), 10000);
                }
            })
            .catch(err => {
                console.error('Failed to check database status:', err);
                if (this.elements.historySection) {
                    this.elements.historySection.style.display = 'none';
                }
            });
    }

    updateDbStats() {
        fetch('/api/database')
            .then(res => res.json())
            .then(info => {
                if (this.elements.dbPackets && info.enabled) {
                    this.elements.dbPackets.textContent = this.formatNumber(info.totalPackets || 0);
                }
            })
            .catch(() => { });
    }

    loadHistory() {
        if (!this.dbEnabled) return;

        const filter = this.elements.historyFilter?.value || '';
        const startTime = this.elements.historyStart?.value ? new Date(this.elements.historyStart.value).toISOString() : '';
        const endTime = this.elements.historyEnd?.value ? new Date(this.elements.historyEnd.value).toISOString() : '';

        let url = `/api/history?limit=${this.historyLimit}&offset=${this.historyPage * this.historyLimit}`;
        if (filter) url += `&filter=${encodeURIComponent(filter)}`;
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
                <tr class="protocol-${(packet.protocol || 'unknown').toLowerCase()}">
                    <td class="packet-time">${timeStr}</td>
                    <td>${this.formatAddressWithInfo(packet.srcIp, packet.srcPort, packet.srcHostname, packet.srcCountry)}</td>
                    <td>${this.formatAddressWithInfo(packet.dstIp, packet.dstPort, packet.dstHostname, packet.dstCountry)}</td>
                    <td><span class="protocol-badge ${(packet.protocol || 'unknown').toLowerCase()}">${packet.protocol || 'Unknown'}</span></td>
                    <td>${packet.length}</td>
                    <td title="${packet.info || ''}">${this.truncate(packet.info || packet.application || '-', 40)}</td>
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
