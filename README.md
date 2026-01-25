# Pi-Track 📡

A real-time network traffic analyzer designed for Raspberry Pi, providing a web-based interface similar to Wireshark.

![Pi-Track](https://img.shields.io/badge/Platform-Raspberry%20Pi-red?logo=raspberry-pi)
![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- 🔍 **Real-time packet capture** - Monitor all network traffic passing through your Pi
- 📊 **Live statistics** - Packets/sec, bytes/sec, protocol distribution
- 🏆 **Top talkers** - See which hosts are generating the most traffic
- 📱 **Application detection** - Identify HTTP, HTTPS, DNS, SSH, and more
- 🔗 **Connection tracking** - View active network connections
- 🌐 **Web interface** - Access from any device on your network
- ⚡ **WebSocket updates** - Real-time updates without page refresh
- 🎨 **Modern dark UI** - Beautiful cyber-themed interface
- 🌍 **GeoIP & Hostname** - Shows country flags and resolved hostnames
- 💾 **SQLite storage** - Persistent packet history with search & filtering

## Quick Start

### Prerequisites

On **Raspberry Pi OS** (or other Debian-based systems):

```bash
# Install libpcap development files
sudo apt-get update
sudo apt-get install -y libpcap-dev

# Install Go (if not already installed)
wget https://go.dev/dl/go1.21.6.linux-arm64.tar.gz
sudo tar -C /usr/local -xzf go1.21.6.linux-arm64.tar.gz
export PATH=$PATH:/usr/local/go/bin
```

### Build & Run

```bash
# Clone or copy the project to your Pi
cd pi-track

# Build the application
go build -o pi-track .

# Run (requires root for packet capture)
sudo ./pi-track
```

### Access the Web Interface

Open a browser on any device in your network and navigate to:

```
http://<raspberry-pi-ip>:25565
```

## Command Line Options

```bash
Usage of pi-track:
  -interface string
        Network interface to capture (auto-detected if not specified)
  -max-packets int
        Maximum packets to store in memory (default 10000)
  -port int
        Web server port (default 25565)
  -db string
        SQLite database path (default "pitrack.db", use empty string to disable)
```

### Examples

```bash
# Capture on specific interface
sudo ./pi-track -interface eth0

# Use a different port
sudo ./pi-track -port 8080

# Store more packets in memory
sudo ./pi-track -max-packets 50000

# Disable database storage
sudo ./pi-track -db ""

# Custom database path
sudo ./pi-track -db /var/lib/pitrack/packets.db
```

## Building for Raspberry Pi

> **Note**: Due to CGO requirements for libpcap, cross-compilation is not straightforward. The recommended approach is to build directly on your Raspberry Pi.

### Build directly on Pi (Recommended)

```bash
# Copy the source to your Pi
scp -r . pi@raspberrypi.local:~/pi-track/

# SSH to your Pi
ssh pi@raspberrypi.local

# Install dependencies
sudo apt-get update
sudo apt-get install -y libpcap-dev golang

# Build
cd ~/pi-track
go build -o pi-track .
```

### Alternative: Use Docker for cross-compilation

If you need to cross-compile, you can use Docker with a cross-compilation toolchain, but building on the Pi is simpler and recommended.

## Running as a Service

Create a systemd service to run Pi-Track automatically on boot:

```bash
sudo nano /etc/systemd/system/pi-track.service
```

Add the following content:

```ini
[Unit]
Description=Pi-Track Network Monitor
After=network.target

[Service]
Type=simple
ExecStart=/home/pi/pi-track/pi-track -interface eth0
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-track
sudo systemctl start pi-track
```

## API Endpoints

Pi-Track exposes a REST API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/packets` | Returns the last 500 captured packets (live) |
| `GET /api/stats` | Returns current statistics |
| `GET /api/connections` | Returns active connections |
| `GET /api/interfaces` | Lists available network interfaces |
| `GET /api/database` | Returns database status and info |
| `GET /api/history` | Query stored packets with filters |
| `GET /api/history/stats` | Get historical statistics |
| `WS /ws` | WebSocket endpoint for real-time updates |

### History API Parameters

```
GET /api/history?limit=100&offset=0&filter=google&start=2024-01-01T00:00:00Z&end=2024-01-31T23:59:59Z
```

| Parameter | Description |
|-----------|-------------|
| `limit` | Max packets to return (default: 100, max: 1000) |
| `offset` | Pagination offset |
| `filter` | Search filter (matches IP, protocol, hostname, etc.) |
| `start` | Start time (RFC3339 format) |
| `end` | End time (RFC3339 format) |

## Architecture

```
pi-track/
├── main.go          # Go backend with packet capture
├── database.go      # SQLite storage module
├── go.mod           # Go module definition
└── web/
    ├── index.html   # Main dashboard
    ├── styles.css   # Styling
    └── app.js       # Frontend JavaScript
```

The web files are embedded into the binary using Go's `embed` package, making deployment a single-file affair.

## Tech Stack

- **Backend**: Go with [gopacket](https://github.com/google/gopacket) for packet capture
- **Frontend**: Vanilla JavaScript with WebSockets for real-time updates
- **Styling**: Custom CSS with a modern cyber theme

## Security Considerations

⚠️ **Important**: This tool captures all network traffic on the specified interface. Consider the following:

1. **Root access required** - Packet capture requires elevated privileges
2. **Network access** - The web interface is accessible from any device on your network
3. **No authentication** - By default, there's no login required
4. **Sensitive data** - Captured packets may contain sensitive information

For production use, consider:
- Running behind a reverse proxy with authentication
- Restricting access via firewall rules
- Using HTTPS

## Troubleshooting

### "Permission denied" error
Make sure to run with `sudo`:
```bash
sudo ./pi-track
```

### "No network interface found"
Specify the interface manually:
```bash
sudo ./pi-track -interface eth0
# or for WiFi
sudo ./pi-track -interface wlan0
```

### "libpcap not found"
Install libpcap development files:
```bash
sudo apt-get install libpcap-dev
```

## License

MIT License - feel free to use, modify, and distribute.

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.
