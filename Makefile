# Pi-Track Makefile

BINARY_NAME=pi-track
GO=go

.PHONY: all build clean run deps test

all: deps build

# Install dependencies
deps:
	$(GO) mod download
	$(GO) mod tidy

# Build for current platform
build:
	$(GO) build -o $(BINARY_NAME) .

# Note: Cross-compilation doesn't work due to CGO/libpcap requirements
# Use 'make deploy' to copy source to Pi and build there

# Run locally (requires sudo for packet capture)
run: build
	sudo ./$(BINARY_NAME)

# Run with specific interface
run-eth0: build
	sudo ./$(BINARY_NAME) -interface en0

# Clean build artifacts
clean:
	rm -f $(BINARY_NAME) $(BINARY_NAME)-arm64 $(BINARY_NAME)-arm
	$(GO) clean

# Install to /usr/local/bin
install: build
	sudo cp $(BINARY_NAME) /usr/local/bin/

# Deploy source to Raspberry Pi via SSH and build there
# Usage: make deploy PI_HOST=pi@raspberrypi.local
PI_HOST ?= pi@raspberrypi.local
PI_DIR ?= ~/pi-track

deploy:
	@echo "Deploying source to $(PI_HOST):$(PI_DIR)..."
	ssh $(PI_HOST) "mkdir -p $(PI_DIR)/web"
	scp go.mod go.sum main.go Makefile README.md $(PI_HOST):$(PI_DIR)/
	scp web/* $(PI_HOST):$(PI_DIR)/web/
	@echo "Building on Pi..."
	ssh $(PI_HOST) "cd $(PI_DIR) && go build -o pi-track ."
	@echo "Done! Run with: ssh -t $(PI_HOST) 'sudo $(PI_DIR)/pi-track'"

# Deploy and run on Pi
deploy-run: deploy
	ssh -t $(PI_HOST) "sudo $(PI_DIR)/pi-track"

# Help
help:
	@echo "Pi-Track Makefile targets:"
	@echo "  make deps        - Download dependencies"
	@echo "  make build       - Build for current platform"
	@echo "  make run         - Build and run locally (requires sudo)"
	@echo "  make clean       - Remove build artifacts"
	@echo "  make install     - Install to /usr/local/bin"
	@echo "  make deploy      - Deploy source to Pi and build there (set PI_HOST=pi@hostname)"
	@echo "  make deploy-run  - Deploy, build, and run on Pi"
