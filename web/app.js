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

        // New: Theme and preferences
        this.theme = localStorage.getItem('pitrack-theme') || 'light';

        // New: Traffic chart
        this.trafficChart = null;
        this.trafficData = {
            labels: [],
            packetsPerSec: [],
            bytesPerSec: []
        };
        this.maxChartPoints = 30;

        // New: Auto-scroll control
        this.userScrolled = false;

        // New: Selected packet for modal
        this.selectedPacket = null;

        // New: Common port names
        this.portNames = {
            20: 'FTP-D', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP',
            53: 'DNS', 67: 'DHCP', 68: 'DHCP', 80: 'HTTP', 110: 'POP3',
            123: 'NTP', 143: 'IMAP', 443: 'HTTPS', 465: 'SMTPS', 587: 'SMTP',
            993: 'IMAPS', 995: 'POP3S', 3306: 'MySQL', 3389: 'RDP',
            5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt',
            27017: 'MongoDB'
        };

        this.init();
    }

    init() {
        this.bindElements();
        this.bindEvents();
        this.connect();
        this.startUptimeTimer();
        this.checkDatabase();
        this.loadPreferences();
        this.initTrafficChart();
        this.bindKeyboardShortcuts();
        this.loadCountries();
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
            dbBtn: document.getElementById('db-btn'),
            dbModal: document.getElementById('db-modal'),
            dbModalClose: document.getElementById('db-modal-close'),
            dbDetails: document.getElementById('db-details'),
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
            // New: Theme and UI elements
            themeToggle: document.getElementById('theme-toggle'),
            liveIndicator: document.getElementById('live-indicator'),
            trafficChart: document.getElementById('traffic-chart'),
            packetModal: document.getElementById('packet-modal'),
            modalClose: document.getElementById('modal-close'),
            packetDetails: document.getElementById('packet-details'),
            exportCsvBtn: document.getElementById('export-csv-btn'),
            panelToggle: document.getElementById('panel-toggle'),
            filterPanel: document.getElementById('filter-panel'),
            panelCollapseBtn: document.getElementById('panel-collapse-btn'),
            panelMaximizeBtn: document.getElementById('panel-maximize-btn'),
            panelExpandBtn: document.getElementById('panel-expand-btn'),
            fullscreenBtn: document.getElementById('fullscreen-btn'),
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

        // Time pill buttons
        document.querySelectorAll('.time-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.time-pill').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.timeWindowMinutes = parseInt(e.target.dataset.minutes) || 10;
                this.renderPackets();
                this.savePreferences();
            });
        });

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

        // Panel collapse toggle
        if (this.elements.panelCollapseBtn && this.elements.filterPanel) {
            this.elements.panelCollapseBtn.addEventListener('click', () => {
                this.togglePanel();
            });
        }

        if (this.elements.panelMaximizeBtn) {
            this.elements.panelMaximizeBtn.addEventListener('click', () => {
                this.togglePanelMaximize();
            });
        }

        if (this.elements.panelExpandBtn) {
            this.elements.panelExpandBtn.addEventListener('click', () => {
                this.togglePanel();
            });
        }



        // Fullscreen toggle
        if (this.elements.fullscreenBtn) {
            this.elements.fullscreenBtn.addEventListener('click', () => {
                this.toggleFullscreen();
            });
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

        // New: Theme toggle
        if (this.elements.themeToggle) {
            this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // New: Update pause state UI (live indicator and table wrapper)
        if (this.elements.pauseBtn) {
            const originalHandler = this.elements.pauseBtn.onclick;
            this.elements.pauseBtn.addEventListener('click', () => {
                this.updatePauseUI();
                this.savePreferences();
            });
        }

        // New: Modal close handlers
        if (this.elements.modalClose) {
            this.elements.modalClose.addEventListener('click', () => this.closePacketModal());
        }
        if (this.elements.packetModal) {
            this.elements.packetModal.addEventListener('click', (e) => {
                if (e.target === this.elements.packetModal) {
                    this.closePacketModal();
                }
            });
        }

        // New: Export CSV button
        if (this.elements.exportCsvBtn) {
            this.elements.exportCsvBtn.addEventListener('click', () => this.exportToCsv());
        }

        // New: Panel toggle (responsive)
        if (this.elements.panelToggle && this.elements.filterPanel) {
            this.elements.panelToggle.addEventListener('click', () => {
                this.elements.filterPanel.classList.toggle('open');
            });
        }

        // New: Packet table row click for detail modal
        if (this.elements.packetTableBody) {
            this.elements.packetTableBody.addEventListener('click', (e) => {
                const row = e.target.closest('tr');
                if (row && row.dataset.packetIndex !== undefined) {
                    const index = parseInt(row.dataset.packetIndex);
                    this.showPacketDetail(this.packets[index]);
                }
            });
        }

        // New: Smart auto-scroll detection
        const tableWrapper = this.elements.packetTableBody?.closest('.table-wrapper');
        if (tableWrapper) {
            tableWrapper.addEventListener('scroll', () => {
                const isAtBottom = tableWrapper.scrollHeight - tableWrapper.scrollTop <= tableWrapper.clientHeight + 50;
                this.userScrolled = !isAtBottom;
            });
        }

        // New: Save preferences on filter change
        if (this.elements.timeWindow) {
            this.elements.timeWindow.addEventListener('change', () => this.savePreferences());
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
        if (!this.elements.connectionStatus) return;
        this.elements.connectionStatus.className = `nav-icon-btn ${status}`;
        this.elements.connectionStatus.title = text;

        // Update icon color based on status
        const icon = this.elements.connectionStatus.querySelector('i');
        if (icon) {
            icon.style.color = status === 'connected' ? 'var(--status-success)' : 'var(--status-danger)';
        }
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

        // Add animation class for new rows and data attribute for modal
        if (append) {
            row.className = 'new-row';
            // Remove animation class after animation completes
            setTimeout(() => row.classList.remove('new-row'), 500);
        }

        // Store packet index for detail modal
        const packetIndex = this.packets.indexOf(packet);
        if (packetIndex >= 0) {
            row.dataset.packetIndex = packetIndex;
            row.style.cursor = 'pointer';
        }

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

            // Smart auto-scroll - only scroll if user hasn't scrolled up
            if (!this.paused && !this.userScrolled) {
                const container = this.elements.packetTableBody.closest('.table-wrapper');
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

        // Update traffic chart
        this.updateTrafficChart();
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
            return `
                <div class="list-row clickable" data-filter="${talker.ip}" title="Click to filter by ${talker.ip}">
                    <div class="list-txt">
                        <span class="flag-icon">${countryFlag}</span>${displayName}
                    </div>
                    <div class="list-val">${this.formatBytes(talker.bytes)}</div>
                </div>
            `;
        }).join('');

        // Add click handlers for filtering
        this.elements.talkerList.querySelectorAll('.clickable').forEach(el => {
            el.addEventListener('click', () => {
                const filterValue = el.dataset.filter;
                if (this.elements.packetFilter && filterValue) {
                    this.elements.packetFilter.value = filterValue;
                    this.filter = filterValue.toLowerCase();
                    this.renderPackets();
                    // Switch to live tab
                    const liveBtn = document.querySelector('.nav-icon-btn[data-tab="live"]');
                    if (liveBtn) liveBtn.click();
                }
            });
        });
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
                <div class="list-row clickable" data-filter="${name}" title="Click to filter by ${name}">
                    <div class="list-txt">
                        <i class="bi bi-cpu" style="font-size: 0.8rem; margin-right: 5px;"></i>${name}
                    </div>
                    <div class="list-val">${this.formatBytes(bytes)}</div>
                </div>
                <div class="progress-bar-mini" style="margin-bottom: 4px;">
                    <div class="fill" style="width: ${percentage}%"></div>
                </div>
            `;
        }).join('');

        // Add click handlers for filtering
        this.elements.processList.querySelectorAll('.clickable').forEach(el => {
            el.addEventListener('click', () => {
                const filterValue = el.dataset.filter;
                if (this.elements.packetFilter && filterValue) {
                    this.elements.packetFilter.value = filterValue;
                    this.filter = filterValue.toLowerCase();
                    this.renderPackets();
                    // Switch to live tab
                    const liveBtn = document.querySelector('.nav-icon-btn[data-tab="live"]');
                    if (liveBtn) liveBtn.click();
                }
            });
        });
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
        if (!countryCode || countryCode === 'Local') {
            return '<i class="bi bi-house-fill" style="color: var(--text-muted);" title="Local"></i>';
        }
        // Return flag-icons CSS class for proper SVG flags
        const code = countryCode.toLowerCase();
        return `<span class="fi fi-${code}" title="${countryCode}"></span>`;
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
                this.dbInfo = info;
                this.dbEnabled = info.enabled;

                // Update icon state
                if (this.elements.dbBtn) {
                    this.elements.dbBtn.classList.toggle('active', info.enabled);
                    this.elements.dbBtn.style.opacity = info.enabled ? '1' : '0.5';
                }

                // Refresh database stats periodically
                if (info.enabled) {
                    setInterval(() => this.updateDbStats(), 10000);
                }
            })
            .catch(err => {
                console.error('Failed to check database status:', err);
            });

        // Bind modal handlers
        if (this.elements.dbBtn) {
            this.elements.dbBtn.addEventListener('click', () => this.showDatabaseModal());
        }
        if (this.elements.dbModalClose) {
            this.elements.dbModalClose.addEventListener('click', () => this.closeDatabaseModal());
        }
        if (this.elements.dbModal) {
            this.elements.dbModal.addEventListener('click', (e) => {
                if (e.target === this.elements.dbModal) {
                    this.closeDatabaseModal();
                }
            });
        }
    }

    showDatabaseModal() {
        if (!this.elements.dbModal || !this.elements.dbDetails) return;

        // Fetch fresh data
        fetch('/api/database')
            .then(res => res.json())
            .then(info => {
                if (!info.enabled) {
                    this.elements.dbDetails.innerHTML = `
                        <div class="db-stat-item">
                            <div class="db-stat-icon"><i class="bi bi-x-circle"></i></div>
                            <div class="db-stat-info">
                                <div class="db-stat-label">Status</div>
                                <div class="db-stat-value">Database Disabled</div>
                            </div>
                        </div>
                    `;
                } else {
                    const filename = info.path ? info.path.split('/').pop() : 'Unknown';
                    const size = this.formatBytes(info.databaseSize || 0);
                    const packets = this.formatNumber(info.totalPackets || 0);
                    const earliest = info.earliestPacket ? new Date(info.earliestPacket).toLocaleString() : 'N/A';
                    const latest = info.latestPacket ? new Date(info.latestPacket).toLocaleString() : 'N/A';

                    this.elements.dbDetails.innerHTML = `
                        <div class="db-stat-item">
                            <div class="db-stat-icon"><i class="bi bi-file-earmark"></i></div>
                            <div class="db-stat-info">
                                <div class="db-stat-label">File</div>
                                <div class="db-stat-value">${filename}</div>
                            </div>
                        </div>
                        <div class="db-stat-item">
                            <div class="db-stat-icon"><i class="bi bi-hdd"></i></div>
                            <div class="db-stat-info">
                                <div class="db-stat-label">Size</div>
                                <div class="db-stat-value">${size}</div>
                            </div>
                        </div>
                        <div class="db-stat-item">
                            <div class="db-stat-icon"><i class="bi bi-box"></i></div>
                            <div class="db-stat-info">
                                <div class="db-stat-label">Total Packets</div>
                                <div class="db-stat-value">${packets}</div>
                            </div>
                        </div>
                        <div class="db-stat-item">
                            <div class="db-stat-icon"><i class="bi bi-clock-history"></i></div>
                            <div class="db-stat-info">
                                <div class="db-stat-label">Earliest Packet</div>
                                <div class="db-stat-value" style="font-size: 0.85rem;">${earliest}</div>
                            </div>
                        </div>
                        <div class="db-stat-item">
                            <div class="db-stat-icon"><i class="bi bi-clock"></i></div>
                            <div class="db-stat-info">
                                <div class="db-stat-label">Latest Packet</div>
                                <div class="db-stat-value" style="font-size: 0.85rem;">${latest}</div>
                            </div>
                        </div>
                    `;
                }
                this.elements.dbModal.classList.add('active');
            })
            .catch(err => {
                console.error('Failed to fetch database info:', err);
            });
    }

    closeDatabaseModal() {
        if (this.elements.dbModal) {
            this.elements.dbModal.classList.remove('active');
        }
    }

    updateDbStats() {
        fetch('/api/database')
            .then(res => res.json())
            .then(info => {
                this.dbInfo = info;
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

    // ===== NEW METHODS =====

    // Theme Management
    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        this.applyTheme();
        this.savePreferences();
    }

    togglePanel() {
        const appContainer = document.querySelector('.app-container');
        const panelExpandBtn = document.getElementById('panel-expand-btn');

        if (this.elements.filterPanel) {
            this.elements.filterPanel.classList.toggle('collapsed');
            this.panelCollapsed = this.elements.filterPanel.classList.contains('collapsed');
        }

        // Toggle grid layout
        if (appContainer) {
            appContainer.classList.toggle('panel-collapsed', this.panelCollapsed);
        }

        // Show/hide expand button in sidebar
        if (panelExpandBtn) {
            panelExpandBtn.style.display = this.panelCollapsed ? 'flex' : 'none';
        }

        this.savePreferences();
    }

    togglePanelMaximize() {
        const appContainer = document.querySelector('.app-container');
        this.panelMaximized = !this.panelMaximized;

        if (appContainer) {
            appContainer.classList.toggle('panel-maximized', this.panelMaximized);
        }

        // Update icon
        if (this.elements.panelMaximizeBtn) {
            const icon = this.elements.panelMaximizeBtn.querySelector('i');
            if (icon) {
                icon.className = this.panelMaximized ? 'bi bi-arrows-angle-contract' : 'bi bi-arrows-angle-expand';
            }
            this.elements.panelMaximizeBtn.title = this.panelMaximized ? 'Restore View' : 'Maximize Inspector';
        }

        // If maximizing, ensure not collapsed
        if (this.panelMaximized && this.panelCollapsed) {
            this.togglePanel(); // Uncollapse
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
            // Update icon
            if (this.elements.fullscreenBtn) {
                this.elements.fullscreenBtn.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
                this.elements.fullscreenBtn.title = 'Exit Fullscreen';
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
            // Update icon
            if (this.elements.fullscreenBtn) {
                this.elements.fullscreenBtn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
                this.elements.fullscreenBtn.title = 'Toggle Fullscreen';
            }
        }
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        if (this.elements.themeToggle) {
            const icon = this.elements.themeToggle.querySelector('i');
            if (icon) {
                icon.className = this.theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
            }
        }
        // Update chart colors for dark mode
        if (this.trafficChart) {
            this.updateChartTheme();
        }
    }

    updateChartTheme() {
        const isDark = this.theme === 'dark';
        const textColor = isDark ? '#8b949e' : '#5e6673';
        const gridColor = isDark ? '#30363d' : '#e5e7eb';

        this.trafficChart.options.scales.x.ticks.color = textColor;
        this.trafficChart.options.scales.y.ticks.color = textColor;
        this.trafficChart.options.scales.x.grid.color = gridColor;
        this.trafficChart.options.scales.y.grid.color = gridColor;
        this.trafficChart.update('none');
    }

    // Preferences Management
    loadPreferences() {
        const prefs = JSON.parse(localStorage.getItem('pitrack-prefs') || '{}');

        // Apply theme
        if (prefs.theme) this.theme = prefs.theme;
        this.applyTheme();

        // Apply time window via time pills
        if (prefs.timeWindow) {
            this.timeWindowMinutes = prefs.timeWindow;
            // Update time pill buttons
            document.querySelectorAll('.time-pill').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.minutes) === prefs.timeWindow);
            });
        }

        // Apply active tab
        if (prefs.activeTab) {
            const tabBtn = document.querySelector(`.nav-icon-btn[data-tab="${prefs.activeTab}"]`);
            if (tabBtn) tabBtn.click();
        }

        // Apply panel collapsed state
        if (prefs.panelCollapsed && this.elements.filterPanel) {
            this.elements.filterPanel.classList.add('collapsed');
            this.panelCollapsed = true;

            // Also update grid and expand button
            const appContainer = document.querySelector('.app-container');
            const panelExpandBtn = document.getElementById('panel-expand-btn');
            if (appContainer) appContainer.classList.add('panel-collapsed');
            if (panelExpandBtn) panelExpandBtn.style.display = 'flex';
        }
    }

    savePreferences() {
        const prefs = {
            theme: this.theme,
            timeWindow: this.timeWindowMinutes,
            activeTab: document.querySelector('.nav-icon-btn.active[data-tab]')?.dataset.tab || 'live',
            panelCollapsed: this.panelCollapsed || false
        };
        localStorage.setItem('pitrack-prefs', JSON.stringify(prefs));
        localStorage.setItem('pitrack-theme', this.theme);
    }

    // Traffic Chart
    initTrafficChart() {
        const canvas = this.elements.trafficChart;
        if (!canvas || typeof Chart === 'undefined') return;

        const isDark = this.theme === 'dark';
        const textColor = isDark ? '#8b949e' : '#5e6673';
        const gridColor = isDark ? '#30363d' : '#e5e7eb';

        this.trafficChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: this.trafficData.labels,
                datasets: [
                    {
                        label: 'Packets/s',
                        data: this.trafficData.packetsPerSec,
                        borderColor: '#007bff',
                        backgroundColor: 'rgba(0, 123, 255, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2
                    },
                    {
                        label: 'KB/s',
                        data: this.trafficData.bytesPerSec,
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        display: false,
                        grid: { display: false }
                    },
                    y: {
                        position: 'left',
                        beginAtZero: true,
                        ticks: { color: textColor, font: { size: 10 } },
                        grid: { color: gridColor }
                    },
                    y1: {
                        position: 'right',
                        beginAtZero: true,
                        ticks: { color: textColor, font: { size: 10 } },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    updateTrafficChart() {
        if (!this.trafficChart || !this.stats) return;

        const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

        this.trafficData.labels.push(now);
        this.trafficData.packetsPerSec.push(Math.round(this.stats.packetsPerSec));
        this.trafficData.bytesPerSec.push(Math.round(this.stats.bytesPerSec / 1024)); // KB/s

        // Keep only last N points
        if (this.trafficData.labels.length > this.maxChartPoints) {
            this.trafficData.labels.shift();
            this.trafficData.packetsPerSec.shift();
            this.trafficData.bytesPerSec.shift();
        }

        this.trafficChart.update('none');
    }

    // Pause UI Management
    updatePauseUI() {
        const tableWrapper = this.elements.packetTableBody?.closest('.table-wrapper');
        if (tableWrapper) {
            tableWrapper.classList.toggle('paused', this.paused);
        }
        if (this.elements.liveIndicator) {
            this.elements.liveIndicator.classList.toggle('paused', this.paused);
            this.elements.liveIndicator.querySelector('span:last-child').textContent = this.paused ? 'Paused' : 'Live';
        }
    }

    // Packet Detail Modal
    showPacketDetail(packet) {
        if (!packet || !this.elements.packetModal || !this.elements.packetDetails) return;

        this.selectedPacket = packet;
        const time = new Date(packet.timestamp);

        const details = [
            ['Timestamp', time.toLocaleString()],
            ['Source IP', packet.srcIp + (packet.srcPort ? `:${packet.srcPort}` : '')],
            ['Source Host', packet.srcHostname || '-'],
            ['Source Country', packet.srcCountry || '-'],
            ['Destination IP', packet.dstIp + (packet.dstPort ? `:${packet.dstPort}` : '')],
            ['Dest Host', packet.dstHostname || '-'],
            ['Dest Country', packet.dstCountry || '-'],
            ['Protocol', packet.protocol],
            ['Length', `${packet.length} bytes`],
            ['Process', packet.processName || '-'],
            ['Info', packet.info || '-'],
            ['Application', packet.application || '-']
        ];

        if (packet.srcMac) details.push(['Source MAC', packet.srcMac]);
        if (packet.dstMac) details.push(['Dest MAC', packet.dstMac]);

        this.elements.packetDetails.innerHTML = details.map(([label, value]) =>
            `<div class="detail-label">${label}</div><div class="detail-value">${value}</div>`
        ).join('');

        this.elements.packetModal.classList.add('active');
    }

    closePacketModal() {
        if (this.elements.packetModal) {
            this.elements.packetModal.classList.remove('active');
        }
        this.selectedPacket = null;
    }

    // Export to CSV
    exportToCsv() {
        const filter = this.elements.historyFilter?.value || '';
        const country = this.elements.historyCountry?.value || '';
        const startTime = this.elements.historyStart?.value ? new Date(this.elements.historyStart.value).toISOString() : '';
        const endTime = this.elements.historyEnd?.value ? new Date(this.elements.historyEnd.value).toISOString() : '';

        let url = `/api/history?limit=10000&offset=0`;
        if (filter) url += `&filter=${encodeURIComponent(filter)}`;
        if (country) url += `&country=${encodeURIComponent(country)}`;
        if (startTime) url += `&start=${encodeURIComponent(startTime)}`;
        if (endTime) url += `&end=${encodeURIComponent(endTime)}`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                const packets = data.packets || [];
                if (packets.length === 0) {
                    alert('No packets to export');
                    return;
                }

                const headers = ['Timestamp', 'Source IP', 'Source Port', 'Dest IP', 'Dest Port', 'Protocol', 'Length', 'Process', 'Info'];
                const rows = packets.map(p => [
                    new Date(p.timestamp).toISOString(),
                    p.srcIp,
                    p.srcPort || '',
                    p.dstIp,
                    p.dstPort || '',
                    p.protocol,
                    p.length,
                    p.processName || '',
                    `"${(p.info || '').replace(/"/g, '""')}"`
                ]);

                const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `pitrack-export-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
            })
            .catch(err => {
                console.error('Export failed:', err);
                alert('Export failed');
            });
    }

    // Keyboard Shortcuts
    bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case ' ': // Space - Toggle pause
                    e.preventDefault();
                    if (this.elements.pauseBtn) this.elements.pauseBtn.click();
                    break;
                case 'Escape': // Escape - Clear filter or close modal
                    if (this.elements.packetModal?.classList.contains('active')) {
                        this.closePacketModal();
                    } else if (this.elements.packetFilter) {
                        this.elements.packetFilter.value = '';
                        this.filter = '';
                        this.renderPackets();
                    }
                    break;
                case '1':
                case '2':
                case '3':
                case '4':
                    // Number keys for tabs
                    const tabs = ['live', 'connections', 'history', 'countries'];
                    const tabBtn = document.querySelector(`.nav-icon-btn[data-tab="${tabs[parseInt(e.key) - 1]}"]`);
                    if (tabBtn) tabBtn.click();
                    break;
                case 'd':
                case 'D':
                    // Toggle dark mode
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.toggleTheme();
                    }
                    break;
            }
        });
    }

    // Port Name Helper
    getPortName(port) {
        return this.portNames[port] || null;
    }

    formatPortWithName(port) {
        if (!port || port === 0) return '';
        const name = this.getPortName(port);
        return name ? `${port} <span class="port-label">(${name})</span>` : String(port);
    }

    // Search Highlighting
    highlightText(text, query) {
        if (!query || !text) return text;
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<span class="highlight">$1</span>');
    }

    // Load Countries for Dropdown
    loadCountries() {
        fetch('/api/countries')
            .then(res => res.json())
            .then(countries => {
                if (!this.elements.historyCountry || !Array.isArray(countries)) return;

                // Clear existing options except first
                this.elements.historyCountry.innerHTML = '<option value="">All Countries</option>';

                // Add country options with flag emojis
                countries.forEach(code => {
                    const flag = this.getCountryFlag(code);
                    const option = document.createElement('option');
                    option.value = code;
                    option.textContent = `${flag} ${code}`;
                    this.elements.historyCountry.appendChild(option);
                });
            })
            .catch(err => {
                console.log('Could not load countries:', err);
            });
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.pitrack = new PiTrack();
});
