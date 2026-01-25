package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcap"
	"github.com/gorilla/websocket"
)

//go:embed web/*
var webContent embed.FS

// Packet represents a captured network packet
type Packet struct {
	ID          int64     `json:"id"`
	Timestamp   time.Time `json:"timestamp"`
	SrcIP       string    `json:"srcIp"`
	DstIP       string    `json:"dstIp"`
	SrcPort     uint16    `json:"srcPort"`
	DstPort     uint16    `json:"dstPort"`
	Protocol    string    `json:"protocol"`
	Length      int       `json:"length"`
	Info        string    `json:"info"`
	SrcMAC      string    `json:"srcMac"`
	DstMAC      string    `json:"dstMac"`
	Application string    `json:"application"`
	SrcHostname string    `json:"srcHostname"`
	DstHostname string    `json:"dstHostname"`
	SrcCountry  string    `json:"srcCountry"`
	DstCountry  string    `json:"dstCountry"`
}

// Stats holds network statistics
type Stats struct {
	TotalPackets     int64            `json:"totalPackets"`
	TotalBytes       int64            `json:"totalBytes"`
	PacketsPerSec    float64          `json:"packetsPerSec"`
	BytesPerSec      float64          `json:"bytesPerSec"`
	ProtocolStats    map[string]int64 `json:"protocolStats"`
	CountryStats     map[string]int64 `json:"countryStats"`
	TopTalkers       []Talker         `json:"topTalkers"`
	ApplicationStats map[string]int64 `json:"applicationStats"`
	StartTime        time.Time        `json:"startTime"`
}

// Talker represents a host and their traffic stats
type Talker struct {
	IP       string `json:"ip"`
	Packets  int64  `json:"packets"`
	Bytes    int64  `json:"bytes"`
	Hostname string `json:"hostname"`
	Country  string `json:"country"`
}

// Connection represents a network connection
type Connection struct {
	SrcIP       string    `json:"srcIp"`
	DstIP       string    `json:"dstIp"`
	SrcPort     uint16    `json:"srcPort"`
	DstPort     uint16    `json:"dstPort"`
	Protocol    string    `json:"protocol"`
	Packets     int64     `json:"packets"`
	Bytes       int64     `json:"bytes"`
	FirstSeen   time.Time `json:"firstSeen"`
	LastSeen    time.Time `json:"lastSeen"`
	State       string    `json:"state"`
	SrcHostname string    `json:"srcHostname"`
	DstHostname string    `json:"dstHostname"`
	SrcCountry  string    `json:"srcCountry"`
	DstCountry  string    `json:"dstCountry"`
}

// wsClient wraps a WebSocket connection with a send channel for thread-safe writes
type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

// PacketStore holds captured packets and statistics
type PacketStore struct {
	mu              sync.RWMutex
	packets         []Packet
	maxPackets      int
	packetID        int64
	stats           Stats
	ipStats         map[string]*ipTraffic
	connections     map[string]*Connection
	clients         map[*wsClient]bool
	clientsMu       sync.RWMutex
	lastStatsUpdate time.Time
	packetsWindow   []time.Time
	bytesWindow     []int
}

type ipTraffic struct {
	packets int64
	bytes   int64
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// NewPacketStore creates a new packet store
func NewPacketStore(maxPackets int) *PacketStore {
	return &PacketStore{
		packets:    make([]Packet, 0, maxPackets),
		maxPackets: maxPackets,
		stats: Stats{
			ProtocolStats:    make(map[string]int64),
			CountryStats:     make(map[string]int64),
			ApplicationStats: make(map[string]int64),
			StartTime:        time.Now(),
		},
		ipStats:         make(map[string]*ipTraffic),
		connections:     make(map[string]*Connection),
		clients:         make(map[*wsClient]bool),
		lastStatsUpdate: time.Now(),
		packetsWindow:   make([]time.Time, 0),
		bytesWindow:     make([]int, 0),
	}
}

// AddPacket adds a packet to the store
func (ps *PacketStore) AddPacket(p Packet) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ps.packetID++
	p.ID = ps.packetID

	// Add to packet list (circular buffer)
	if len(ps.packets) >= ps.maxPackets {
		ps.packets = ps.packets[1:]
	}
	ps.packets = append(ps.packets, p)

	// Update stats
	ps.stats.TotalPackets++
	ps.stats.TotalBytes += int64(p.Length)
	ps.stats.ProtocolStats[p.Protocol]++

	if p.Application != "" {
		ps.stats.ApplicationStats[p.Application]++
	}

	// Track Country Stats (By Bytes)
	if p.SrcCountry != "" {
		ps.stats.CountryStats[p.SrcCountry] += int64(p.Length)
	}
	if p.DstCountry != "" {
		ps.stats.CountryStats[p.DstCountry] += int64(p.Length)
	}

	// Track IP stats
	if p.SrcIP != "" {
		if ps.ipStats[p.SrcIP] == nil {
			ps.ipStats[p.SrcIP] = &ipTraffic{}
		}
		ps.ipStats[p.SrcIP].packets++
		ps.ipStats[p.SrcIP].bytes += int64(p.Length)
	}

	// Track connections
	if p.SrcPort > 0 || p.DstPort > 0 {
		connKey := fmt.Sprintf("%s:%d->%s:%d/%s", p.SrcIP, p.SrcPort, p.DstIP, p.DstPort, p.Protocol)
		if conn, exists := ps.connections[connKey]; exists {
			conn.Packets++
			conn.Bytes += int64(p.Length)
			conn.LastSeen = p.Timestamp
		} else {
			ps.connections[connKey] = &Connection{
				SrcIP:     p.SrcIP,
				DstIP:     p.DstIP,
				SrcPort:   p.SrcPort,
				DstPort:   p.DstPort,
				Protocol:  p.Protocol,
				Packets:   1,
				Bytes:     int64(p.Length),
				FirstSeen: p.Timestamp,
				LastSeen:  p.Timestamp,
				State:     "active",
			}
		}
	}

	// Update rate calculation window
	now := time.Now()
	ps.packetsWindow = append(ps.packetsWindow, now)
	ps.bytesWindow = append(ps.bytesWindow, p.Length)

	// Keep only last 5 seconds
	cutoff := now.Add(-5 * time.Second)
	for len(ps.packetsWindow) > 0 && ps.packetsWindow[0].Before(cutoff) {
		ps.packetsWindow = ps.packetsWindow[1:]
		ps.bytesWindow = ps.bytesWindow[1:]
	}

	// Calculate rates
	if len(ps.packetsWindow) > 0 {
		duration := now.Sub(ps.packetsWindow[0]).Seconds()
		if duration > 0 {
			ps.stats.PacketsPerSec = float64(len(ps.packetsWindow)) / duration
			totalBytes := 0
			for _, b := range ps.bytesWindow {
				totalBytes += b
			}
			ps.stats.BytesPerSec = float64(totalBytes) / duration
		}
	}
}

// GetStats returns current statistics
func (ps *PacketStore) GetStats() Stats {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	// Calculate top talkers and country stats dynamically
	talkers := make([]Talker, 0, len(ps.ipStats))
	countryStats := make(map[string]int64)

	for ip, stats := range ps.ipStats {
		info := getIPInfo(ip)
		if info.Hostname == "" && info.Country == "" {
			// Trigger resolution for this IP if not already trying
			go resolveIPInfo(ip)
		}

		// Aggregate country stats
		if info.Country != "" {
			countryStats[info.Country] += stats.bytes
		}

		talkers = append(talkers, Talker{
			IP:       ip,
			Packets:  stats.packets,
			Bytes:    stats.bytes,
			Hostname: info.Hostname,
			Country:  info.Country,
		})
	}

	// Sort by bytes descending
	sort.Slice(talkers, func(i, j int) bool {
		return talkers[i].Bytes > talkers[j].Bytes
	})

	// Keep top 10
	if len(talkers) > 10 {
		talkers = talkers[:10]
	}

	stats := ps.stats
	stats.TopTalkers = talkers
	stats.CountryStats = countryStats // Assign the dynamically calculated map
	return stats
}

// GetPackets returns recent packets
func (ps *PacketStore) GetPackets(limit int) []Packet {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	if limit <= 0 || limit > len(ps.packets) {
		limit = len(ps.packets)
	}

	start := len(ps.packets) - limit
	if start < 0 {
		start = 0
	}

	result := make([]Packet, limit)
	copy(result, ps.packets[start:])
	return result
}

// GetConnections returns active connections
func (ps *PacketStore) GetConnections() []Connection {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	connections := make([]Connection, 0, len(ps.connections))
	for _, conn := range ps.connections {
		connections = append(connections, *conn)
	}

	// Sort by bytes descending
	sort.Slice(connections, func(i, j int) bool {
		return connections[i].Bytes > connections[j].Bytes
	})

	// Keep top 100
	if len(connections) > 100 {
		connections = connections[:100]
	}

	return connections
}

// Broadcast sends data to all connected WebSocket clients
func (ps *PacketStore) Broadcast(messageType string, data interface{}) {
	message := map[string]interface{}{
		"type": messageType,
		"data": data,
	}

	jsonData, err := json.Marshal(message)
	if err != nil {
		return
	}

	ps.clientsMu.RLock()
	defer ps.clientsMu.RUnlock()

	for client := range ps.clients {
		select {
		case client.send <- jsonData:
		default:
			// Channel full, skip this message for this client
		}
	}
}

var ipInfoCache sync.Map

// IPInfo holds resolved information about an IP
type IPInfo struct {
	Hostname string
	Country  string
}

// resolveIPInfo returns hostname and country for an IP address
func resolveIPInfo(ip string) IPInfo {
	if cached, ok := ipInfoCache.Load(ip); ok {
		return cached.(IPInfo)
	}

	info := IPInfo{}

	// Skip private/local IPs for GeoIP
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		ipInfoCache.Store(ip, info)
		return info
	}

	// Resolve hostname (reverse DNS)
	go func(ipAddr string) {
		names, err := net.LookupAddr(ipAddr)
		if err == nil && len(names) > 0 {
			if cached, ok := ipInfoCache.Load(ipAddr); ok {
				existing := cached.(IPInfo)
				existing.Hostname = names[0]
				ipInfoCache.Store(ipAddr, existing)
			}
		}
	}(ip)

	// Check if it's a private IP (skip GeoIP lookup for local addresses)
	if isPrivateIP(parsedIP) {
		info.Country = "Local"
		ipInfoCache.Store(ip, info)
		return info
	}

	// GeoIP lookup using ip-api.com (free, no API key needed)
	go func(ipAddr string) {
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get(fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode", ipAddr))
		if err != nil {
			return
		}
		defer resp.Body.Close()

		var result struct {
			Status      string `json:"status"`
			Country     string `json:"country"`
			CountryCode string `json:"countryCode"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return
		}

		if result.Status == "success" {
			if cached, ok := ipInfoCache.Load(ipAddr); ok {
				existing := cached.(IPInfo)
				existing.Country = result.CountryCode
				ipInfoCache.Store(ipAddr, existing)
			} else {
				ipInfoCache.Store(ipAddr, IPInfo{Country: result.CountryCode})
			}
		}
	}(ip)

	ipInfoCache.Store(ip, info)
	return info
}

// isPrivateIP checks if an IP is a private/local address
func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}

	// Check private ranges
	privateRanges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"fc00::/7",
		"fe80::/10",
	}

	for _, cidr := range privateRanges {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

// getIPInfo retrieves cached IP info (may be partially filled if lookups are pending)
func getIPInfo(ip string) IPInfo {
	if cached, ok := ipInfoCache.Load(ip); ok {
		return cached.(IPInfo)
	}
	return IPInfo{}
}

// resolveHostname is a helper for backward compatibility
func resolveHostname(ip string) string {
	info := getIPInfo(ip)
	if info.Hostname == "" {
		// Trigger resolution
		resolveIPInfo(ip)
		return ""
	}
	return info.Hostname
}

func detectApplication(srcPort, dstPort uint16) string {
	ports := map[uint16]string{
		20:    "FTP-Data",
		21:    "FTP",
		22:    "SSH",
		23:    "Telnet",
		25:    "SMTP",
		53:    "DNS",
		67:    "DHCP",
		68:    "DHCP",
		80:    "HTTP",
		110:   "POP3",
		123:   "NTP",
		143:   "IMAP",
		443:   "HTTPS",
		465:   "SMTPS",
		587:   "SMTP",
		993:   "IMAPS",
		995:   "POP3S",
		1194:  "OpenVPN",
		1883:  "MQTT",
		3306:  "MySQL",
		3389:  "RDP",
		5432:  "PostgreSQL",
		5900:  "VNC",
		6379:  "Redis",
		8080:  "HTTP-Proxy",
		8443:  "HTTPS-Alt",
		8883:  "MQTT-TLS",
		27017: "MongoDB",
	}

	if app, ok := ports[dstPort]; ok {
		return app
	}
	if app, ok := ports[srcPort]; ok {
		return app
	}
	return ""
}

func startCapture(iface string, store *PacketStore, db *Database) error {
	// Open the device
	handle, err := pcap.OpenLive(iface, 65536, true, pcap.BlockForever)
	if err != nil {
		return fmt.Errorf("error opening interface %s: %v", iface, err)
	}
	defer handle.Close()

	log.Printf("Started capturing on interface: %s", iface)

	packetSource := gopacket.NewPacketSource(handle, handle.LinkType())

	for packet := range packetSource.Packets() {
		p := parsePacket(packet)
		store.AddPacket(p)

		// Store in database if enabled
		if db != nil {
			db.QueuePacket(p)
		}

		// Broadcast to WebSocket clients
		store.Broadcast("packet", p)
	}

	return nil
}

func parsePacket(packet gopacket.Packet) Packet {
	p := Packet{
		Timestamp: packet.Metadata().Timestamp,
		Length:    packet.Metadata().Length,
		Protocol:  "Unknown",
	}

	// Ethernet layer
	if ethLayer := packet.Layer(layers.LayerTypeEthernet); ethLayer != nil {
		eth := ethLayer.(*layers.Ethernet)
		p.SrcMAC = eth.SrcMAC.String()
		p.DstMAC = eth.DstMAC.String()
	}

	// IP layer
	if ipLayer := packet.Layer(layers.LayerTypeIPv4); ipLayer != nil {
		ip := ipLayer.(*layers.IPv4)
		p.SrcIP = ip.SrcIP.String()
		p.DstIP = ip.DstIP.String()
		p.Protocol = ip.Protocol.String()
	} else if ip6Layer := packet.Layer(layers.LayerTypeIPv6); ip6Layer != nil {
		ip6 := ip6Layer.(*layers.IPv6)
		p.SrcIP = ip6.SrcIP.String()
		p.DstIP = ip6.DstIP.String()
		p.Protocol = ip6.NextHeader.String()
	}

	// TCP layer
	if tcpLayer := packet.Layer(layers.LayerTypeTCP); tcpLayer != nil {
		tcp := tcpLayer.(*layers.TCP)
		p.SrcPort = uint16(tcp.SrcPort)
		p.DstPort = uint16(tcp.DstPort)
		p.Protocol = "TCP"

		// Build info string
		flags := ""
		if tcp.SYN {
			flags += "SYN "
		}
		if tcp.ACK {
			flags += "ACK "
		}
		if tcp.FIN {
			flags += "FIN "
		}
		if tcp.RST {
			flags += "RST "
		}
		if tcp.PSH {
			flags += "PSH "
		}
		p.Info = fmt.Sprintf("%d → %d [%s] Seq=%d Ack=%d Win=%d",
			tcp.SrcPort, tcp.DstPort, flags, tcp.Seq, tcp.Ack, tcp.Window)
	}

	// UDP layer
	if udpLayer := packet.Layer(layers.LayerTypeUDP); udpLayer != nil {
		udp := udpLayer.(*layers.UDP)
		p.SrcPort = uint16(udp.SrcPort)
		p.DstPort = uint16(udp.DstPort)
		p.Protocol = "UDP"
		p.Info = fmt.Sprintf("%d → %d Len=%d", udp.SrcPort, udp.DstPort, udp.Length)
	}

	// ICMP layer
	if icmpLayer := packet.Layer(layers.LayerTypeICMPv4); icmpLayer != nil {
		icmp := icmpLayer.(*layers.ICMPv4)
		p.Protocol = "ICMP"
		p.Info = fmt.Sprintf("Type=%d Code=%d", icmp.TypeCode.Type(), icmp.TypeCode.Code())
	}

	// ARP layer
	if arpLayer := packet.Layer(layers.LayerTypeARP); arpLayer != nil {
		arp := arpLayer.(*layers.ARP)
		p.Protocol = "ARP"
		p.SrcIP = net.IP(arp.SourceProtAddress).String()
		p.DstIP = net.IP(arp.DstProtAddress).String()
		if arp.Operation == 1 {
			p.Info = fmt.Sprintf("Who has %s? Tell %s", p.DstIP, p.SrcIP)
		} else {
			p.Info = fmt.Sprintf("%s is at %s", p.SrcIP, net.HardwareAddr(arp.SourceHwAddress))
		}
	}

	// DNS layer
	if dnsLayer := packet.Layer(layers.LayerTypeDNS); dnsLayer != nil {
		dns := dnsLayer.(*layers.DNS)
		p.Application = "DNS"
		if dns.QR {
			p.Info = fmt.Sprintf("DNS Response: %d answers", len(dns.Answers))
		} else if len(dns.Questions) > 0 {
			p.Info = fmt.Sprintf("DNS Query: %s", string(dns.Questions[0].Name))
		}
	}

	// Detect application by port if not already set
	if p.Application == "" {
		p.Application = detectApplication(p.SrcPort, p.DstPort)
	}

	// Resolve hostname and country for source/destination IPs (async)
	if p.SrcIP != "" {
		srcInfo := getIPInfo(p.SrcIP)
		if srcInfo.Hostname == "" && srcInfo.Country == "" {
			go resolveIPInfo(p.SrcIP)
		} else {
			p.SrcHostname = srcInfo.Hostname
			p.SrcCountry = srcInfo.Country
		}
	}
	if p.DstIP != "" {
		dstInfo := getIPInfo(p.DstIP)
		if dstInfo.Hostname == "" && dstInfo.Country == "" {
			go resolveIPInfo(p.DstIP)
		} else {
			p.DstHostname = dstInfo.Hostname
			p.DstCountry = dstInfo.Country
		}
	}

	return p
}

func main() {
	port := flag.Int("port", 25565, "Web server port")
	iface := flag.String("interface", "", "Network interface to capture (leave empty to auto-detect)")
	maxPackets := flag.Int("max-packets", 10000, "Maximum packets to store in memory")
	dbPath := flag.String("db", "pitrack.db", "SQLite database path (use empty string to disable)")
	flag.Parse()

	// Auto-detect interface if not specified
	if *iface == "" {
		interfaces, err := pcap.FindAllDevs()
		if err != nil {
			log.Fatal("Error finding interfaces:", err)
		}

		// Find first non-loopback interface with an address
		for _, i := range interfaces {
			if len(i.Addresses) > 0 {
				for _, addr := range i.Addresses {
					if addr.IP != nil && !addr.IP.IsLoopback() {
						*iface = i.Name
						break
					}
				}
			}
			if *iface != "" {
				break
			}
		}

		if *iface == "" && len(interfaces) > 0 {
			*iface = interfaces[0].Name
		}
	}

	if *iface == "" {
		log.Fatal("No network interface found. Please specify one with -interface flag.")
	}

	// Initialize database if path is provided
	var db *Database
	if *dbPath != "" {
		var err error
		db, err = NewDatabase(*dbPath)
		if err != nil {
			log.Printf("Warning: Failed to initialize database: %v (continuing without database)", err)
			db = nil
		} else {
			log.Printf("Database initialized: %s", *dbPath)
			defer db.Close()
		}
	}

	store := NewPacketStore(*maxPackets)

	// Start packet capture in background
	go func() {
		if err := startCapture(*iface, store, db); err != nil {
			log.Printf("Capture error: %v", err)
		}
	}()

	// Start stats broadcaster
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		for range ticker.C {
			store.Broadcast("stats", store.GetStats())
		}
	}()

	// Serve static files from embedded filesystem
	webFS, err := fs.Sub(webContent, "web")
	if err != nil {
		log.Fatal(err)
	}

	// API endpoints
	http.HandleFunc("/api/packets", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(store.GetPackets(500))
	})

	http.HandleFunc("/api/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(store.GetStats())
	})

	http.HandleFunc("/api/connections", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(store.GetConnections())
	})

	http.HandleFunc("/api/interfaces", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		interfaces, _ := pcap.FindAllDevs()
		result := []map[string]interface{}{}
		for _, i := range interfaces {
			addrs := []string{}
			for _, a := range i.Addresses {
				if a.IP != nil {
					addrs = append(addrs, a.IP.String())
				}
			}
			result = append(result, map[string]interface{}{
				"name":        i.Name,
				"description": i.Description,
				"addresses":   addrs,
				"active":      i.Name == *iface,
			})
		}
		json.NewEncoder(w).Encode(result)
	})

	// Database API endpoints (only if database is enabled)
	if db != nil {
		// Query historical packets
		http.HandleFunc("/api/history", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Access-Control-Allow-Origin", "*")

			// Parse query parameters
			limit := 100
			offset := 0
			filter := r.URL.Query().Get("filter")

			if l := r.URL.Query().Get("limit"); l != "" {
				fmt.Sscanf(l, "%d", &limit)
				if limit > 1000 {
					limit = 1000
				}
			}
			if o := r.URL.Query().Get("offset"); o != "" {
				fmt.Sscanf(o, "%d", &offset)
			}

			// Parse time range
			var startTime, endTime *time.Time
			if s := r.URL.Query().Get("start"); s != "" {
				if t, err := time.Parse(time.RFC3339, s); err == nil {
					startTime = &t
				}
			}
			if e := r.URL.Query().Get("end"); e != "" {
				if t, err := time.Parse(time.RFC3339, e); err == nil {
					endTime = &t
				}
			}

			// Parse exclude IPs
			var excludeIPs []string
			if exclude := r.URL.Query().Get("exclude"); exclude != "" {
				excludeIPs = strings.Split(exclude, ",")
			}

			packets, total, err := db.QueryPackets(limit, offset, filter, excludeIPs, startTime, endTime)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"packets": packets,
				"total":   total,
				"limit":   limit,
				"offset":  offset,
			})
		})

		// Historical statistics
		http.HandleFunc("/api/history/stats", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Access-Control-Allow-Origin", "*")

			var startTime, endTime *time.Time
			if s := r.URL.Query().Get("start"); s != "" {
				if t, err := time.Parse(time.RFC3339, s); err == nil {
					startTime = &t
				}
			}
			if e := r.URL.Query().Get("end"); e != "" {
				if t, err := time.Parse(time.RFC3339, e); err == nil {
					endTime = &t
				}
			}

			stats, err := db.GetStats(startTime, endTime)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			json.NewEncoder(w).Encode(stats)
		})

		// Database info
		http.HandleFunc("/api/database", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Access-Control-Allow-Origin", "*")

			info, err := db.GetDatabaseInfo()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			info["enabled"] = true
			info["path"] = *dbPath

			json.NewEncoder(w).Encode(info)
		})
	} else {
		// Database disabled placeholder
		http.HandleFunc("/api/database", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"enabled": false,
			})
		})
	}

	// WebSocket endpoint
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("WebSocket upgrade error:", err)
			return
		}

		client := &wsClient{
			conn: conn,
			send: make(chan []byte, 256),
		}

		store.clientsMu.Lock()
		store.clients[client] = true
		store.clientsMu.Unlock()

		// Cleanup on disconnect
		defer func() {
			store.clientsMu.Lock()
			delete(store.clients, client)
			store.clientsMu.Unlock()
			close(client.send)
			conn.Close()
		}()

		// Send initial data
		initData, _ := json.Marshal(map[string]interface{}{
			"type": "init",
			"data": map[string]interface{}{
				"packets":     store.GetPackets(100),
				"stats":       store.GetStats(),
				"connections": store.GetConnections(),
				"interface":   *iface,
			},
		})
		conn.WriteMessage(websocket.TextMessage, initData)

		// Writer goroutine - handles all writes to this connection
		go func() {
			for msg := range client.send {
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			}
		}()

		// Reader loop - keep connection alive and detect disconnects
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	})

	// Serve static files
	http.Handle("/", http.FileServer(http.FS(webFS)))

	// Print available interfaces
	fmt.Println("\n╔══════════════════════════════════════════════════════════════╗")
	fmt.Println("║                    🌐 Pi-Track Network Monitor                ║")
	fmt.Println("╠══════════════════════════════════════════════════════════════╣")
	fmt.Printf("║  📡 Capturing on: %-43s ║\n", *iface)
	fmt.Printf("║  🌍 Web Interface: http://0.0.0.0:%-27d ║\n", *port)
	fmt.Println("║  💡 Access from any device on your network                   ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════╝")

	// Get local IP for convenience
	addrs, _ := net.InterfaceAddrs()
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			fmt.Printf("  → http://%s:%d\n", ipnet.IP.String(), *port)
		}
	}
	fmt.Println()

	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", *port), nil))
}
