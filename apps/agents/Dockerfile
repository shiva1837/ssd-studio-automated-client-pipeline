FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Healthcheck: the MCP server only exposes the SSE endpoint (health is an
# MCP tool, not an HTTP route), so probe the listening socket instead.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import socket; socket.create_connection(('localhost', 8080), timeout=5).close()" || exit 1

EXPOSE 8080

CMD ["python", "server.py"]
