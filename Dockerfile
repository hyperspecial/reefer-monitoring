# ── Reefer Monitoring System — Docker Image ───────────────────────────────────
# Build:  docker build -t reefer-monitor .
# Run:    docker run -d -p 5000:5000 --name reefer-monitor reefer-monitor
# Logs:   docker logs -f reefer-monitor
# Stop:   docker stop reefer-monitor

FROM node:20-alpine

LABEL maintainer="hyperspecial"
LABEL description="Fleet Reefer Monitoring Dashboard"

# Create app directory
WORKDIR /app

# Copy all source files
COPY . .

# Create a volume mount point for persistent alert history
RUN mkdir -p /app/data

# Use a dedicated data directory for the alerts file so it can be
# mounted as a Docker volume and survive container restarts
ENV ALERTS_DIR=/app/data

# Expose dashboard port
EXPOSE 5000

# Health check — hits the JSON API every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/fleet || exit 1

# Run the dashboard
CMD ["node", "dashboard.js"]
