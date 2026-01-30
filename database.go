package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// Database handles SQLite storage for packets
type Database struct {
	db          *sql.DB
	insertStmt  *sql.Stmt
	insertMu    sync.Mutex
	batchQueue  []Packet
	batchSize   int
	flushTicker *time.Ticker
	flushChan   chan struct{} // Signal channel for flush requests
	stopChan    chan struct{}
}

// NewDatabase creates a new database connection
func NewDatabase(dbPath string) (*Database, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %v", err)
	}

	// Enable WAL mode for better concurrent performance
	_, err = db.Exec("PRAGMA journal_mode=WAL")
	if err != nil {
		return nil, fmt.Errorf("failed to set WAL mode: %v", err)
	}

	// Set busy timeout to 5 seconds (waits instead of failing immediately when locked)
	_, err = db.Exec("PRAGMA busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("failed to set busy timeout: %v", err)
	}

	// Use NORMAL synchronous mode for better performance with WAL
	_, err = db.Exec("PRAGMA synchronous=NORMAL")
	if err != nil {
		return nil, fmt.Errorf("failed to set synchronous mode: %v", err)
	}

	// Create tables
	err = createTables(db)
	if err != nil {
		return nil, err
	}

	// Prepare insert statement
	insertStmt, err := db.Prepare(`
		INSERT INTO packets (
			timestamp, src_ip, dst_ip, src_port, dst_port, 
			protocol, length, info, src_mac, dst_mac, 
			application, src_hostname, dst_hostname, src_country, dst_country,
			process_name
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare insert statement: %v", err)
	}

	d := &Database{
		db:          db,
		insertStmt:  insertStmt,
		batchQueue:  make([]Packet, 0, 100),
		batchSize:   100, // Batch insert every 100 packets
		flushTicker: time.NewTicker(5 * time.Second),
		flushChan:   make(chan struct{}, 1), // Buffered channel of size 1 for checks
		stopChan:    make(chan struct{}),
	}

	// Start background flush goroutine
	go d.backgroundFlush()

	return d, nil
}

func createTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS packets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME NOT NULL,
		src_ip TEXT,
		dst_ip TEXT,
		src_port INTEGER,
		dst_port INTEGER,
		protocol TEXT,
		length INTEGER,
		info TEXT,
		src_mac TEXT,
		dst_mac TEXT,
		application TEXT,
		src_hostname TEXT,
		dst_hostname TEXT,
		src_country TEXT,
		dst_country TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_packets_timestamp ON packets(timestamp);
	CREATE INDEX IF NOT EXISTS idx_packets_src_ip ON packets(src_ip);
	CREATE INDEX IF NOT EXISTS idx_packets_dst_ip ON packets(dst_ip);
	CREATE INDEX IF NOT EXISTS idx_packets_protocol ON packets(protocol);
	CREATE INDEX IF NOT EXISTS idx_packets_application ON packets(application);

	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		start_time DATETIME NOT NULL,
		end_time DATETIME,
		interface TEXT,
		total_packets INTEGER DEFAULT 0,
		total_bytes INTEGER DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS ip_stats (
		ip TEXT PRIMARY KEY,
		hostname TEXT,
		country TEXT,
		total_packets INTEGER DEFAULT 0,
		total_bytes INTEGER DEFAULT 0,
		first_seen DATETIME,
		last_seen DATETIME
	);
	`

	_, err := db.Exec(schema)
	if err != nil {
		return fmt.Errorf("failed to create schema: %v", err)
	}

	// Migration: Add process_name column if it doesn't exist
	db.Exec("ALTER TABLE packets ADD COLUMN process_name TEXT")

	return nil
}

// QueuePacket adds a packet to the batch queue for insertion
func (d *Database) QueuePacket(p Packet) {
	d.insertMu.Lock()
	d.batchQueue = append(d.batchQueue, p)
	shouldFlush := len(d.batchQueue) >= d.batchSize
	d.insertMu.Unlock()

	if shouldFlush {
		// Non-blocking send to signal flush
		select {
		case d.flushChan <- struct{}{}:
		default:
			// Already signaled, that's fine
		}
	}
}

// Flush writes all queued packets to the database
func (d *Database) Flush() {
	d.insertMu.Lock()
	if len(d.batchQueue) == 0 {
		d.insertMu.Unlock()
		return
	}

	packets := make([]Packet, len(d.batchQueue))
	copy(packets, d.batchQueue)
	d.batchQueue = d.batchQueue[:0]
	d.insertMu.Unlock()

	// Begin transaction for batch insert
	tx, err := d.db.Begin()
	if err != nil {
		log.Printf("Database error starting transaction: %v", err)
		return
	}

	stmt := tx.Stmt(d.insertStmt)
	for _, p := range packets {
		_, err := stmt.Exec(
			p.Timestamp, p.SrcIP, p.DstIP, p.SrcPort, p.DstPort,
			p.Protocol, p.Length, p.Info, p.SrcMAC, p.DstMAC,
			p.Application, p.SrcHostname, p.DstHostname, p.SrcCountry, p.DstCountry,
			p.ProcessName,
		)
		if err != nil {
			log.Printf("Database insert error: %v", err)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Database commit error: %v", err)
		tx.Rollback()
	}
}

func (d *Database) backgroundFlush() {
	for {
		select {
		case <-d.flushTicker.C:
			d.Flush()
		case <-d.flushChan:
			d.Flush()
		case <-d.stopChan:
			d.flushTicker.Stop()
			d.Flush() // Final flush
			return
		}
	}
}

// QueryPackets retrieves packets from the database with optional filters
func (d *Database) QueryPackets(limit int, offset int, filter string, country string, excludeIPs []string, startTime, endTime *time.Time) ([]Packet, int, error) {
	// Build query
	query := "SELECT id, timestamp, src_ip, dst_ip, src_port, dst_port, protocol, length, info, src_mac, dst_mac, application, src_hostname, dst_hostname, src_country, dst_country, process_name FROM packets WHERE 1=1"
	countQuery := "SELECT COUNT(*) FROM packets WHERE 1=1"
	args := []interface{}{}

	if startTime != nil {
		query += " AND timestamp >= ?"
		countQuery += " AND timestamp >= ?"
		args = append(args, startTime)
	}

	if endTime != nil {
		query += " AND timestamp <= ?"
		countQuery += " AND timestamp <= ?"
		args = append(args, endTime)
	}

	if filter != "" {
		filterClause := " AND (src_ip LIKE ? OR dst_ip LIKE ? OR protocol LIKE ? OR application LIKE ? OR src_hostname LIKE ? OR dst_hostname LIKE ? OR info LIKE ?)"
		query += filterClause
		countQuery += filterClause
		filterArg := "%" + filter + "%"
		args = append(args, filterArg, filterArg, filterArg, filterArg, filterArg, filterArg, filterArg)
	}

	if country != "" {
		countryClause := " AND (src_country = ? OR dst_country = ?)"
		query += countryClause
		countQuery += countryClause
		args = append(args, country, country)
	}

	// Exclude specified IPs
	for _, ip := range excludeIPs {
		ip = strings.TrimSpace(ip)
		if ip != "" {
			excludeClause := " AND src_ip != ? AND dst_ip != ?"
			query += excludeClause
			countQuery += excludeClause
			args = append(args, ip, ip)
		}
	}

	// Get total count
	var total int
	err := d.db.QueryRow(countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Add ordering and pagination
	query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := d.db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	packets := []Packet{}
	for rows.Next() {
		var p Packet
		var srcHostname, dstHostname, srcCountry, dstCountry, processName sql.NullString
		err := rows.Scan(
			&p.ID, &p.Timestamp, &p.SrcIP, &p.DstIP, &p.SrcPort, &p.DstPort,
			&p.Protocol, &p.Length, &p.Info, &p.SrcMAC, &p.DstMAC,
			&p.Application, &srcHostname, &dstHostname, &srcCountry, &dstCountry,
			&processName,
		)
		if err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}
		p.SrcHostname = srcHostname.String
		p.DstHostname = dstHostname.String
		p.SrcCountry = srcCountry.String
		p.DstCountry = dstCountry.String
		p.ProcessName = processName.String
		packets = append(packets, p)
	}

	return packets, total, nil
}

// GetStats returns aggregated statistics from the database
func (d *Database) GetStats(startTime, endTime *time.Time) (map[string]interface{}, error) {
	stats := map[string]interface{}{}

	// Total packets and bytes
	query := "SELECT COUNT(*), COALESCE(SUM(length), 0) FROM packets WHERE 1=1"
	args := []interface{}{}

	if startTime != nil {
		query += " AND timestamp >= ?"
		args = append(args, startTime)
	}
	if endTime != nil {
		query += " AND timestamp <= ?"
		args = append(args, endTime)
	}

	var totalPackets, totalBytes int64
	err := d.db.QueryRow(query, args...).Scan(&totalPackets, &totalBytes)
	if err != nil {
		return nil, err
	}
	stats["totalPackets"] = totalPackets
	stats["totalBytes"] = totalBytes

	// Protocol breakdown
	protocolQuery := "SELECT protocol, COUNT(*) as cnt FROM packets WHERE 1=1"
	if startTime != nil {
		protocolQuery += " AND timestamp >= ?"
	}
	if endTime != nil {
		protocolQuery += " AND timestamp <= ?"
	}
	protocolQuery += " GROUP BY protocol ORDER BY cnt DESC LIMIT 10"

	rows, err := d.db.Query(protocolQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	protocols := map[string]int64{}
	for rows.Next() {
		var proto string
		var count int64
		if err := rows.Scan(&proto, &count); err == nil {
			protocols[proto] = count
		}
	}
	stats["protocolStats"] = protocols

	// Top talkers (by bytes)
	talkerQuery := "SELECT src_ip, SUM(length) as bytes, COUNT(*) as pkts FROM packets WHERE src_ip != '' AND 1=1"
	if startTime != nil {
		talkerQuery += " AND timestamp >= ?"
	}
	if endTime != nil {
		talkerQuery += " AND timestamp <= ?"
	}
	talkerQuery += " GROUP BY src_ip ORDER BY bytes DESC LIMIT 10"

	rows2, err := d.db.Query(talkerQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows2.Close()

	talkers := []map[string]interface{}{}
	for rows2.Next() {
		var ip string
		var bytes, packets int64
		if err := rows2.Scan(&ip, &bytes, &packets); err == nil {
			info := getIPInfo(ip)
			talkers = append(talkers, map[string]interface{}{
				"ip":       ip,
				"bytes":    bytes,
				"packets":  packets,
				"hostname": info.Hostname,
				"country":  info.Country,
			})
		}
	}
	stats["topTalkers"] = talkers

	return stats, nil
}

// GetDistinctCountries returns all unique country codes from the database
func (d *Database) GetDistinctCountries() ([]string, error) {
	query := `
		SELECT DISTINCT country FROM (
			SELECT src_country as country FROM packets WHERE src_country IS NOT NULL AND src_country != ''
			UNION
			SELECT dst_country as country FROM packets WHERE dst_country IS NOT NULL AND dst_country != ''
		) ORDER BY country
	`

	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	countries := []string{}
	for rows.Next() {
		var country string
		if err := rows.Scan(&country); err == nil && country != "" {
			countries = append(countries, country)
		}
	}

	return countries, nil
}

// Truncate clears all data from the database
func (d *Database) Truncate() error {
	d.insertMu.Lock()
	// Clear the memory batch queue first
	d.batchQueue = d.batchQueue[:0]
	d.insertMu.Unlock()

	// Use a transaction
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}

	// Delete contents from tables
	tables := []string{"packets", "sessions", "ip_stats"}
	for _, table := range tables {
		_, err := tx.Exec("DELETE FROM " + table)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to truncate table %s: %v", table, err)
		}
		// Reset auto-increment counters
		_, err = tx.Exec("DELETE FROM sqlite_sequence WHERE name=?", table)
		if err != nil {
			// Not critical if this fails
			log.Printf("Warning: failed to reset sequence for %s: %v", table, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Optimize database to reclaim space
	_, err = d.db.Exec("VACUUM")
	if err != nil {
		log.Printf("Warning: bloat vacuum failed: %v", err)
	}

	return nil
}

// GetDatabaseInfo returns info about the database
func (d *Database) GetDatabaseInfo() (map[string]interface{}, error) {
	info := map[string]interface{}{}

	// Total packets stored
	var totalPackets int64
	d.db.QueryRow("SELECT COUNT(*) FROM packets").Scan(&totalPackets)
	info["totalPackets"] = totalPackets

	// Date range - query as strings since sql.NullTime doesn't parse SQLite timestamps correctly
	var minTimeStr, maxTimeStr sql.NullString
	d.db.QueryRow("SELECT MIN(timestamp), MAX(timestamp) FROM packets").Scan(&minTimeStr, &maxTimeStr)
	if minTimeStr.Valid && minTimeStr.String != "" {
		if t, err := time.Parse("2006-01-02 15:04:05.999999999 -0700 MST", minTimeStr.String); err == nil {
			info["earliestPacket"] = t
		}
	}
	if maxTimeStr.Valid && maxTimeStr.String != "" {
		if t, err := time.Parse("2006-01-02 15:04:05.999999999 -0700 MST", maxTimeStr.String); err == nil {
			info["latestPacket"] = t
		}
	}

	// Database file size (would need os.Stat but we'll estimate)
	var pageCount, pageSize int64
	d.db.QueryRow("PRAGMA page_count").Scan(&pageCount)
	d.db.QueryRow("PRAGMA page_size").Scan(&pageSize)
	info["databaseSize"] = pageCount * pageSize

	return info, nil
}

// Close closes the database connection
func (d *Database) Close() error {
	close(d.stopChan)
	d.insertStmt.Close()
	return d.db.Close()
}
