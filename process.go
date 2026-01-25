package main

import (
	"fmt"
	"log"
	"sync"
	"time"

	psnet "github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

// ProcessTracker maintains a mapping of network ports to process names
type ProcessTracker struct {
	mu         sync.RWMutex
	portPidMap map[uint32]int32 // port -> pid (using uint32 to match gopsutil, though ports are uint16)
	pidNameMap map[int32]string // pid -> process name
	lastUpdate time.Time
}

// NewProcessTracker creates a new process tracker
func NewProcessTracker() *ProcessTracker {
	return &ProcessTracker{
		portPidMap: make(map[uint32]int32),
		pidNameMap: make(map[int32]string),
	}
}

// Start begins the background update loop
func (pt *ProcessTracker) Start() {
	go func() {
		for {
			pt.update()
			time.Sleep(2 * time.Second)
		}
	}()
}

// update scans current connections and processes
func (pt *ProcessTracker) update() {
	// Get all network connections
	conns, err := psnet.Connections("inet")
	if err != nil {
		log.Printf("Error getting connections: %v", err)
		return
	}

	newPortPidMap := make(map[uint32]int32)
	pidsToResolve := make(map[int32]bool)

	for _, conn := range conns {
		if conn.Laddr.Port > 0 {
			newPortPidMap[conn.Laddr.Port] = conn.Pid
			pidsToResolve[conn.Pid] = true
		}
	}

	pt.mu.Lock()
	defer pt.mu.Unlock()

	pt.portPidMap = newPortPidMap

	// resolve unknown PIDs or refresh older ones (optional optimization: only resolve new PIDs)
	// For simplicity, we'll check our cache. PIDs are recycled, but name lookup is fast enough.
	for pid := range pidsToResolve {
		if _, exists := pt.pidNameMap[pid]; !exists {
			name, err := getProcessName(pid)
			if err == nil {
				pt.pidNameMap[pid] = name
			}
		}
	}

	// Clean up stale PIDs from name map?
	// Not strictly necessary for a small app, but good practice.
}

func getProcessName(pid int32) (string, error) {
	if pid == 0 {
		return "", fmt.Errorf("pid 0")
	}
	proc, err := process.NewProcess(pid)
	if err != nil {
		return "", err
	}
	return proc.Name()
}

// GetProcessName returns the process name for a given local port
func (pt *ProcessTracker) GetProcessName(port uint16) string {
	pt.mu.RLock()
	defer pt.mu.RUnlock()

	pid, ok := pt.portPidMap[uint32(port)]
	if !ok {
		return ""
	}

	name, ok := pt.pidNameMap[pid]
	if !ok {
		return ""
	}
	return name
}
