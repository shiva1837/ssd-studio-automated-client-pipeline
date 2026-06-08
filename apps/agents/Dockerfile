# SSD Studio — CereFlow Agent / Self-Healing Monitor image
# Base: Python 3.11 slim
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY server.py monitor.py ./

# Default command runs the FastMCP SSE server.
# docker-compose overrides the command for the monitor service:
#   command: ["python", "monitor.py"]
EXPOSE 8080
CMD ["python", "server.py"]
