FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 3004
CMD ["gunicorn", "--bind", "0.0.0.0:3004", "--workers", "2", "main:app"]
